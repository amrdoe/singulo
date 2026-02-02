
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRpcClient } from './client';

// Mock fetch
global.fetch = vi.fn();

// Mock TextDecoder because jsdom/node environment might need polyfills in some test setups, 
// strictly strictly speaking standard node has it.
// mocking ReadableStream is tricky.

function mockStreamResponse(events: any[]) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            setTimeout(() => {
                events.forEach(event => {
                    const data = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                });
                controller.close();
            }, 0);
        }
    });

    return {
        headers: {
            get: (name: string) => name === 'Content-Type' ? 'text/event-stream' : null
        },
        body: {
            getReader: () => stream.getReader()
        }
    };
}

describe('Observable RPC Runtime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle standard JSON response', async () => {
        (global.fetch as any).mockResolvedValue({
            headers: { get: () => 'application/json' },
            json: async () => ({ foo: 'bar' })
        });

        const result = await createRpcClient('test.ts', 0);
        expect(result).toEqual({ foo: 'bar' });
    });

    it('should handle Observable response (Server -> Client)', async () => {
        const events = [
            { type: 'init', subscriptionId: 'sub-1' },
            { type: 'next', value: 1 },
            { type: 'next', value: 2 },
            { type: 'complete' }
        ];

        (global.fetch as any).mockResolvedValue(mockStreamResponse(events));

        const client = await createRpcClient('test.ts', 1);
        // It is async because the initial fetch is async, but createRpcClient returns the PROMISE of the result properly?
        // Wait, createRpcClient returns Promise<any> | Observable.
        // But fetch is async.
        // So createRpcClient returns Promise<Any | Observable>. 
        // My implementation returns a Promise that resolves to EITHER json OR the StreamClient (which implements Observable).
        
        // So:
        const observable = await client;
        expect(observable.subscribe).toBeDefined();

        const received: any[] = [];
        await new Promise<void>((resolve) => {
            observable.subscribe(
                (val: any) => received.push(val),
                null,
                () => resolve()
            );
        });

        expect(received).toEqual([1, 2]);
    });

    it('should handle bidirectional communication (Client -> Server)', async () => {
         const events = [
            { type: 'init', subscriptionId: 'sub-bi' },
            // Keep stream open ideally, but for this mock it closes.
            // In real app, stream stays open.
        ];
        
        // We need a stream that doesn't close immediately to test "push" before close
        let controller: ReadableStreamDefaultController;
        const stream = new ReadableStream({
            start(c) { controller = c; }
        });
        
        (global.fetch as any).mockImplementation((url: string) => {
            if (url === '/_singulo/rpc') {
                return Promise.resolve({
                    headers: { get: () => 'text/event-stream' },
                    body: { getReader: () => stream.getReader() }
                });
            } else if (url === '/_singulo/rpc/push') {
                return Promise.resolve({ ok: true });
            }
            return Promise.reject('Unknown url');
        });

        const observable = await createRpcClient('test.ts', 2);
        
        // 1. Receive init
        const encoder = new TextEncoder();
        controller!.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'init', subscriptionId: 'sub-bi' })}\n\n`));
        
        // Wait a tick for processing
        await new Promise(r => setTimeout(r, 0));
        
        // 2. Client pushes
        observable.next('hello server');
        
        expect(global.fetch).toHaveBeenCalledWith('/_singulo/rpc/push', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ subscriptionId: 'sub-bi', value: 'hello server' })
        }));
        
        controller!.close();
    });
});
