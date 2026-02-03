import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle both ESM and CJS imports
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;
const generate: typeof generateModule = (generateModule as any).default || generateModule;

export function transformClient(code: string, id: string) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx']
  });

  let serverBlockCount = 0;

  traverse(ast, {
    CallExpression(path) {
      // Find $(...)
      if (
        t.isIdentifier(path.node.callee) &&
        path.node.callee.name === '$'
      ) {
        // Replace with fetch call
        const blockId = serverBlockCount++;
        const uniqueId = `${id}-${blockId}`; 
        
        // Extract args from second parameter (if present)
        const argsParam = path.node.arguments[1];
        const argsExpression = (argsParam && !t.isArgumentPlaceholder(argsParam) && !t.isSpreadElement(argsParam)) 
          ? argsParam 
          : t.arrayExpression([]);
        
        path.replaceWith(
          t.callExpression(
             t.identifier('createRpcClient'),
             [
                t.stringLiteral(id),
                t.numericLiteral(blockId),
                argsExpression
             ]
          )
        );
        
        // Ensure createRpcClient is imported
        const program = path.findParent(p => p.isProgram());
        if (program && program.isProgram()) {
            const hasImport = program.node.body.some(node => 
                t.isImportDeclaration(node) && 
                node.source.value.includes('singulo/runtime/client')
            );
            
            if (!hasImport) {
                // We add the import to the top
                // But typically transformations add imports in a smarter way or we need a helper.
                // For now let's pre-pend.
                // Actually, traversing inside Program. 
                // We can add it to a Set and add all imports at the end of traversal or check efficiently.
            }
        }
      }
    },
    // Remove imports ending in .server.ts or .server.tsx
    ImportDeclaration(path) {
      if (path.node.source.value.includes('.server')) {
        path.remove();
      }
    }
  });

  // Inject import
  if (serverBlockCount > 0) {
      const importDecl = t.importDeclaration(
          [t.importSpecifier(t.identifier('createRpcClient'), t.identifier('createRpcClient'))],
          t.stringLiteral('@singulo/core/runtime/client')
      );
      ast.program.body.unshift(importDecl);
  }

  return generate(ast).code;
}
