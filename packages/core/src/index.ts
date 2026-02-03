export interface SinguloContext {
  request: Request;
  response: {
    download: (data: any, options: { fileName: string }) => Response;
  };
  params: Record<string, string>;
}

// Global context holder (will be populated by the runtime)
export const globalContext: { current: SinguloContext | null } = { current: null };

export * from './bootstrap';
// The $ function acts as the server block definition
interface Singulo {
    <T, Args extends any[] = []>(
        callback: (...args: Args) => T | Promise<T>, 
        args?: Args
    ): Promise<T>;
    
    stream: <T>(promises: Record<string, Promise<T>>) => Record<string, Promise<T>>;
    readonly request: Request;
    readonly response: { download: (data: any, options: { fileName: string }) => Response };
    readonly params: Record<string, string>;
}

const $: Singulo = Object.assign(
    async <T, Args extends any[] = []>(
        callback: (...args: Args) => T | Promise<T>, 
        args?: Args
    ): Promise<T> => {
        return callback(...(args || [] as any));
    },
    {
        stream: <T>(promises: Record<string, Promise<T>>) => {
            return promises;
        },
        get request() {
            if (!globalContext.current) {
                // On the client side, this will be undefined
                // The transform replaces $() calls with createRpcClient, so this should never be accessed
                return undefined as any;
            }
            return globalContext.current.request;
        },
        get response() {
            if (!globalContext.current) {
                return undefined as any;
            }
            return globalContext.current.response;
        },
        get params() {
            if (!globalContext.current) {
                return undefined as any;
            }
            return globalContext.current.params;
        }
    }
);

export default $;
