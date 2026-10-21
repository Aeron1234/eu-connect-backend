import { db } from "../../../config/db.js";
import { drivingRoute, mapsDirections, mapOrigin, validMapPoint } from "../mapRouting.js";

export async function getMapCompanyRoute(req, res) {
  if (!["admin", "department_head"].includes(req.verifiedUser?.role)) return res.status(403).json({ error: "Access denied." });
  const internshipId = req.params.internshipId;
  if (typeof internshipId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(internshipId)) return res.status(400).json({ error: "A valid internship record is required." });
  let destination;
  const { origin_lat, origin_lng } = req.query || {};
  const customOrigin = origin_lat !== undefined || origin_lng !== undefined;
  const point = customOrigin ? validMapPoint(origin_lat, origin_lng) : null;
  if (customOrigin && !point) return res.status(400).json({ error: "Provide valid latitude and longitude for the starting location." });
  const origin = point ? { ...point, label: "Your current location" } : mapOrigin();
  let stage = "database";
  try {
    // Resolve coordinates from the current record on every request, even if
    // the reusable road geometry is cached. Never accept a provider URL from clients.
    const [[record]] = await db.execute(
      `SELECT lat, lon FROM internship_records WHERE id = ? AND status = 'ongoing' AND deleted_at IS NULL LIMIT 1`,
      [internshipId],
    );
    if (!record) return res.status(404).json({ error: "Ongoing internship location not found." });
    destination = validMapPoint(record.lat, record.lon);
    if (!destination) return res.status(422).json({ error: "This company has no valid map coordinates." });
    // Public routing can run in the browser after this authenticated lookup.
    // Never expose custom routing endpoints or server credentials to the client.
    const publicBase = "https://routing.openstreetmap.de/routed-car";
    const configured = process.env.MAP_ROUTING_BASE_URL?.replace(/\/+$/, "");
    if (req.query?.prepare === "1" && (!configured || configured === publicBase)) {
      res.set("Cache-Control", "private, no-store");
      return res.json({ client_route: true, origin, destination, google_maps_url: mapsDirections(destination, origin) });
    }
    stage = "routing";
    const route = await drivingRoute(destination, point ? { origin: point } : {});
    res.set("Cache-Control", "private, no-store");
    return res.json(route);
  } catch (error) {
    res.set("Cache-Control", "private, no-store");
    return res.status(error.status || 503).json({
      error: error.status ? error.message : stage === "database" ? "Could not load the company location. Please try again." : "Road routing is temporarily unavailable. Try Google Maps directions.",
      code: error.code && error.status ? error.code : stage === "database" ? "MAP_DATA_UNAVAILABLE" : "ROUTING_UNAVAILABLE",
      ...(destination ? { google_maps_url: mapsDirections(destination, origin), origin } : {}),
    });
  }
}
