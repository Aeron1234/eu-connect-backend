// Bound Supabase Storage I/O, including reading the response body. Other
// Supabase services retain their existing behavior. Caller cancellation is preserved.
export function createStorageFetch(fetcher = fetch, { timeoutMs = 45000, deleteTimeoutMs = 10000 } = {}) {
  return (input, options = {}) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (!new URL(url).pathname.startsWith('/storage/v1/')) return fetcher(input, options);
    const method = (options.method || input.method || 'GET').toUpperCase();
    const timeout = AbortSignal.timeout(method === 'DELETE' ? deleteTimeoutMs : timeoutMs);
    const caller = options.signal || (typeof input === 'object' ? input.signal : null);
    return fetcher(input, { ...options, signal: caller ? AbortSignal.any([caller, timeout]) : timeout });
  };
}
