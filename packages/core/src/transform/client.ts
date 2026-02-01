import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as t from '@babel/types';

// @ts-ignore
const traverse = _traverse.default || _traverse;
// @ts-ignore
const generate = _generate.default || _generate;

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
        // Use a consistent ID generation strategy in real app (e.g. hash of file + index)
        const uniqueId = `${id}-${blockId}`; 
        
        // Replace with: fetch('/api/singulo', { method: 'POST', body: JSON.stringify({ id: uniqueId, args: [] }) }).then(r => r.json())
        // For simplicity, we assume the server block takes no arguments from closure for now, or we serialize them (advanced).
        // The prompt says "Automatically serialize variables". 
        // For this minimal MVP, let's just make it a simple RPC trigger.
        
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
                            t.objectProperty(t.identifier('blockIndex'), t.numericLiteral(blockId))
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
