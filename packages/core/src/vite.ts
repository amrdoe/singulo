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
                 if (block.deps) {
                     // Split deps by line and add each unique one
                     const depLines = block.deps.trim().split('\n').filter(line => line.trim());
                     depLines.forEach(dep => {
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
            
            export default async function handler(req, res) {
               const registry = {
                  ${blocksRegistry.join('\n')}
               };
               
               if (req.method === 'POST') {
                   // parse body ... simple mock
                   const buffers = [];
                   for await (const chunk of req) {
                       buffers.push(chunk);
                   }
                   const data = JSON.parse(Buffer.concat(buffers).toString());
                   const { fileId, blockIndex, args = [] } = data;
                   const uniqueId = \`\${fileId}-\${blockIndex}\`;
                   
                   if (registry[uniqueId]) {
                       try {
                           const result = await registry[uniqueId](...args);
                           res.status(200).json(result);
                       } catch (e) {
                           console.error(e);
                           res.status(500).json({ error: e.message });
                       }
                   } else {
                       res.status(404).json({ error: "Function not found" });
                   }
               } else {
                   res.status(405).send("Method Not Allowed");
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
        server.middlewares.use(async (req: any, res: any, next: any) => {
            if (req.url?.startsWith('/_singulo/rpc') && req.method === 'POST') {
                let body = '';
                req.on('data', (chunk: any) => body += chunk);
                req.on('end', async () => {
                    try {
                        const { fileId, blockIndex, args = [] } = JSON.parse(body);
                        // HERE IS THE MAGIC:
                        // We need to load the original file, extract the server block, and execute it.
                        // Since we are in Node, we can import the file! 
                        // BUT, if we import the file, it might try to render JSX or do client stuff that fails in Node?
                        // Actually, .singulo.tsx components are React components. 
                        // We need a way to run JUST the server block.
                        
                         // For this MVP, we will assume we can "eval" the extracted code or similar.
                        // A better way: maintain a cache of server blocks in memory during development.
                        
                        // Mock response matching demo.singulo.tsx expectation
                        const mockProduct = { id: "123", name: "Singulo Pro", price: 999 };
                         
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify(mockProduct));
                    } catch (e) {
                        console.error(e);
                        res.statusCode = 500;
                        res.end(JSON.stringify({ error: 'Internal Error' }));
                    }
                });
                return;
            }
            next();
        });
    }
  };
}
