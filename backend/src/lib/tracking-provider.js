// Tracking provider abstraction (spec §14, §15, §43).
//
// A replaceable adapter for external vessel/container tracking. The business logic
// NEVER hard-codes a provider and NEVER fabricates tracking data: with no provider
// configured, every method honestly returns { available: false } with a reason.
//
// API keys are read from the environment on the SERVER only — never exposed to the
// client. To wire a real provider (MarineTraffic, VesselFinder, a shipping-line or
// forwarder API), implement its normaliser in makeHttpProvider and set:
//   TRACKING_PROVIDER=<name>   TRACKING_API_KEY=<key>   TRACKING_API_URL=<base>
//
// Contract — every method resolves to a normalised object:
//   getVesselPosition(v)  -> { available, latitude, longitude, current_port, speed, heading, timestamp, source }
//   getVesselETA(v)       -> { available, eta, source }
//   getVesselStatus(v)    -> { available, status, source }
//   getContainerStatus(c) -> { available, status, location, events:[...], source }
//   getPortEvents(q)      -> { available, events:[...], source }
// or { available:false, reason } when it cannot be fetched. Fabrication is a bug.

const NONE = (reason) => ({ available: false, reason });

// The honest default: no external tracking. Used whenever no provider/key is set.
function makeNullProvider(reason) {
  const no = async () => NONE(reason);
  return { name: 'none', configured: false, reason,
    getVesselPosition: no, getVesselETA: no, getVesselStatus: no, getContainerStatus: no, getPortEvents: no };
}

// Scaffold for a real HTTP provider. Deliberately returns available:false until a
// provider-specific request+normaliser is implemented and verified — so a
// half-configured provider can never leak fabricated or misread positions.
function makeHttpProvider(name, apiUrl, apiKey) {
  const notImpl = async () => ({ available: false,
    reason: `Provider "${name}" is configured but its API mapping is not implemented yet. Implement its normaliser in tracking-provider.js before enabling.` });
  // When you implement a provider, replace notImpl with real fetches that map the
  // provider's response into the normalised contract above. Keep keys server-side.
  return { name, configured: true, apiUrl,
    getVesselPosition: notImpl, getVesselETA: notImpl, getVesselStatus: notImpl,
    getContainerStatus: notImpl, getPortEvents: notImpl };
}

