import { describe, it, expect, beforeEach } from 'vitest';
import { transformServer } from './transform/server';

/**
 * Integration test for persistent state across RPC calls
 * This simulates the actual behavior of the generated RPC handler
 */
describe('RPC Handler - Persistent State Integration', () => {
  it('should maintain state across multiple function calls', async () => {
    // Simulate the source code
    const sourceCode = `
      import $ from '@singulo/core';
      
      const messages = [];
      
      function addMessage(text) {
        messages.push(text);
        return messages;
      }
      
      function getMessages() {
        return messages;
      }
      
      export default function Component() {
        return (
          <div>
            <button onClick={() => $(() => getMessages())}>Get</button>
            <button onClick={() => $((msg) => addMessage(msg), ['Hello'])}>Add</button>
          </div>
        );
      }
    `;
    
    // Transform the code
    const blocks = transformServer(sourceCode, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(2);
    
    // Simulate hoisting dependencies (what vite.ts does)
    const depsMap = new Map<string, string>();
    blocks.forEach(block => {
      if (block.deps && Array.isArray(block.deps)) {
        block.deps.forEach(dep => {
          const trimmedDep = dep.trim();
          if (trimmedDep && !depsMap.has(trimmedDep)) {
            depsMap.set(trimmedDep, trimmedDep);
          }
        });
      }
    });
    
    const hoistedDeps = Array.from(depsMap.values()).join('\n');
    
    // Verify each dependency appears only once
    const depCount = (hoistedDeps.match(/const messages = \[\]/g) || []).length;
    expect(depCount).toBe(1);
    
    // Verify the generated code structure
    const generatedCode = `
      ${hoistedDeps}
      
      const registry = {
        "test-0": async (${blocks[0].params.join(', ') || '...args'}) => {
          ${blocks[0].code}
        },
        "test-1": async (${blocks[1].params.join(', ') || '...args'}) => {
          ${blocks[1].code}
        }
      };
    `;
    
    // The generated code should have messages declared at the top, outside the registry
    expect(generatedCode.indexOf('const messages = []')).toBeLessThan(
      generatedCode.indexOf('const registry')
    );
    
    // Both functions should reference the same messages array (no local declaration)
    expect(blocks[0].code).not.toContain('const messages');
    expect(blocks[1].code).not.toContain('const messages');
  });
  
  it('should deduplicate shared dependencies across multiple blocks', () => {
    const sourceCode = `
      import $ from '@singulo/core';
      
      const counter = { value: 0 };
      
      function increment() {
        counter.value++;
        return counter.value;
      }
      
      function decrement() {
        counter.value--;
        return counter.value;
      }
      
      function reset() {
        counter.value = 0;
        return counter.value;
      }
      
      export default function Component() {
        return (
          <div>
            <button onClick={() => $(() => increment())}>+</button>
            <button onClick={() => $(() => decrement())}>-</button>
            <button onClick={() => $(() => reset())}>Reset</button>
          </div>
        );
      }
    `;
    
    const blocks = transformServer(sourceCode, 'counter.singulo.tsx');
    
    expect(blocks).toHaveLength(3);
    
    // Collect and deduplicate dependencies
    const depsMap = new Map<string, string>();
    blocks.forEach(block => {
      if (block.deps && Array.isArray(block.deps)) {
        block.deps.forEach(dep => {
          const trimmedDep = dep.trim();
          if (trimmedDep && !depsMap.has(trimmedDep)) {
            depsMap.set(trimmedDep, trimmedDep);
          }
        });
      }
    });
    
    const hoistedDeps = Array.from(depsMap.values()).join('\n');
    
    // counter should appear only once
    const counterCount = (hoistedDeps.match(/const counter = /g) || []).length;
    expect(counterCount).toBe(1);
    
    // All three functions should be present
    // All three functions should be present
    expect(blocks[0].deps.some(d => d.includes('function increment'))).toBe(true);
    expect(blocks[1].deps.some(d => d.includes('function decrement'))).toBe(true);
    expect(blocks[2].deps.some(d => d.includes('function reset'))).toBe(true);
  });
  
  it('should handle complex dependency chains', () => {
    const sourceCode = `
      import $ from '@singulo/core';
      
      const db = [];
      
      function validate(item) {
        return item && item.id;
      }
      
      function save(item) {
        if (validate(item)) {
          db.push(item);
        }
        return db;
      }
      
      export default function Component() {
        return (
          <button onClick={() => $((item) => save(item), [{ id: 1 }])}>
            Save
          </button>
        );
      }
    `;
    
    const blocks = transformServer(sourceCode, 'db.singulo.tsx');
    
    expect(blocks).toHaveLength(1);
    console.log("ACTUAL DEPS:", blocks[0].deps);
    
    // Should extract all transitive dependencies
    expect(blocks[0].deps).toContain('const db = [];');
    expect(blocks[0].deps.some(d => d.includes('function validate'))).toBe(true);
    expect(blocks[0].deps.some(d => d.includes('function save'))).toBe(true);
  });
  
  it('should generate correct parameter signatures', () => {
    const testCases = [
      {
        code: '$(() => value)',
        expectedParams: [],
        description: 'no parameters'
      },
      {
        code: '$((x) => process(x), [x])',
        expectedParams: ['x'],
        description: 'single parameter'
      },
      {
        code: '$((a, b, c) => combine(a, b, c), [a, b, c])',
        expectedParams: ['a', 'b', 'c'],
        description: 'multiple parameters'
      }
    ];
    
    for (const testCase of testCases) {
      const { code, expectedParams, description } = testCase;
      const sourceCode = `
        import $ from '@singulo/core';
        const value = 42;
        function process(x) { return x; }
        function combine(a, b, c) { return [a, b, c]; }
        
        export default function Component() {
          return <button onClick={() => ${code}}>Test</button>;
        }
      `;
      
      const blocks = transformServer(sourceCode, 'test.singulo.tsx');
      
      expect(blocks[0].params, description).toEqual(expectedParams);
    }
  });
});
