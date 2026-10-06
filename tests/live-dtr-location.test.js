import assert from "node:assert/strict";
import { test } from "node:test";
import { createLiveDtrLocationService } from "../config/liveDtrLocation.js";

function setup(ttlMs = 60_000) {
  const users = new Map([
    ["student", "student"], ["employer", "employer"], ["other-employer", "employer"],
    ["head", "department_head"], ["other-head", "department_head"], ["admin", "admin"],
  ]);
  const database = {
    async execute(sql, params) {
      if (sql.includes("FROM users u")) return [[{ role: users.get(params[0]) }]];
      if (sql.includes("SELECT id FROM internship_records")) return [[{ id: "internship" }]];
      if (sql.includes("SELECT ir.employer_id")) {
        if (params[1] !== "internship" || params[2] !== "student") return [[]];
        return [[{ employer_id: "employer", department_id: 7,
          head_department_id: params[0] === "head" ? 7 : 8 }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const sockets = [];
  const io = {
    to(room) {
      return { emit(event, payload) {
        for (const socket of sockets) {
          if (socket.rooms.has(room)) socket.received.push({ event, payload });
        }
      } };
    },
  };
  const attach = createLiveDtrLocationService({ database, ttlMs });
  function connect(id) {
    const socket = {
      id, data: { userId: id }, connected: true,
      rooms: new Set(), listeners: new Map(), received: [],
      join(room) { this.rooms.add(room); },
      leave(room) { this.rooms.delete(room); },
      on(event, handler) { this.listeners.set(event, handler); },
      async request(event, payload) {
        return new Promise((resolve) => this.listeners.get(event)(payload, resolve));
      },
      send(event) { this.listeners.get(event)(); },
    };
    sockets.push(socket);
    attach(io, socket);
    return socket;
  }
  return { connect };
}

const position = () => ({ latitude: 13.93, longitude: 121.42, accuracy: 25, timestamp: Date.now() });
const request = { studentId: "student", internshipId: "internship" };

test("only the student's authorized staff can receive a temporary position", async () => {
  const { connect } = setup();
  const student = connect("student");
  const employer = connect("employer");
  const head = connect("head");
  const admin = connect("admin");
  const outsider = connect("other-employer");
  const wrongHead = connect("other-head");

  assert.equal((await outsider.request("dtr_location:watch", request)).ok, false);
  assert.equal((await wrongHead.request("dtr_location:watch", request)).ok, false);
  for (const viewer of [employer, head, admin]) {
    assert.deepEqual(await viewer.request("dtr_location:watch", request), { ok: true, location: null });
  }
  assert.equal((await student.request("dtr_location:share", position())).ok, true);
  for (const viewer of [employer, head, admin]) {
    assert.equal(viewer.received.at(-1).payload.location.latitude, 13.93);
  }
  assert.equal(outsider.received.length, 0);
  assert.equal(wrongHead.received.length, 0);
  assert.equal((await employer.request("dtr_location:watch", request)).location.accuracy, 25);
  student.send("dtr_location:stop");
  assert.equal(employer.received.at(-1).payload.location, null);
  assert.deepEqual(await employer.request("dtr_location:watch", request), { ok: true, location: null });
});

test("invalid locations and non-student publishers are rejected", async () => {
  const { connect } = setup();
  const student = connect("student");
  const employer = connect("employer");
  assert.equal((await student.request("dtr_location:share", { ...position(), accuracy: -1 })).ok, false);
  assert.equal((await student.request("dtr_location:share", { ...position(), timestamp: Date.now() - 120_000 })).ok, false);
  assert.equal((await employer.request("dtr_location:share", position())).ok, false);
});

test("shared position expires and clears staff pins", async () => {
  const { connect } = setup(15);
  const student = connect("student");
  const employer = connect("employer");
  await employer.request("dtr_location:watch", request);
  assert.equal((await student.request("dtr_location:share", position())).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(employer.received.at(-1).payload.location, null);
  assert.deepEqual(await employer.request("dtr_location:watch", request), { ok: true, location: null });
});

test("stopping sharing cancels an authorization query still in flight", async () => {
  let finishRoleLookup;
  const database = {
    async execute(sql) {
      if (sql.includes("FROM users u")) {
        await new Promise((resolve) => { finishRoleLookup = resolve; });
        return [[{ role: "student" }]];
      }
      return [[{ id: "internship" }]];
    },
  };
  const sent = [];
  const io = { to() { return { emit(_event, payload) { sent.push(payload); } }; } };
  const socket = {
    id: "student-socket", data: { userId: "student" }, connected: true,
    listeners: new Map(),
    on(event, handler) { this.listeners.set(event, handler); },
  };
  createLiveDtrLocationService({ database })(io, socket);
  const pending = new Promise((resolve) => socket.listeners.get("dtr_location:share")(position(), resolve));
  socket.listeners.get("dtr_location:stop")();
  finishRoleLookup();
  assert.equal((await pending).ok, false);
  assert.equal(sent.length, 0);
});
