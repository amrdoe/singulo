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
export const $ = {
  // Client-side: This will be stripped and replaced by an RPC call.
  // Server-side: This executes the callback.
  server: async <T, Args extends any[] = []>(
    callback: (...args: Args) => T | Promise<T>, 
    args?: Args
  ): Promise<T> => {
    return callback(...(args || [] as any));
  },

  stream: <T>(promises: Record<string, Promise<T>>) => {
    // Basic implementation: just return a structured object for now.
    // In a real implementation, this would handle the streaming protocol.
    return promises;
  },

  get request() {
    if (!globalContext.current) throw new Error("$.request accessed outside of request context");
    return globalContext.current.request;
  },

  get response() {
    if (!globalContext.current) throw new Error("$.response accessed outside of request context");
    return globalContext.current.response;
  },
  
  get params() {
     if (!globalContext.current) throw new Error("$.params accessed outside of request context");
     return globalContext.current.params;
  }
};