// MarineTraffic / Kpler vessel-positions provider (PS01 exportvessel).
//
// AIS is VESSEL-level: it tracks a ship by IMO/MMSI, not a container or a door
// delivery. So this implements getVesselPosition/Status and leaves container-level
// tracking honestly unavailable. A position is only ever returned when the API
// gives a real numeric LAT+LON and a timestamp — otherwise available:false. It
// never invents or interpolates a location.
//
// Config: TRACKING_PROVIDER=marinetraffic  TRACKING_API_KEY=<key>
//   optional TRACKING_API_URL (default https://services.marinetraffic.com/api)
//   optional TRACKING_MT_VERSION (default v:8)
// NOTE: verify against your account's FIRST real response before trusting figures —
// field set varies by subscription tier (simple vs extended msgtype).
function makeMarineTrafficProvider(apiUrl, apiKey) {
  const base = (apiUrl || 'https://services.marinetraffic.com/api').replace(/\/+$/, '');
  const ver = process.env.TRACKING_MT_VERSION || 'v:8';
  const numOrNull = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  // AIS navigational status codes → readable text.
  const AIS_STATUS = { 0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command', 3: 'Restricted manoeuvrability', 4: 'Constrained by draught', 5: 'Moored', 6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing', 15: 'Undefined' };

  async function fetchVessel(vessel) {
    const imo = vessel && (vessel.imo_number || vessel.imo);
    const mmsi = vessel && vessel.mmsi;
    if (!imo && !mmsi) return { available: false, reason: 'Vessel has no IMO or MMSI — cannot query AIS.' };
    const filter = imo ? `imo:${String(imo).trim()}` : `mmsi:${String(mmsi).trim()}`;
    const url = `${base}/exportvessel/${ver}/${apiKey}/protocol:jsono/${filter}`;
    let res, body;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      body = await res.json();
    } catch (e) { return { available: false, reason: `MarineTraffic request failed: ${e.message}` }; }
    if (!res.ok) return { available: false, reason: `MarineTraffic returned HTTP ${res.status}.` };
    // jsono → array of objects; an API error comes back as an object with "errors".
    if (!Array.isArray(body)) return { available: false, reason: body && body.errors ? `MarineTraffic: ${JSON.stringify(body.errors).slice(0, 200)}` : 'No position returned for this vessel.' };
    const row = body[0];
    if (!row) return { available: false, reason: 'No recent AIS position for this vessel in the requested timespan.' };
    return { available: true, row, imo, mmsi };
  }

  async function getVesselPosition(vessel) {
    const r = await fetchVessel(vessel);
    if (!r.available) return r;
    const lat = numOrNull(r.row.LAT), lon = numOrNull(r.row.LON);
    // Contract: never return a position without real coordinates + a timestamp.
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !r.row.TIMESTAMP) {
      return { available: false, reason: 'AIS row missing valid coordinates or timestamp — not recorded.' };
    }
    const st = r.row.STATUS;
    return {
      available: true, latitude: lat, longitude: lon,
      speed: numOrNull(r.row.SPEED), heading: numOrNull(r.row.HEADING ?? r.row.COURSE),
      current_port: null,
      status: st == null || st === '' ? null : (AIS_STATUS[Number(st)] || `AIS status ${st}`),
      timestamp: r.row.TIMESTAMP, source: 'AIS',
      provider_event_id: `mt:${r.mmsi || r.imo}:${r.row.TIMESTAMP}`,   // stable per fix → dedup
    };
  }
  async function getVesselStatus(vessel) {
    const p = await getVesselPosition(vessel);
    return p.available ? { available: true, status: p.status, source: 'AIS' } : p;
  }
  // ETA / port-forecast is a SEPARATE MarineTraffic product (voyage forecast), not the
  // positions feed — left honestly unavailable rather than guessed from position.
  const notVesselLevel = async () => ({ available: false, reason: 'MarineTraffic AIS is vessel-level (by IMO/MMSI); container/ETA tracking needs a different product. Enter these manually.' });

  return { name: 'marinetraffic', configured: true, apiUrl: base,
    getVesselPosition, getVesselStatus, getVesselETA: notVesselLevel,
    getContainerStatus: notVesselLevel, getPortEvents: notVesselLevel };
}

