import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { db } from "../config/db.js";
import { drivingRoute, mapsDirections, mapOrigin, validMapPoint, resetRoutingCacheForTests } from "../features/map/mapRouting.js";
import { getMapCompanyRoute } from "../features/map/controllers/mapRoutingControllers.js";
process.env.ACCESS_TOKEN_SECRET = "map-routing-test";
const { default: routes } = await import("../features/map/routes/mapRoutes.js");
const { signAccessToken } = await import("../config/jwt.js");
const original = { execute: db.execute, fetch: globalThis.fetch, lat: process.env.MAP_ORIGIN_LAT, lng: process.env.MAP_ORIGIN_LNG, base: process.env.MAP_ROUTING_BASE_URL };
beforeEach(() => { resetRoutingCacheForTests(); delete process.env.MAP_ORIGIN_LAT; delete process.env.MAP_ORIGIN_LNG; delete process.env.MAP_ROUTING_BASE_URL; });
after(async () => {
  db.execute = original.execute; globalThis.fetch = original.fetch;
  for (const [key, value] of [["MAP_ORIGIN_LAT", original.lat], ["MAP_ORIGIN_LNG", original.lng], ["MAP_ROUTING_BASE_URL", original.base]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await db.end();
});
const payload = { code: "Ok", routes: [{ distance: 30000, duration: 1800, geometry: { coordinates: [[121.4312752, 13.9304557], [121.6, 13.94]] } }] };
const response = () => ({ statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("routing uses geographic coordinate order, shares concurrent requests, and caches successful road geometry", async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.match(url.pathname, /route\/v1\/driving\/121\.4312752,13\.9304557;121\.6,13\.94$/);
    assert.equal(url.searchParams.get("geometries"), "geojson");
    assert.equal(url.searchParams.get("steps"), "false"); assert(options.signal);
    assert(!url.toString().includes("student"));
    return { ok: true, json: async () => payload };
  };
  const destination = { lat: 13.94, lng: 121.6 };
  const [first, second] = await Promise.all([drivingRoute(destination, { fetcher }), drivingRoute(destination, { fetcher })]);
  assert.equal(calls, 1); assert.deepEqual(first, second);
  assert.equal(first.geometry.type, "LineString"); assert.equal(first.distance_meters, 30000);
  assert.equal(first.duration_seconds, 1800);
  await drivingRoute(destination, { fetcher }); assert.equal(calls, 1);
  const url = new URL(first.google_maps_url); assert.equal(url.searchParams.get("origin"), "13.9304557,121.4312752");
  assert.equal(url.searchParams.get("destination"), "13.94,121.6");
});

test("routing failures, disconnected roads and malformed geometry do not become cached successful routes", async () => {
  for (const data of [{ code: "NoRoute" }, { code: "Ok", routes: [] }, { code: "Ok", routes: [{ ...payload.routes[0], duration: -1 }] },
    { code: "Ok", routes: [{ ...payload.routes[0], geometry: { coordinates: [[null, null], [121, 13]] } }] }]) {
    resetRoutingCacheForTests();
    await assert.rejects(drivingRoute({ lat: 13.94, lng: 121.6 }, { fetcher: async () => ({ ok: true, json: async () => data }) }));
    let called = false;
    await drivingRoute({ lat: 13.94, lng: 121.6 }, { fetcher: async () => { called = true; return { ok: true, json: async () => payload }; } });
    assert(called);
  }
});

test("route requests recheck ongoing company coordinates even when road geometry is already cached", async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  let reads = 0, record = { lat: 13.94, lon: 121.6 };
  db.execute = async (sql, params) => {
    reads++; assert.match(sql, /status = 'ongoing' AND deleted_at IS NULL/); assert.deepEqual(params, ["internship"]);
    return [record ? [record] : []];
  };
  const req = { verifiedUser: { role: "department_head" }, params: { internshipId: "internship" } };
  let res = response(); await getMapCompanyRoute(req, res); assert.equal(res.statusCode, 200);
  record = null; res = response(); await getMapCompanyRoute(req, res); assert.equal(res.statusCode, 404); assert.equal(reads, 2);
  record = { lat: null, lon: null }; res = response(); await getMapCompanyRoute(req, res); assert.equal(res.statusCode, 422);
});

test("a provider outage returns a Google Maps backup without exposing internal errors", async () => {
  db.execute = async () => [[{ lat: 13.94, lon: 121.6 }]];
  globalThis.fetch = async () => { throw Error("Internal provider credentials must stay hidden"); };
  const res = response(); await getMapCompanyRoute({ verifiedUser: { role: "admin" }, params: { internshipId: "internship" } }, res);
  assert.equal(res.statusCode, 503); assert(res.body.google_maps_url.startsWith("https://www.google.com/maps/dir/"));
  assert(!res.body.error.includes("credentials"));
});

test("origin configuration and Google directions validate coordinates without accepting arbitrary provider URLs", () => {
  for (const [lat, lng] of [[null, null], ["", ""], [91, 121], [13, 181], ["NaN", 121]]) assert.equal(validMapPoint(lat, lng), null);
  process.env.MAP_ORIGIN_LAT = "13.93"; process.env.MAP_ORIGIN_LNG = "121.42";
  assert.equal(mapOrigin().lat, 13.93);
  const url = new URL(mapsDirections({ lat: 14, lng: 121 })); assert.equal(url.searchParams.get("origin"), "13.93,121.42");
});

test("HTTP route guards deny students, employers and missing authentication before reading locations", async t => {
  let reads = 0; db.execute = async () => { reads++; throw Error("No unauthorized queries"); };
  const app = express(); app.use("/api/v1", routes);
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  for (const role of [null, "student", "employer"]) {
    const res = await original.fetch(`http://127.0.0.1:${server.address().port}/api/v1/student-map/route/internship`, { headers: role ? { Authorization: `Bearer ${signAccessToken({ id: role, role })}` } : {} });
    assert.equal(res.status, role ? 403 : 401);
  }
  assert.equal(reads, 0);
});

test("routes accept validated current-location origins and keep Google Maps backup consistent", async () => {
  db.execute = async () => [[{ lat: 13.94, lon: 121.6 }]];
  let providerCalls = 0;
  globalThis.fetch = async (url) => { providerCalls++; assert.match(url.pathname, /121.5,14;121.6,13.94$/); return { ok: true, json: async () => payload }; };
  const req = { verifiedUser: { role: "admin" }, params: { internshipId: "internship" }, query: { origin_lat: "14", origin_lng: "121.5" } };
  const res = response(); await getMapCompanyRoute(req, res); assert.equal(res.statusCode, 200); assert.equal(res.body.origin.label, "Your current location");
  assert.equal(new URL(res.body.google_maps_url).searchParams.get("origin"), "14,121.5");
  await getMapCompanyRoute(req, response()); assert.equal(providerCalls, 2, "live viewer routes must not remain in the shared cache");
  globalThis.fetch = async () => { throw Error("outage"); };
  const failed = response(); await getMapCompanyRoute(req, failed); assert.equal(failed.statusCode, 503);
  assert.equal(new URL(failed.body.google_maps_url).searchParams.get("origin"), "14,121.5");
});

test("partial and invalid origins are rejected before reading internship data", async () => {
  let reads = 0; db.execute = async () => { reads++; return [[]]; };
  for (const query of [{ origin_lat: "14" }, { origin_lng: "121" }, { origin_lat: " ", origin_lng: "121" }, { origin_lat: "91", origin_lng: "121" }, { origin_lat: ["14", "15"], origin_lng: "121" }]) {
    const res = response(); await getMapCompanyRoute({ verifiedUser: { role: "admin" }, params: { internshipId: "internship" }, query }, res); assert.equal(res.statusCode, 400);
  }
  assert.equal(reads, 0);
});

test("public browser preparation verifies the current record without contacting the provider", async () => {
  let reads = 0, upstream = 0;
  db.execute = async () => { reads++; return [[{ lat: 14.5995, lon: 120.9842 }]]; };
  globalThis.fetch = async () => { upstream++; throw Error("Node cannot connect"); };
  const res = response(); await getMapCompanyRoute({ verifiedUser: { role: "admin" }, params: { internshipId: "record" }, query: { prepare: "1" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.client_route, true); assert.equal(reads, 1); assert.equal(upstream, 0);
  assert.deepEqual(res.body.destination, { lat: 14.5995, lng: 120.9842 }); assert.equal(res.body.origin.lat, 13.9304557);
});

test("private providers stay server-side even if browser preparation was requested", async () => {
  process.env.MAP_ROUTING_BASE_URL = "https://private.example.test/routing/";
  db.execute = async () => [[{ lat: 13.94, lon: 121.6 }]];
  globalThis.fetch = async url => { assert.equal(url.hostname, "private.example.test"); return { ok: true, json: async () => payload }; };
  const res = response(); await getMapCompanyRoute({ verifiedUser: { role: "admin" }, params: { internshipId: "record" }, query: { prepare: "1" } }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.client_route, undefined); assert.equal(res.body.geometry.type, "LineString"); assert(!JSON.stringify(res.body).includes("private.example"));
});
