// Both the profile editor and bulk page write the same per-internship geofence.
// The database's VARCHAR(255) fields and the existing editor's radius limits apply.
export function validateDtrLocation(body = {}) {
  const numeric = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value));
  if (!numeric(body.lat) || !numeric(body.lon)) throw Object.assign(new Error('Select a valid location on the map.'), { status: 400 });
  const lat = Number(body.lat), lon = Number(body.lon);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw Object.assign(new Error('Coordinates are outside the valid range.'), { status: 400 });
  const radius = body.radius_meter == null ? 150 : Number(body.radius_meter);
  if (!Number.isInteger(radius) || radius < 20 || radius > 2000) throw Object.assign(new Error('Radius must be a whole number from 20 to 2,000 meters.'), { status: 400 });
  const fields = {};
  for (const key of ['label', 'address']) {
    if (body[key] != null && (typeof body[key] !== 'string' || body[key].trim().length > 255)) throw Object.assign(new Error(`${key === 'label' ? 'Note' : 'Address'} must be text of at most 255 characters.`), { status: 400 });
    fields[key] = body[key]?.trim() || null;
  }
  return { lat: Number(lat.toFixed(8)), lon: Number(lon.toFixed(8)), radius_meters: radius, ...fields };
}

export function sameDtrLocation(row, location) {
  return row.location_id != null && ['lat', 'lon', 'radius_meters'].every(key => Number(row[key]) === location[key]) &&
    ['label', 'address'].every(key => (row[key] || null) === location[key]);
}

// Membership is derived from overrides, never a separate group/recipient table.
export function groupDtrLocations(students) {
  const groups = new Map();
  for (const student of students) {
    if (!student.location) continue;
    const { lat, lon } = student.location;
    const key = `${Number(lat).toFixed(8)},${Number(lon).toFixed(8)}`;
    if (!groups.has(key)) groups.set(key, { key, lat, lon, address: student.location.address, students: [] });
    groups.get(key).students.push(student);
  }
  return [...groups.values()];
}
