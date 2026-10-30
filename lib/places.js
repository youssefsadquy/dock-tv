// Looking things up for the widgets: a town (weather, prayer times) and a London bus stop (TfL).
// All of these are free and need no account.

async function getJson(url, label) {
  const res = await fetch(url, { headers: { 'User-Agent': 'DockTV/1.0' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(label + ' answered ' + res.status + '.');
  return res.json();
}

async function findPlace(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Type a town or city.');
  const json = await getJson('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q), 'Place search');
  return (json.results || []).map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    place: r.name, latitude: r.latitude, longitude: r.longitude, timezone: r.timezone || 'auto',
  }));
}

// Bus stops matching a name. Each result is one physical stop (with its letter) and the
// bus lines that call there, so the user picks "Stop J: 163" rather than a stop group.
async function findBusStops(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Type a stop or area name, for example "Trafalgar Square".');
  const search = await getJson('https://api.tfl.gov.uk/StopPoint/Search?modes=bus&maxResults=5&query=' + encodeURIComponent(q), 'TfL stop search');
  const out = [];
  for (const m of (search.matches || []).slice(0, 5)) {
    let sp;
    try { sp = await getJson('https://api.tfl.gov.uk/StopPoint/' + encodeURIComponent(m.id), 'TfL stop'); } catch (e) { continue; }
    const stops = (sp.children && sp.children.length ? sp.children : [sp]).filter((c) => (c.lines || []).length);
    for (const c of stops) {
      out.push({
        stopId: String(c.naptanId || c.id || ''),
        stopName: String(sp.commonName || m.name || ''),
        stop: String(c.indicator || ''),
        lines: Array.from(new Set((c.lines || []).map((l) => String(l.name)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      });
    }
  }
  return out.filter((o) => /^[A-Za-z0-9]{3,20}$/.test(o.stopId));
}

module.exports = { findPlace, findBusStops };
