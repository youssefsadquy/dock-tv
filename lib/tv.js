// Finding a Samsung TV and reading its info page (http://<ip>:8001/api/v2/).
const os = require('os');
const net = require('net');
const http = require('http');

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// First private IPv4 address on a real network adapter.
function getPcIPv4() {
  const found = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal && isPrivate(n.address)) {
        found.push({ ip: n.address, iface: name, netmask: n.netmask });
      }
    }
  }
  // Prefer a plain home-router range over virtual adapters (WSL, VirtualBox, VPN).
  found.sort((a, b) => Number(/^192\.168\./.test(b.ip)) - Number(/^192\.168\./.test(a.ip)));
  return found[0] || null;
}

function probePort(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(timeoutMs, () => finish(false));
    s.once('error', () => finish(false));
    s.connect(port, ip, () => finish(true));
  });
}

function getTvInfoRaw(ip, port = 8001, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get({ host: ip, port, path: '/api/v2/', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
      res.on('end', () => resolve(res.statusCode === 200 ? body : null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

async function getTvInfo(ip, port) {
  const raw = await getTvInfoRaw(ip, port);
  if (!raw) return null;
  try { return { raw, json: JSON.parse(raw) }; } catch (e) { return null; }
}

function isSamsung(info) {
  const j = info && info.json;
  if (!j) return false;
  return /samsung/i.test(String((j.device && j.device.type) || '')) || /samsung/i.test(String(j.type || ''));
}

function summarize(ip, json, pcIp) {
  const d = json.device || {};
  return {
    ip,
    model: String(d.modelName || ''),
    name: String(d.name || ''),
    os: String(d.OS || ''),
    mac: String(d.wifiMac || ''),
    networkType: String(d.networkType || ''),
    developerMode: String(d.developerMode || ''),
    developerIP: String(d.developerIP || ''),
    duid: String(d.duid || ''),
    pcIp: pcIp || '',
    foundAt: new Date().toISOString(),
  };
}

// Scans x.y.z.1-254 on port 8001, then asks each open one for its info page.
async function scan({ base, port = 8001, onProgress } = {}) {
  const pc = getPcIPv4();
  if (!base) {
    if (!pc) throw new Error('No private network connection found. Connect this PC to the same router as the TV.');
    base = pc.ip.split('.').slice(0, 3).join('.');
  }
  const ips = [];
  for (let i = 1; i <= 254; i++) ips.push(base + '.' + i);
  const open = [];
  let done = 0;
  const queue = ips.slice();
  const worker = async () => {
    while (queue.length) {
      const ip = queue.shift();
      if (pc && ip === pc.ip) { done++; continue; }
      if (await probePort(ip, port, 1500)) open.push(ip);
      done++;
      if (onProgress && done % 16 === 0) onProgress(done / ips.length);
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  const tvs = [];
  for (const ip of open) {
    const info = await getTvInfo(ip, port);
    if (isSamsung(info)) tvs.push(summarize(ip, info.json, pc && pc.ip));
  }
  return tvs;
}

// ----- how likely is this model to work? Only the model the author owns is "verified". -----
const VERIFIED_MODELS = ['UE55NU7021'];
const YEARS = { K: 2016, M: 2017, N: 2018, R: 2019, T: 2020, A: 2021, B: 2022, C: 2023, D: 2024, F: 2025 };

function modelYear(model) {
  const m = String(model).toUpperCase().replace(/^[A-Z]{2}(?=\d{2})/, 'XX');
  let hit = /^XX\d{2}([A-Z])[A-Z]\d{3,4}/.exec(m) || /^XX\d{2}[A-Z]\d{2,3}([A-Z])/.exec(m);
  if (!hit) hit = /^\d{2}([A-Z])[A-Z]?\d{3,4}/.exec(m);
  return hit && YEARS[hit[1]] ? YEARS[hit[1]] : null;
}

function compatibility(model) {
  const upper = String(model).toUpperCase();
  if (VERIFIED_MODELS.some((v) => upper.indexOf(v) === 0)) {
    return { level: 'verified', year: 2018, text: 'Tested end to end on this model.' };
  }
  const year = modelYear(upper);
  if (year === 2018) {
    return { level: 'likely', year, text: 'Same generation (2018, Tizen 4.0) as the tested TV. Expected to work, but not tested on this exact model.' };
  }
  if (year && year > 2018) {
    return { level: 'untested', year, text: 'A newer TV (' + year + '). Dock is built for old browsers so it should run, but menu names, the Developer Mode steps and the privacy menu paths differ and have not been tested. Every change is logged and can be undone.' };
  }
  if (year && year < 2018) {
    return { level: 'untested', year, text: 'An older TV (' + year + '). Untested: it may need a different Tizen SDK profile.' };
  }
  return { level: 'unknown', year: null, text: 'Could not tell which generation this model is. Untested.' };
}

module.exports = { getPcIPv4, getTvInfo, isSamsung, summarize, scan, compatibility, modelYear, probePort };
