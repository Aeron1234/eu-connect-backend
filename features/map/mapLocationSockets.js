import { db } from '../../config/db.js';

export function attachMapLocationSocket(socket, { database = db, now = Date.now } = {}) {
  let generation = 0, lastUpdate = -Infinity;
  socket.on('map_location:update', async (value, reply) => {
    const ack = typeof reply === 'function' ? reply : () => {};
    const receivedAt = now();
    if (!socket.data.userId || !value || typeof value.sessionId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value.sessionId) ||
        typeof value.latitude !== 'number' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 ||
        typeof value.longitude !== 'number' || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180 ||
        typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 100000 ||
        !Number.isFinite(value.timestamp) || value.timestamp < receivedAt - 30000 || value.timestamp > receivedAt + 5000 || receivedAt - lastUpdate < 3000) {
      return ack({ ok: false, error: 'Invalid or too frequent map location update.' });
    }
    lastUpdate = receivedAt;
    const version = ++generation;
    try {
      const [[user]] = await database.execute('SELECT r.role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? LIMIT 1', [socket.data.userId]);
      if (!['admin', 'department_head'].includes(user?.role)) return ack({ ok: false, error: 'Access denied.' });
      if (version !== generation || !socket.connected || value.timestamp < now() - 30000) return ack({ ok: false });
      // Echo only to this authenticated socket. No room broadcast, history or database write.
      const location = { latitude: value.latitude, longitude: value.longitude, accuracy: value.accuracy, timestamp: value.timestamp };
      socket.emit('map_location:position', { sessionId: value.sessionId, location });
      ack({ ok: true });
    } catch { ack({ ok: false, error: 'Live location connection is temporarily unavailable.' }); }
  });
  socket.on('map_location:stop', () => { generation++; });
  socket.on('disconnect', () => { generation++; });
}

export function registerMapLocationSockets(io) {
  // Called after registerNotificationSockets has installed ticket authentication.
  io.on('connection', socket => attachMapLocationSocket(socket));
}
