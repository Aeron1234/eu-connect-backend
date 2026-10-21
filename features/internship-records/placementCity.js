// Optional for older API clients. New forms supply both fields.
export function readPlacementCity(body = {}) {
  const values = {};
  for (const key of ['city_name', 'province_name']) {
    const value = body[key];
    if (value != null && (typeof value !== 'string' || value.trim().length > 100 || /[\x00-\x1f]/.test(value))) {
      return { error: 'City and province must be text of at most 100 characters.' };
    }
    values[key] = value?.trim().replace(/\s+/g, ' ') || null;
  }
  if (Boolean(values.city_name) !== Boolean(values.province_name)) return { error: 'Enter both the city/municipality and province (Metro Manila for NCR).' };
  return { fields: values };
}
