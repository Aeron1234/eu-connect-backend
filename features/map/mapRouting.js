import { createRouteProviderRequester } from "./routeProviderRequest.js";

const DEFAULT_ORIGIN = { lat: 13.9304557, lng: 121.4312752, label: "MSEUF–Candelaria" };
const TTL = 24 * 60 * 60_000;
const MAX_CACHE = 200;
const cache = new Map();
const pending = new Map();
let requestRouteProvider = createRouteProviderRequester();

export function validMapPoint(lat, lng) {
  if ([lat, lng].some(value => !["string", "number"].includes(typeof value) || String(value).trim() === "")) return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
}

export function mapOrigin() {
  const configured = validMapPoint(process.env.MAP_ORIGIN_LAT, process.env.MAP_ORIGIN_LNG);
  return { ...DEFAULT_ORIGIN, ...configured };
}

export function mapsDirections(destination, origin = mapOrigin()) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({ api: "1", origin: `${origin.lat},${origin.lng}`, destination: `${destination.lat},${destination.lng}`, travelmode: "driving" });
  return url.toString();
}

function routingError(message = "Road routing is temporarily unavailable. You can still open Google Maps directions.", status = 503) {
  return Object.assign(new Error(message), { status });
}

async function requestProvider(path, fetcher) {
  return requestRouteProvider(path, fetcher, process.env.MAP_ROUTING_BASE_URL || "https://routing.openstreetmap.de/routed-car/");
}

async function remembered(key, operation) {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  if (pending.has(key)) return pending.get(key);
  const promise = operation().then(value => {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + TTL });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export async function drivingRoute(destination, { fetcher = fetch, origin: requestedOrigin } = {}) {
  const point = requestedOrigin && validMapPoint(requestedOrigin.lat, requestedOrigin.lng);
  if (requestedOrigin && !point) throw routingError("A valid starting location is required.", 400);
  const origin = requestedOrigin ? { ...point, label: "Your current location" } : mapOrigin();
  const coordinates = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const key = `route:${process.env.MAP_ROUTING_BASE_URL || "default"}:${coordinates}`;
  const calculate = async () => {
    try {
      const data = await requestProvider(`route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, fetcher);
      const route = data.routes?.[0];
      const points = route?.geometry?.coordinates;
      if (!Array.isArray(points) || points.length < 2 || points.length > 100_000 ||
          points.some(point => !Array.isArray(point) || !validMapPoint(point[1], point[0])) ||
          !Number.isFinite(route.distance) || !Number.isFinite(route.duration) || route.distance < 0 || route.duration < 0) throw routingError();
      return {
        origin, destination, geometry: { type: "LineString", coordinates: points },
        distance_meters: route.distance, duration_seconds: route.duration,
        google_maps_url: mapsDirections(destination, origin),
        attribution: "Routing: OSRM / FOSSGIS · OpenStreetMap contributors",
      };
    } catch (error) {
      if (error.status) throw error;
      throw routingError();
    }
  };
  // Do not retain routes containing a viewer's current position in the shared cache.
  return requestedOrigin ? calculate() : remembered(key, calculate);
}

export function resetRoutingCacheForTests() {
  cache.clear(); pending.clear(); requestRouteProvider = createRouteProviderRequester();
}
