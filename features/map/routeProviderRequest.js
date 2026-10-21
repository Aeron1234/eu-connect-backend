// Deadlines cover queueing, connection establishment, and response-body reads.
export function createRouteProviderRequester({ timeoutMs = 15000, intervalMs = 1100, maxPending = 10 } = {}) {
  let queue = Promise.resolve(), nextAt = 0, queued = 0;
  const failure = (message, status, code) => Object.assign(new Error(message), { status, code });
  return async function request(path, fetcher, baseUrl) {
    if (queued >= maxPending) throw failure('Routing is busy. Wait a moment and try again, or use Google Maps.', 503, 'ROUTING_BUSY');
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password) throw failure('The routing service is not configured correctly.', 503, 'ROUTING_CONFIGURATION');
    queued++;
    const controller = new AbortController();
    let timer;
    const timeoutError = failure('The routing service did not respond in time. Try again or use Google Maps.', 504, 'ROUTING_TIMEOUT');
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(timeoutError); reject(timeoutError); }, timeoutMs); });
    const operation = queue.catch(() => {}).then(async () => {
      if (controller.signal.aborted) throw timeoutError;
      const wait = nextAt - Date.now();
      if (wait > 0) {
        const { setTimeout: delay } = await import('node:timers/promises');
        await delay(wait, undefined, { signal: controller.signal });
      }
      if (controller.signal.aborted) throw timeoutError;
      nextAt = Date.now() + intervalMs;
      const response = await fetcher(new URL(path, base.toString().replace(/\/?$/, '/')), {
        signal: controller.signal,
        headers: { 'User-Agent': 'EU-Connect/1.0 (internship visit planning)', Accept: 'application/json' },
      });
      if (!response.ok) throw failure('The routing service is unavailable. Try again or use Google Maps.', 503, 'ROUTING_UNAVAILABLE');
      const result = await response.json();
      if (result.code === 'NoRoute' || result.code === 'NoSegment') throw failure('No connected driving route was found. Try Google Maps directions.', 422, 'ROUTING_NO_ROUTE');
      if (result.code !== 'Ok') throw failure('The routing service could not calculate this route. Try Google Maps.', 503, 'ROUTING_UNAVAILABLE');
      return result;
    });
    // Even an adapter that ignores abort cannot block all subsequent requests.
    const bounded = Promise.race([operation, deadline]);
    queue = bounded.catch(() => {});
    try { return await bounded; }
    catch (error) {
      if (controller.signal.aborted) throw timeoutError;
      if (error.status) throw error;
      throw failure('Could not connect to the routing service. Try again or use Google Maps.', 503, 'ROUTING_UNAVAILABLE');
    } finally { clearTimeout(timer); queued--; }
  };
}
