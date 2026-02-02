import { Observable, Subscriber, Observer, TeardownLogic, Subject } from 'rxjs';

export function createRpcClient(fileId: string, blockIndex: number, args: any[] = []): Promise<any> | Observable<any> {
    const rpcUrl = '/_singulo/rpc';
    
    // Initial fetch to start the RPC
    const responsePromise = fetch(rpcUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            fileId,
            blockIndex,
            args
        })
    }).then(async (response) => {
        const contentType = response.headers.get('Content-Type');
        
        // Handle Event Stream (Observable)
        if (contentType && contentType.includes('text/event-stream')) {
             return new RpcChannel(response.body!.getReader());
        }
        
        // Handle standard JSON
        return response.json();
    });

    return responsePromise;
}

// A custom Subject that sends 'next' to server and feeds server events to subscribers
class RpcChannel<T> extends Subject<T> {
    private reader: ReadableStreamDefaultReader<Uint8Array>;
    private decoder = new TextDecoder();
    private buffer = '';
    private subscriptionId: string | null = null;
    
    constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
        super();
        this.reader = reader;
        this.readLoop(); // Start reading immediately (Hot)
    }

    // -- Observer Implementation (Upstream) --
    next(value: T) {
        if (this.subscriptionId) {
             fetch(`/_singulo/rpc/push`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                     subscriptionId: this.subscriptionId,
                     value
                 })
             }).catch(err => console.error("Failed to push to server", err));
        } else {
             console.warn("Cannot push to server, subscription not ready");
        }
    }

    // We don't override error/complete to send to server yet, 
    // but we could if the protocol supported it.

    // -- Internal Reading Loop --
    private async readLoop() {
        try {
            while (true) {
                // Check if we are closed? Subject doesn't strictly close source in this pattern
                // unless we manually check `this.closed`.
                if (this.closed) break;

                const { done, value } = await this.reader.read();
                if (done) break;
                
                this.buffer += this.decoder.decode(value, { stream: true });
                this.processBuffer();
            }
        } catch (e) {
            super.error(e);
        } finally {
            super.complete();
            // Cleanup on server
            this.notifyServerComplete();
        }
    }
    
    private notifyServerComplete() {
         if (this.subscriptionId) {
            fetch(`/_singulo/rpc/unsubscribe`, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ subscriptionId: this.subscriptionId })
            }).catch(() => {});
        }
    }

    private processBuffer() {
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const json = line.slice(6);
                try {
                    const event = JSON.parse(json);
                    
                    if (event.type === 'init') {
                        this.subscriptionId = event.subscriptionId;
                    } else if (event.type === 'next') {
                        super.next(event.value);
                    } else if (event.type === 'error') {
                        super.error(event.error);
                    } else if (event.type === 'complete') {
                        super.complete();
                    }
                } catch (e) {
                    console.error("Failed to parse SSE data", e);
                }
            }
        }
    }
    
    unsubscribe() {
        // When the subject is unsubscribed (actually Subject.unsubscribe marks it closed)
        // We should cancel the reader.
        super.unsubscribe();
        this.reader.cancel();
        this.notifyServerComplete();
    }
}