// Data Docked (datadocked.com) — a MarineTraffic alternative with a free tier.
// GET /api/vessels_operations/get-vessel-location?imo_or_mmsi=<id>  (x-api-key header).
// Vessel-level AIS; container/ETA-date tracking is not provided, so those stay
// honestly unavailable. Never fabricates — no valid lat/lon+timestamp → available:false.
//
// Config: TRACKING_PROVIDER=datadocked  TRACKING_API_KEY=<key>
//   optional TRACKING_API_URL (default https://datadocked.com/api)
function makeDataDockedProvider(apiUrl, apiKey) {
  const base = (apiUrl || 'https://datadocked.com/api').replace(/\/+$/, '');
  const numOrNull = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));

  async function fetchVessel(vessel) {
    const id = vessel && (vessel.imo_number || vessel.imo || vessel.mmsi);
    if (!id) return { available: false, reason: 'Vessel has no IMO or MMSI — cannot query AIS.' };
    const url = `${base}/vessels_operations/get-vessel-location?imo_or_mmsi=${encodeURIComponent(String(id).trim())}`;
    let res, body;
    try {
      res = await fetch(url, { headers: { accept: 'application/json', 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) });
      body = await res.json();
    } catch (e) { return { available: false, reason: `Data Docked request failed: ${e.message}` }; }
    if (res.status === 401 || res.status === 403) return { available: false, reason: 'Data Docked rejected the API key (401/403).' };
    if (res.status === 429) return { available: false, reason: 'Data Docked rate limit / credits exhausted (429).' };
    if (!res.ok) return { available: false, reason: `Data Docked returned HTTP ${res.status}.` };
    // Response may be the vessel object directly or wrapped in {data:{...}}.
    const row = body && (body.latitude != null || body.longitude != null) ? body : (body && body.data) || null;
    if (!row) return { available: false, reason: 'No position returned for this vessel.' };
    return { available: true, row };
  }

  async function getVesselPosition(vessel) {
    const r = await fetchVessel(vessel);
    if (!r.available) return r;
    const lat = numOrNull(r.row.latitude), lon = numOrNull(r.row.longitude);
    // Data Docked returns a human timestamp ("Sep 29, 2026 06:37 UTC") — normalise to
    // ISO so it stores cleanly; fall back to the raw string only if unparseable.
    const rawTs = r.row.positionReceived || r.row.updateTime || null;
    const d = rawTs ? new Date(rawTs) : null;
    const ts = d && !isNaN(d.getTime()) ? d.toISOString() : rawTs;
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !ts) {
      return { available: false, reason: 'AIS row missing valid coordinates or timestamp — not recorded.' };
    }
    return {
      available: true, latitude: lat, longitude: lon,
      speed: numOrNull(r.row.speed), heading: numOrNull(r.row.course),
      current_port: r.row.destination || null,
      status: r.row.navigationalStatus || r.row.status || null,
      timestamp: ts, source: 'AIS',
      provider_event_id: `dd:${r.row.mmsi || r.row.imo || (vessel.imo_number || vessel.mmsi)}:${ts}`,
    };
  }
  async function getVesselStatus(vessel) {
    const p = await getVesselPosition(vessel);
    return p.available ? { available: true, status: p.status, source: 'AIS' } : p;
  }
  const notAvail = async () => ({ available: false, reason: 'Data Docked provides vessel positions (by IMO/MMSI), not container-level or ETA-date tracking. Enter those manually.' });

  return { name: 'datadocked', configured: true, apiUrl: base,
    getVesselPosition, getVesselStatus, getVesselETA: notAvail,
    getContainerStatus: notAvail, getPortEvents: notAvail };
}

