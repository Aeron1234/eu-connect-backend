import { v4 as uuidv4 } from "uuid";

/**
 * Calculates distance between two coordinates and checks if it's within radius.
 *
 * @param {number|string} lat1 - Student's current latitude
 * @param {number|string} lon1 - Student's current longitude
 * @param {number|string} lat2 - Required DTR target latitude
 * @param {number|string} lon2 - Required DTR target longitude
 * @param {number} radiusMeters - Allowed radius from dtr_locations (e.g. 100)
 * @returns {{ isWithin: boolean, distanceMeters: number }}
 */
export function isWithinRadius(lat1, lon1, lat2, lon2, radiusMeters = 100) {
  // Convert string inputs to numbers to prevent string concatenation bugs
  const userLat = Number(lat1);
  const userLon = Number(lon1);
  const targetLat = Number(lat2);
  const targetLon = Number(lon2);

  const R = 6371000; // Earth's mean radius in meters
  const toRad = Math.PI / 180;

  const dLat = (targetLat - userLat) * toRad;
  const dLon = (targetLon - userLon) * toRad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(userLat * toRad) *
      Math.cos(targetLat * toRad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = Math.round(R * c); // Distance rounded to nearest meter

  return {
    isWithin: distanceMeters <= Number(radiusMeters),
    distanceMeters,
  };
}

export function newUUID() {
  return uuidv4();
}
