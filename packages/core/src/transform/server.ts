import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export interface ServerBlock {
  index: number;
  code: string;
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
             if (bodyPath.isArrowFunctionExpression() || bodyPath.isFunctionExpression()) {
                 bodyPath.traverse({
                    Identifier(innerPath) {
                        if (!innerPath.isReferencedIdentifier()) return;
                        queue.add(innerPath.node.name);
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
                
                const binding = path.scope.getBinding(name);
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
                const binding = path.scope.getBinding(name);
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

           
           // Combine
           blocks.push({
               index: serverBlockCount++,
               code: depsCode + body
           });
        }
      }
    }
  });

  return blocks;
}