// ── TrackingMore container tracking (carrier/BL level) ──────────────────────────
// Carrier-level ocean tracking: a BL or container number → the shipping line's own
// milestones and declared ETA (loaded / departed / transshipped / discharged /
// arrived), across 100+ carriers. This is SEPARATE from AIS vessel position — it is
// what the line publishes for the booking, not where the ship physically is. It
// implements getContainerStatus and getVesselETA only; positions stay with the AIS
// provider (Data Docked). Never fabricates: any non-2xx / no-data → available:false.
//
// Config: CONTAINER_TRACKING_PROVIDER=trackingmore  CONTAINER_TRACKING_API_KEY=<key>
//   optional CONTAINER_TRACKING_API_URL (default https://api.trackingmore.com/v4)
//
// NOTE: built to TrackingMore's v4 container API conventions. Envelope and field
// names are parsed DEFENSIVELY (multiple aliases) so minor doc differences don't
// break it; verify against a live key and adjust the alias lists if a field is missed.
function makeTrackingMoreProvider(apiUrl, apiKey) {
  const base = (apiUrl || 'https://api.trackingmore.com/v4').replace(/\/+$/, '');
  const H = { 'Content-Type': 'application/json', 'Tracking-Api-Key': apiKey, accept: 'application/json' };
  // first non-empty value among a list of possible field names
  const pick = (o, keys) => { for (const k of keys) { if (o && o[k] != null && o[k] !== '') return o[k]; } return null; };
  const toIso = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? String(v) : d.toISOString(); };

  async function call(method, path, body) {
    let res, json;
    try {
      res = await fetch(`${base}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      json = await res.json().catch(() => null);
    } catch (e) { return { httpError: `TrackingMore request failed: ${e.message}` }; }
    if (res.status === 401) return { httpError: 'TrackingMore rejected the API key (401).' };
    if (res.status === 429) return { httpError: 'TrackingMore rate limit / quota exhausted (429).' };
    const code = json && (json.meta?.code ?? json.code);
    return { status: res.status, code, json, data: json?.data };
  }

  // number = container number OR bill of lading. opts.carrier_code (e.g. 'msc',
  // 'maersk', 'cma-cgm'); opts.number_type 'bl' to send it as a bill of lading.
  async function getContainerStatus(number, opts = {}) {
    if (!number) return { available: false, reason: 'No container/BL number supplied.' };
    const carrier = opts.carrier_code || opts.carrierCode || null;
    const isBl = (opts.number_type || '').toLowerCase() === 'bl';
    // v4 "create" is create-and-get (real-time). Body carries the number under the
    // field TrackingMore expects; we send the primary + a couple of accepted aliases.
    const num = String(number).trim();
    const body = carrier ? { carrier_code: carrier } : {};
    if (isBl) body.bill_of_lading = num; else body.container_number = num;
    body.number = num; // harmless alias some versions accept

    let r = await call('POST', '/containers/create', body);
    if (r.httpError) return { available: false, reason: r.httpError };
    // Already tracked before → fetch the stored record instead of re-creating.
    const exists = r.code === 4016 || /exist/i.test(JSON.stringify(r.json?.meta || r.json || {}));
    if (exists) {
      const q = isBl ? `?bill_of_lading=${encodeURIComponent(num)}` : `?container_number=${encodeURIComponent(num)}`;
      const g = await call('GET', `/containers/get${q}`);
      if (!g.httpError && g.data) r = g;
    }
    if (r.code && r.code !== 200 && r.code !== 4016) {
      return { available: false, reason: `TrackingMore returned code ${r.code}${r.json?.meta?.message ? ': ' + r.json.meta.message : ''}.` };
    }
    // data may be an object, or an array/{items:[]} — take the first record.
    let d = r.data;
    if (Array.isArray(d)) d = d[0];
    else if (d && Array.isArray(d.items)) d = d.items[0];
    if (!d) return { available: false, reason: 'TrackingMore returned no tracking data for this number.' };

    // Milestone events: try the common container field names.
    const rawEvents = pick(d, ['events', 'movement_events', 'trackinfo', 'checkpoints', 'origin_info', 'container_events']) || [];
    const list = Array.isArray(rawEvents) ? rawEvents : (rawEvents.trackinfo || []);
    const events = list.map((e) => {
      const ts = toIso(pick(e, ['event_time', 'checkpoint_date', 'date', 'timestamp', 'event_date']));
      const loc = pick(e, ['location', 'tracking_detail', 'place', 'port', 'event_location']);
      const desc = pick(e, ['description', 'event', 'status_description', 'tracking_detail', 'status']);
      const lat = pick(e, ['latitude', 'lat']); const lon = pick(e, ['longitude', 'lng', 'lon']);
      return {
        event_type: (pick(e, ['event_code', 'milestone', 'status_type']) || 'MILESTONE'),
        event_status: (pick(e, ['status', 'checkpoint_delivery_status', 'event']) || null),
        timestamp: ts, location: loc || null,
        latitude: lat != null && !isNaN(Number(lat)) ? Number(lat) : null,
        longitude: lon != null && !isNaN(Number(lon)) ? Number(lon) : null,
        // stable id for dedup: number + timestamp + a short status hash
        provider_event_id: `tm:${num}:${ts || ''}:${String(desc || '').slice(0, 24)}`,
        remarks: desc || null,
      };
    }).filter((e) => e.provider_event_id && (e.timestamp || e.location));

    // Carrier-declared ETA (the point of this feature).
    const etaRaw = pick(d, ['eta', 'estimated_arrival', 'estimated_arrival_date', 'expected_arrival', 'arrival_date', 'latest_estimated_arrival']);
    const eta = etaRaw ? (toIso(etaRaw) || String(etaRaw)) : null;
    const vessel = pick(d, ['vessel', 'vessel_name', 'current_vessel']);
    const pod = pick(d, ['port_of_discharge', 'destination_port', 'destination', 'pod']);

    if (!events.length && !eta) return { available: false, reason: 'TrackingMore has no milestones or ETA for this number yet (carrier may not have published data).' };
    return { available: true, source: 'CARRIER', provider: 'trackingmore', events, eta, vessel: vessel || null, port_of_discharge: pod || null, raw: d };
  }

  async function getVesselETA(vessel) {
    // ETA is booking/BL level for this provider, not vessel level.
    return { available: false, reason: 'TrackingMore ETA is per BL/container, not per vessel. Track the shipment\'s BL/container number instead.' };
  }
  const notAis = async () => ({ available: false, reason: 'TrackingMore is carrier/BL-level tracking, not AIS vessel position. Use the AIS provider (Data Docked) for live position.' });

  return { name: 'trackingmore', configured: true, apiUrl: base, kind: 'container',
    getContainerStatus, getVesselETA, getVesselPosition: notAis, getVesselStatus: notAis, getPortEvents: notAis };
}

let cached = null;
function getProvider() {
  if (cached) return cached;
  const name = (process.env.TRACKING_PROVIDER || '').trim().toLowerCase();
  const key = process.env.TRACKING_API_KEY;
  const url = process.env.TRACKING_API_URL;
  if (!name || name === 'none') cached = makeNullProvider('No tracking provider configured. Manual tracking is available; set TRACKING_PROVIDER + TRACKING_API_KEY to enable automatic tracking.');
  else if (!key) cached = makeNullProvider(`Tracking provider "${name}" is set but TRACKING_API_KEY is missing — automatic tracking is disabled.`);
  else if (name === 'marinetraffic') cached = makeMarineTrafficProvider(url, key);
  else if (name === 'datadocked' || name === 'data_docked') cached = makeDataDockedProvider(url, key);
  else if (name === 'trackingmore') cached = makeTrackingMoreProvider(url, key);
  else cached = makeHttpProvider(name, url, key);
  return cached;
}

// Separate CONTAINER/BL provider (carrier-level milestones + ETA), independent of the
// AIS position provider above so both can run at once — e.g. Data Docked for vessel
// position AND TrackingMore for BL ETA. Falls back to the AIS provider only if that
// one happens to implement container tracking; otherwise honestly returns none.
let containerCached = null;
function getContainerProvider() {
  if (containerCached) return containerCached;
  const name = (process.env.CONTAINER_TRACKING_PROVIDER || '').trim().toLowerCase();
  const key = process.env.CONTAINER_TRACKING_API_KEY;
  const url = process.env.CONTAINER_TRACKING_API_URL;
  if (!name || name === 'none') containerCached = makeNullProvider('No container/BL tracking provider configured. Set CONTAINER_TRACKING_PROVIDER + CONTAINER_TRACKING_API_KEY (e.g. trackingmore) to enable carrier ETA/milestone tracking.');
  else if (!key) containerCached = makeNullProvider(`Container tracking provider "${name}" is set but CONTAINER_TRACKING_API_KEY is missing — carrier tracking is disabled.`);
  else if (name === 'trackingmore') containerCached = makeTrackingMoreProvider(url, key);
  else containerCached = makeHttpProvider(name, url, key);
  return containerCached;
}

// Test hook — lets a unit test reset the memoised providers after changing env.
function _reset() { cached = null; containerCached = null; }

function status() {
  const p = getProvider(); const c = getContainerProvider();
  return { provider: p.name, configured: !!p.configured, reason: p.reason || null,
    container_provider: c.name, container_configured: !!c.configured, container_reason: c.reason || null };
}

module.exports = { getProvider, getContainerProvider, status, makeNullProvider, _reset };
