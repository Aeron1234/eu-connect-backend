import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMapLocationSocket } from '../features/map/mapLocationSockets.js';

function fixture(role = 'department_head', databaseOverride) {
  const listeners = new Map(), events = []; let time = 100000, reads = 0;
  const socket = { data: { userId: 'head' }, connected: true, on: (event, fn) => listeners.set(event, fn), emit: (event, payload) => events.push({ event, payload }) };
  const database = databaseOverride || { execute: async (sql, params) => { reads++; assert.deepEqual(params, ['head']); assert.match(sql, /^SELECT/); return [[{ role }]]; } };
  attachMapLocationSocket(socket, { database, now: () => time });
  return { socket, listeners, events, reads: () => reads, advance: ms => { time += ms; }, request: value => new Promise(resolve => listeners.get('map_location:update')(value, resolve)) };
}
const position = () => ({ latitude: 13.94, longitude: 121.61, accuracy: 10, timestamp: 100000, sessionId: 'map-session' });

test('viewer location echoes only to the authenticated staff socket without database writes', async () => {
  const view = fixture(); assert.equal((await view.request(position())).ok, true);
  assert.equal(view.events.length, 1); assert.equal(view.events[0].event, 'map_location:position'); assert.equal(view.events[0].payload.sessionId, 'map-session');
  assert.equal(view.events[0].payload.location.latitude, 13.94); assert.equal(view.reads(), 1);
});

test('student and employer sockets cannot publish viewer map locations', async () => {
  for (const role of ['student', 'employer']) { const view = fixture(role); assert.equal((await view.request(position())).ok, false); assert.equal(view.events.length, 0); }
  const anonymous = fixture(); delete anonymous.socket.data.userId; assert.equal((await anonymous.request(position())).ok, false); assert.equal(anonymous.reads(), 0);
});

test('invalid, stale and excessive socket updates are rejected before authorization queries', async () => {
  const view = fixture();
  for (const patch of [{ latitude: '13' }, { longitude: 181 }, { accuracy: -1 }, { timestamp: 1 }, { timestamp: 200000 }, { sessionId: '<invalid>' }]) assert.equal((await view.request({ ...position(), ...patch })).ok, false);
  assert.equal(view.reads(), 0); assert.equal((await view.request(position())).ok, true);
  assert.equal((await view.request(position())).ok, false); assert.equal(view.reads(), 1);
});

test('stopping or disconnecting cancels an authorization request still in flight', async () => {
  for (const event of ['map_location:stop', 'disconnect']) {
    let resolve; const view = fixture('admin', { execute: () => new Promise(done => { resolve = done; }) });
    const pending = view.request(position()); view.listeners.get(event)(); resolve([[{ role: 'admin' }]]);
    assert.equal((await pending).ok, false); assert.equal(view.events.length, 0);
  }
});
