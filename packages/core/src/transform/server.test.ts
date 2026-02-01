import { describe, it, expect } from 'vitest';
import { transformServer } from './server';

describe('Server Transformation - Persistent State', () => {
  it('should separate dependencies from function body', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const chat = [];
      
      function postMessage(sender, body) {
        chat.push({ sender, body });
        return chat;
      }
      
      export default function Component() {
        return (
          <div>
            <button onClick={() => $.server(() => chat)}>Get</button>
            <button onClick={() => $.server((s, b) => postMessage(s, b), [s, b])}>Post</button>
          </div>
        );
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(2);
    
    // First block ($.server(() => chat))
    expect(blocks[0].deps).toBeTruthy();
    expect(blocks[0].deps).toContain('const chat = []');
    expect(blocks[0].code).toContain('return chat');
    expect(blocks[0].code).not.toContain('const chat = []'); // Deps should be separated
    
    // Second block ($.server((s, b) => postMessage(s, b)))
    expect(blocks[1].deps).toBeTruthy();
    expect(blocks[1].deps).toContain('function postMessage');
    expect(blocks[1].deps).toContain('const chat = []');
    expect(blocks[1].code).toContain('return postMessage');
    expect(blocks[1].params).toEqual(['s', 'b']);
  });
  
  it('should extract function parameters correctly', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const data = [];
      
      export default function Component() {
        return (
          <button onClick={() => $.server((a, b, c) => data.push(a, b, c), [1, 2, 3])}>
            Add
          </button>
        );
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0].params).toEqual(['a', 'b', 'c']);
  });
  
  it('should handle functions with no parameters', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const value = 42;
      
      export default function Component() {
        return <button onClick={() => $.server(() => value)}>Get</button>;
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0].params).toEqual([]);
    expect(blocks[0].deps).toContain('const value = 42');
  });
  
  it('should extract transitive dependencies', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const data = [];
      
      function helper(x) {
        return data.push(x);
      }
      
      function addData(value) {
        return helper(value);
      }
      
      export default function Component() {
        return <button onClick={() => $.server((v) => addData(v), [1])}>Add</button>;
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0].deps).toContain('const data = []');
    expect(blocks[0].deps).toContain('function helper');
    expect(blocks[0].deps).toContain('function addData');
  });
  
  it('should handle multiple server blocks with shared dependencies', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const state = { count: 0 };
      
      function increment() {
        state.count++;
        return state;
      }
      
      function decrement() {
        state.count--;
        return state;
      }
      
      export default function Component() {
        return (
          <div>
            <button onClick={() => $.server(() => state)}>Get</button>
            <button onClick={() => $.server(() => increment())}>+</button>
            <button onClick={() => $.server(() => decrement())}>-</button>
          </div>
        );
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(3);
    
    // All blocks should reference the same shared state
    blocks.forEach(block => {
      expect(block.deps).toContain('const state');
      expect(block.deps).toContain('count: 0');
    });
    
    // Each should have the functions they need
    expect(blocks[1].deps).toContain('function increment');
    expect(blocks[2].deps).toContain('function decrement');
  });
  
  it('should only extract program-level dependencies, not component-level', () => {
    const code = `
      import { $ } from '@singulo/core';
      
      const globalData = [];
      
      export default function Component() {
        const localData = []; // Should NOT be extracted
        
        return (
          <button onClick={() => $.server(() => globalData)}>Get</button>
        );
      }
    `;
    
    const blocks = transformServer(code, 'test.singulo.tsx');
    
    expect(blocks).toHaveLength(1);
    expect(blocks[0].deps).toContain('const globalData = []');
    expect(blocks[0].deps).not.toContain('localData');
  });
});
