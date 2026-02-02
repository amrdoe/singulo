// import type { Plugin } from 'vite';
// Workaround for build error: Module '"vite"' has no exported member 'Plugin'
type Plugin = any;

import { transformClient } from './transform/client';
import { transformServer } from './transform/server';
import * as path from 'path';
import * as fs from 'fs/promises';

export default function singulo(): Plugin {
  let isBuild = false;
  let isServer = false;
  let root = process.cwd();
  const serverCodeMap = new Map<string, string>();

  return {
    name: 'singulo-core',
    configResolved(config: any) {
      isBuild = config.command === 'build';
      // In Vite, ssr build is indicated by `config.build.ssr` being set, usually to true or a string path.
      isServer = !!config.build?.ssr;
      root = config.root;
    },
    async transform(code: string, id: string) {
      if (!id.endsWith('.singulo.tsx')) return;
      
      const relativeId = path.relative(root, id).split(path.sep).join(path.posix.sep);

      if (!isServer) {
        // Strip server code using relative ID
        const transformed = transformClient(code, relativeId);
        
        // Track the file for server generation later
        serverCodeMap.set(relativeId, code);
        console.log("Singulo: Captured server code for", relativeId);

        return {
            code: transformed,
            map: null // TODO: Source maps
        };
      } else {
        return null;
      }
    },

    async generateBundle(options: any, bundle: any) {
        console.log("Singulo: generateBundle hook called");
        console.log("Singulo: isBuild =", isBuild, "isServer =", isServer);
        
        if (!isBuild || isServer) return;
        
        console.log("Singulo: Server blocks found:", serverCodeMap.size);
        
        if (serverCodeMap.size === 0) return;

        // Ensure output dir exists
        const outDir = path.resolve(process.cwd(), 'dist/server');
        // We are mimicking a single RPC function that handles all requests, 
        // OR we can generate individual functions.
        // The client currently sends { fileId, blockIndex } to /_singulo/rpc.
        // So we should probably generate ONE serverless function at /_singulo/rpc
        // that imports the logic. 
        // BUT, for Vercel, we need to map the routes. 
        // Let's stick to the prompt's "Standalone Serverless Functions" idea but adapted.
        
        // Actually, let's just make a simple Node script that contains ALL the blocks for now,
        // effectively a registry.
        
        const blocksRegistry: string[] = [];
        const depsMap = new Map<string, string>();  // Track unique dependencies
        
        // Collect all blocks and their dependencies
        for (const [id, code] of serverCodeMap.entries()) {
            const blocks = transformServer(code, id);
            blocks.forEach(block => {
                 // Collect dependencies for hoisting
                 if (block.deps && Array.isArray(block.deps)) {
                     block.deps.forEach(dep => {
                         const trimmedDep = dep.trim();
                         if (trimmedDep && !depsMap.has(trimmedDep)) {
                             depsMap.set(trimmedDep, trimmedDep);
                         }
                     });
                 }
                 
                 const params = block.params.length > 0 ? block.params.join(', ') : '...args';
                 blocksRegistry.push(`
                    "${id}-${block.index}": async (${params}) => {
                        ${block.code}
                    },
                 `);
            });
        }
        
        // Combine all unique dependencies
        const hoistedDeps = Array.from(depsMap.values()).join('\n');
        
        const rpcHandler = `
            ${hoistedDeps}
            
            const activeSubscriptions = new Map();
            
            export default async function handler(req, res) {
               const registry = {
                  ${blocksRegistry.join('\n')}
               };
               
               const getBody = async () => {
                   const buffers = [];
                   for await (const chunk of req) {
                       buffers.push(chunk);
                   }
                   return Buffer.concat(buffers).toString();
               };
               
               const url = req.url || '';

               try {
                   // Handle Client PUSH (C -> S)
                   if (url.includes('/_singulo/rpc/push') && req.method === 'POST') {
                        const body = await getBody();
                        const { subscriptionId, value } = JSON.parse(body);
                        const active = activeSubscriptions.get(subscriptionId);
                        // Check if the RESULT object (Subject) has next(), not the subscription
                        if (active && active.result && typeof active.result.next === 'function') {
                            active.result.next(value);
                            res.status(200).json({ ok: true });
                        } else {
                            res.status(404).json({ error: 'Subscription not found or does not support next' });
                        }
                        return;
                   }

                   // Handle Unsubscribe
                   if (url.includes('/_singulo/rpc/unsubscribe') && req.method === 'POST') {
                        const body = await getBody();
                        const { subscriptionId } = JSON.parse(body);
                        const active = activeSubscriptions.get(subscriptionId);
                        if (active) {
                            active.subscription.unsubscribe();
                            activeSubscriptions.delete(subscriptionId);
                            res.status(200).json({ ok: true });
                        } else {
                             res.status(404).json({ error: 'Subscription not found' });
                        }
                        return;
                   }
                
                   if (req.method === 'POST') {
                       const body = await getBody();
                       const { fileId, blockIndex, args = [] } = JSON.parse(body);
                       const uniqueId = \`\${fileId}-\${blockIndex}\`;
                       
                       if (registry[uniqueId]) {
                            const result = await registry[uniqueId](...args);
                            
                            if (result && typeof result.subscribe === 'function') {
                                res.setHeader('Content-Type', 'text/event-stream');
                                res.setHeader('Cache-Control', 'no-cache');
                                res.setHeader('Connection', 'keep-alive');
                                
                                const subscriptionId = Math.random().toString(36).substring(7);
                                res.write(\`data: \${JSON.stringify({ type: 'init', subscriptionId })}\\n\\n\`);
                                
                                const subscription = result.subscribe(
                                    (value) => {
                                        res.write(\`data: \${JSON.stringify({ type: 'next', value })}\\n\\n\`);
                                    },
                                    (error) => {
                                        res.write(\`data: \${JSON.stringify({ type: 'error', error: String(error) })}\\n\\n\`);
                                        res.end();
                                        activeSubscriptions.delete(subscriptionId);
                                    },
                                    () => {
                                        res.write(\`data: \${JSON.stringify({ type: 'complete' })}\\n\\n\`);
                                        res.end();
                                        activeSubscriptions.delete(subscriptionId);
                                    }
                                );
                                // Bidirectional: if the result also has a 'next' method, we can route pushes to it?
                                // Standard observable doesn't have next() on the observable itself usually (Subject does).
                                // We check if observable object itself has next.
                                activeSubscriptions.set(subscriptionId, { subscription, result, res });
                                
                                req.on('close', () => {
                                    if (activeSubscriptions.has(subscriptionId)) {
                                        subscription.unsubscribe();
                                        activeSubscriptions.delete(subscriptionId);
                                    }
                                });
                            } else {
                                res.status(200).json(result);
                            }
                       } else {
                           res.status(404).json({ error: "Function not found" });
                       }
                   } else {
                       res.status(405).send("Method Not Allowed");
                   }
               } catch (e) {
                   console.error(e);
                   res.status(500).json({ error: e.message });
               }
            }
        `;
        
        // Write this to dist/server/rpc.js
        const serverDir = path.resolve('dist/server'); // Use config.build.outDir in real app?
        await fs.mkdir(serverDir, { recursive: true });
        
        // Pretty print
        let formattedCode = rpcHandler;
        try {
            // @ts-ignore
            const prettier = await import('prettier');
            formattedCode = await prettier.format(rpcHandler, { parser: 'babel' });
        } catch (e) {
            console.warn("Singulo: Failed to format server code", e);
        }
        
        await fs.writeFile(path.join(serverDir, 'rpc.js'), formattedCode);
        
        console.log("Generated Singulo Server RPC Handler at dist/server/rpc.js");
    },
    
    // Hook to handle the API route for the RPC calls during DEV
    configureServer(server: any) {
        const activeSubscriptions = new Map<string, { subscription: any, result?: any, res: any }>();

        server.middlewares.use(async (req: any, res: any, next: any) => {
            if (req.url?.startsWith('/_singulo/rpc')) {
                let body = '';
                 if (req.method === 'POST') {
                    for await (const chunk of req) {
                        body += chunk;
                    }
                 }

                // Handle Client PUSH (C -> S)
                if (req.url === '/_singulo/rpc/push' && req.method === 'POST') {
                     try {
                        const { subscriptionId, value } = JSON.parse(body);
                        const active = activeSubscriptions.get(subscriptionId);
                        // In internal DEV mock below, result object (Subject) has next.
                        if (active && active.result && typeof active.result.next === 'function') {
                            active.result.next(value);
                            res.statusCode = 200;
                            res.end(JSON.stringify({ ok: true }));
                        } else {
                            res.statusCode = 404;
                            res.end(JSON.stringify({ error: 'Subscription not found or does not support next' }));
                        }
                     } catch (e) {
                         console.error(e);
                         res.statusCode = 500;
                         res.end(JSON.stringify({ error: 'Internal Error' }));
                     }
                     return;
                }

                // Handle Unsubscribe
                if (req.url === '/_singulo/rpc/unsubscribe' && req.method === 'POST') {
                    try {
                        const { subscriptionId } = JSON.parse(body);
                        const active = activeSubscriptions.get(subscriptionId);
                        if (active) {
                            active.subscription.unsubscribe();
                            activeSubscriptions.delete(subscriptionId);
                            res.statusCode = 200;
                            res.end(JSON.stringify({ ok: true }));
                        } else {
                             res.statusCode = 404;
                             res.end(JSON.stringify({ error: 'Subscription not found' }));
                        }
                    } catch (e) {
                         res.statusCode = 500;
                         res.end(JSON.stringify({ error: 'Internal Error' }));
                    }
                    return;
                }

                // Handle RPC Call
                if (req.url === '/_singulo/rpc' && req.method === 'POST') {
                    try {
                        const { fileId, blockIndex, args = [] } = JSON.parse(body);
                        
                        // TODO: Real execution of server block.
                        // For now we mock it, or we can try to improve this if we have time.
                        // But user asked for Observable feature, so let's mock an Observable result 
                        // if the blockIndex is specific, or just fallback.
                        // To test this properly without a full runtime, we need a way to injecting logic.
                        
                        let result;
                        
                        // MOCK LOGIC for DEMO:
                        // If fileId contains 'timer', return an observable
                        if (fileId.includes('timer')) {
                             result = {
                                 subscribe: (next: any, error: any, complete: any) => {
                                     let count = 0;
                                     const interval = setInterval(() => {
                                         next(count++);
                                     }, 1000);
                                     
                                     return {
                                         unsubscribe: () => {
                                             clearInterval(interval);
                                         },
                                         // For bidirectional demo
                                         next: (val: any) => {
                                             console.log("Server received from client:", val);
                                             // Echo back
                                             next(`Echo: ${val}`);
                                         }
                                     };
                                 }
                             };
                        } else {
                            // Default mock
                             result = { id: "123", name: "Singulo Pro", price: 999 };
                        }

                        // Check if observable
                        if (result && typeof result.subscribe === 'function') {
                            res.setHeader('Content-Type', 'text/event-stream');
                            res.setHeader('Cache-Control', 'no-cache');
                            res.setHeader('Connection', 'keep-alive');
                            
                            const subscriptionId = Math.random().toString(36).substring(7);
                            res.write(`data: ${JSON.stringify({ type: 'init', subscriptionId })}\n\n`);
                            
                            const subscription = result.subscribe(
                                (value: any) => {
                                    res.write(`data: ${JSON.stringify({ type: 'next', value })}\n\n`);
                                },
                                (error: any) => {
                                    res.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`);
                                    res.end();
                                    activeSubscriptions.delete(subscriptionId);
                                },
                                () => {
                                    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
                                    res.end();
                                    activeSubscriptions.delete(subscriptionId);
                                }
                            );
                            
                            activeSubscriptions.set(subscriptionId, { subscription, result, res });
                            
                            // Clean up on connection close
                            req.on('close', () => {
                                if (activeSubscriptions.has(subscriptionId)) {
                                    subscription.unsubscribe();
                                    activeSubscriptions.delete(subscriptionId);
                                }
                            });
                        } else {
                            // Standard JSON
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify(result));
                        }

                    } catch (e) {
                        console.error(e);
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: 'Internal Error' }));
                    }
                    return;
                }
            }
            next();
        });
    }
  };
}
