import { parse } from '@babel/parser';
import traverseModule, { NodePath } from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle both ESM and CJS imports
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;
const generate: typeof generateModule = (generateModule as any).default || generateModule;

export interface ServerBlock {
  index: number;
  code: string;          // Function body only
  deps: string;          // Dependencies (to be hoisted)
  params: string[];      // Parameter names for the function
}

export function transformServer(code: string, id: string): ServerBlock[] {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });

  const blocks: ServerBlock[] = [];
  let serverBlockCount = 0;

  traverse(ast, {
    CallExpression(path) {
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.object, { name: '$' }) &&
        t.isIdentifier(path.node.callee.property, { name: 'server' })
      ) {
        const arg = path.node.arguments[0];
        if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            // Found server block. Now analyze dependencies.
            const dependencies = new Set<string>();
            const queue = new Set<string>(); // For BFS/DFS

            // Initial scan of the server block
            // Use a visitor on the argument (the function), not the whole CallExpression
            // to avoid picking up '$' from '$.server'
            const bodyPath = path.get('arguments.0');
            const programScope = path.scope.getProgramParent();
            
             if (bodyPath.isArrowFunctionExpression() || bodyPath.isFunctionExpression()) {
                 bodyPath.traverse({
                    Identifier(innerPath) {
                        if (!innerPath.isReferencedIdentifier()) return;
                        const name = innerPath.node.name;
                        
                        // Only add identifiers that exist at program level
                        const programBinding = programScope.getBinding(name);
                        if (programBinding && t.isProgram(programBinding.scope.block)) {
                            queue.add(name);
                        }
                    }
                });
             }
            
            // Process queue to find dependencies and their transitive dependencies
            queue.forEach(name => {
                if (dependencies.has(name)) return;
                
                const binding = path.scope.getBinding(name);
                if (binding && t.isProgram(binding.scope.block)) {
                    dependencies.add(name);
                    
                    // If it's a function or variable, we need to scan IT for dependencies too
                    if (t.isFunctionDeclaration(binding.path.node) || t.isVariableDeclarator(binding.path.node)) {
                        binding.path.traverse({
                            Identifier(transitivePath) {
                                if (!transitivePath.isReferencedIdentifier()) return;
                                const transitiveName = transitivePath.node.name;
                                // Add to queue if not already processed
                                if (!dependencies.has(transitiveName)) {
                                    queue.add(transitiveName);
                                    // Hack: Set behaves like a queue if we add to it while iterating? 
                                    // standard Set.forEach iteration behavior varies.
                                    // Let's rely on re-entrant check or use a loop.
                                }
                            }
                        });
                    }
                }
            });
            
            // Set.forEach on newer JS engines might not iterate new additions. 
            // Let's do a while loop to be robust.
            
            // Reset and do it properly
            dependencies.clear();
            const processQueue = Array.from(queue);
            const visited = new Set<string>();
            
            while(processQueue.length > 0) {
                const name = processQueue.shift()!;
                if (visited.has(name)) continue;
                visited.add(name);
                
                // Use program scope to avoid variable shadowing
                const binding = programScope.getBinding(name);
                if (binding && t.isProgram(binding.scope.block)) {
                    dependencies.add(name);
                    
                    if (t.isFunctionDeclaration(binding.path.node) || t.isVariableDeclarator(binding.path.node)) {
                        binding.path.traverse({
                            Identifier(transitivePath) {
                                if (!transitivePath.isReferencedIdentifier()) return;
                                const transitiveName = transitivePath.node.name;
                                if (!visited.has(transitiveName)) {
                                    processQueue.push(transitiveName);
                                }
                            }
                        });
                    }
                }
            }

            // Generate code for dependencies
            const dependencyNodes: any[] = [];
            dependencies.forEach(name => {
                // Use program scope to get the correct binding
                const binding = programScope.getBinding(name);
                if (binding) {
                    if (t.isImportSpecifier(binding.path.node) || t.isImportDefaultSpecifier(binding.path.node) || t.isImportNamespaceSpecifier(binding.path.node)) {
                         // It's an import. We need the parent ImportDeclaration.
                         // This is tricky because we might grab the whole import line just for one specifier.
                         // But that's safer.
                         const importDecl = binding.path.findParent(p => p.isImportDeclaration());
                         if (importDecl) {
                             dependencyNodes.push(importDecl.node);
                         }
                    } else if (t.isVariableDeclarator(binding.path.node)) {
                        // Variable declaration. Grab the parent VariableDeclaration (e.g. const x = 1)
                        const varDecl = binding.path.findParent(p => p.isVariableDeclaration());
                        if (varDecl) {
                            dependencyNodes.push(varDecl.node);
                        }
                    } else if (t.isFunctionDeclaration(binding.path.node)) {
                        dependencyNodes.push(binding.path.node);
                    }
                }
            });
            
            // Deduplicate nodes (e.g. multiple imports from same file)
            const uniqueNodes = Array.from(new Set(dependencyNodes));
            
            let depsCode = "";
            if (uniqueNodes.length > 0) {
                 depsCode = uniqueNodes.map(n => generate(n).code).join('\n') + '\n';
            }

           let body = generate(arg.body).code;
           if (!t.isBlockStatement(arg.body)) {
               body = `return ${body};`;
           }
           
           // Extract parameter names
           const params = arg.params.map((param: any) => {
               if (t.isIdentifier(param)) {
                   return param.name;
               } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
                   return '...' + param.argument.name;
               }
               return '';
           }).filter((name: string) => name !== '');

           
           // Combine - separate deps from body
           blocks.push({
               index: serverBlockCount++,
               code: body,              // Just the function body
               deps: depsCode,          // Dependencies to be hoisted
               params
           });
        }
      }
    }
  });

  return blocks;
}
