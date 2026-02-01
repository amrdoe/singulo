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
      // Find $.server(...)
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.object, { name: '$' }) &&
        t.isIdentifier(path.node.callee.property, { name: 'server' })
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
            t.memberExpression(
              t.callExpression(t.identifier('fetch'), [
                t.stringLiteral('/_singulo/rpc'),
                t.objectExpression([
                    t.objectProperty(t.identifier('method'), t.stringLiteral('POST')),
                    t.objectProperty(t.identifier('body'), t.callExpression(
                        t.memberExpression(t.identifier('JSON'), t.identifier('stringify')),
                        [t.objectExpression([
                            t.objectProperty(t.identifier('fileId'), t.stringLiteral(id)),
                            t.objectProperty(t.identifier('blockIndex'), t.numericLiteral(blockId)),
                            t.objectProperty(t.identifier('args'), argsExpression)
                        ])]
                    ))
                ])
              ]),
              t.identifier('then')
            ),
            [
              t.arrowFunctionExpression(
                [t.identifier('r')],
                t.callExpression(t.memberExpression(t.identifier('r'), t.identifier('json')), [])
              )
            ]
          )
        );
      }
    },
    // Remove imports ending in .server.ts or .server.tsx
    ImportDeclaration(path) {
      if (path.node.source.value.includes('.server')) {
        path.remove();
      }
    }
  });

  return generate(ast).code;
}
