# Student map visit planning

The existing `GET /api/v1/student-map` remains available to admins and department heads across departments. Its company groups, student details, region filters and ongoing-record rules are unchanged. It also returns the visit `origin` used by routing and Google Maps links.

`GET /api/v1/student-map/route/:internshipId` resolves the current ongoing record's saved company coordinates before retrieving a driving route. The provider receives only coordinates. The result contains GeoJSON, distance in meters, estimated duration in seconds, the starting point and a Google Maps directions URL. Deleted, finished or missing records cannot use this endpoint.

The default provider is the FOSSGIS public OSRM car service. This is a shared, best-effort service with no availability guarantee. Calls are serialized at no more than one per 1.1 seconds per backend process, concurrent identical requests share a request, successful geometry is cached for 24 hours, and the cache and queue are bounded. Failed routes do not enter the cache. Google Maps directions remain available independently of the provider.

Optional backend environment settings:

```text
MAP_ORIGIN_LAT=13.931
MAP_ORIGIN_LNG=121.423
MAP_ROUTING_BASE_URL=https://routing.openstreetmap.de/routed-car/
```

The default starting coordinates reuse this project's existing Candelaria campus pin. Confirm the desired entrance before relying on precise arrival estimates. Both origin settings must be valid coordinates; otherwise the existing default is used. The routing base URL must be HTTPS and expose an OSRM-compatible `route/v1/driving/` API. It is controlled by the backend environment, never by request input. A dedicated provider is appropriate if usage grows or multiple API workers are deployed: the default public provider's rate limit applies across all workers sharing an outbound IP.

Display the route attribution and the OpenStreetMap report-a-map-issue link. Estimated travel time is not live traffic, a transport timetable or a guarantee that all island destinations have a connected driving route.

Routing itself requires no database migration. City grouping uses the migration described below.

## City grouping deployment

Run `scripts/2026-10-21-map-city-backfill.sql` **once, before deploying this backend**. It adds nullable city_name and province_name columns and classifies all 151 internship records in the supplied October 21 export into 19 cities/municipalities. The 23 address strings were mapped explicitly; no nearest-city guessing or external geocoder was used. Existing location coordinates, region IDs, student data, and internship statuses are not modified. Every update checks its record ID, exact exported address, and coordinates, and only fills empty classification fields. Locations changed since the export or records added afterwards remain unclassified for review. The final SELECTs report these records. The ALTER commits implicitly; back up first. Do not rerun the ALTER after the columns already exist.

Deploy backend after the SQL, then frontend. These columns are selected by /student-map and persisted on record create/pending edit, so deploying the backend before the migration would cause those operations to fail. No live migration has been run by Codex.

The Cities tab groups filtered ongoing company locations by city/municipality plus province (Metro Manila for NCR), including all departments. Counts use distinct student identity; company branches keep their existing pins and cards. Default sorting is most students, with most companies and city name options. Each company offers the existing road route from the campus and an independent Google Maps link; this is not a multi-stop itinerary optimizer. Missing city fields remain visible in an explicit unclassified group. Optional City prefixes/suffixes, accents, casing and whitespace are normalized for grouping; different provinces remain separate.

New student forms require city/municipality and province confirmation alongside the map address. Older API clients may omit both; new records then remain unclassified. Pending edits from older clients preserve classification only when the saved address and coordinates are unchanged, otherwise they clear it rather than carrying the old city to a new location. Backend checks types, length and paired values. This uses geographic labels rather than claiming verified PSGC codes. A full official locality catalog could replace text entry later.

Export review also found region mismatches (for example a Taguig address assigned region_id 4). These existing values were deliberately preserved; city classification uses the explicit address, not the region_id.

## Viewer location and recommendations

The map now has an opt-in Use my location control. A fresh device fix is requested every 10 seconds (HTTPS or localhost, browser permission required). Each fix is sent through the existing ticket-authenticated Socket.IO connection. The map_location:update event validates current staff role, bounds, accuracy, timestamp, session ID and a three-second minimum update interval, then sends map_location:position only to the same socket. It does not broadcast to other users or store positions in the database. Leaving the map, stopping or disconnecting cancels pending socket authorization work. Browser cleanup removes timers and listeners; fixes older than the session expiry disappear from the map. Device-only positioning remains available during socket outages.

Routes can use origin_lat and origin_lng on the existing company-route endpoint. The company destination and access rules are still resolved by the server. Live viewer routes bypass the shared server cache and their inactive React Query entries are discarded. The route origin updates after movement of at least 100 m and at least 30 seconds; the blue location pin updates with each fresh fix. Users can return to Candelaria at any time. API requests retrieve road geometry while WebSocket events update the viewer's position. The provider's existing queue and rate limits remain in force. Google Maps uses the same selected starting point. Locate me centers the map without continuously recentering while moving.

Recommended first visits appears below the unchanged search and region filters on every tab. It ranks classified cities by distinct student count across departments, breaks ties by straight-line proximity to the nearest company from the selected origin, then company count and city name. This is a student-coverage recommendation, not a shortest-road-trip claim. The distance is explicitly labeled straight-line, and the route action provides actual provider road distance/time. Recommendations consume the same filtered sites as the map and company list.

## Routing failures and visible feedback

Provider requests have a 15-second total deadline covering queue wait, connection and response-body reading. The Next server-action fetch has a 20-second deadline, and the client route query has a final 25-second guard. Timeout failures are not cached. The provider queue remains rate-limited; expired queued requests are cancelled before sending. A failed/aborted provider request cannot leave the queue permanently blocked.

Route errors distinguish ROUTING_TIMEOUT, ROUTING_BUSY, ROUTING_NO_ROUTE, and MAP_DATA_UNAVAILABLE. On mobile, loading/error/result controls remain below the map after the company drawer closes. Google Maps uses the same selected origin and destination even when the road provider is unreachable. The UI displays the safe API error rather than replacing every failure with a generic sentence. No straight-line geometry is substituted for a failed road route.

For the default public provider, the frontend now requests prepare=1. The API still checks staff access and resolves the current ongoing record before returning origin/destination and client_route=true. The browser then calls the fixed public OSRM endpoint with coordinates only and no cookies or Authorization header. This avoids environments where Node cannot reach that provider even though the user's browser can. Custom MAP_ROUTING_BASE_URL deployments continue to calculate server-side; private provider URLs are never returned to the browser. Default API calls without prepare retain their existing server-side behavior. Public browser calls are spaced by at least 1.1 seconds per tab, use the same 25-second deadline, validate geometry, and return explicit errors for CORS/network failures or disconnected routes. Routing providers can see the route coordinates they calculate, even though the application does not broadcast or persist viewer positions.
