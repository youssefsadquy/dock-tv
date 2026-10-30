// Tests that need no TV and no Electron: node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tv = require('../lib/tv');
const layout = require('../lib/layout');
const sdk = require('../lib/sdk');
const store = require('../lib/store');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A stand-in for a Samsung TV's info page.
function mockTv(device, type = 'Samsung SmartTV') {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/v2/') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ device: Object.assign({ type }, device), id: 'x', name: 'x' }));
      } else { res.statusCode = 404; res.end(); }
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('scan finds a Samsung TV and ignores other web servers', async () => {
  const good = await mockTv({ modelName: 'UE55NU7021', name: 'Living Room', OS: 'Tizen', wifiMac: 'AA:BB', developerMode: '0', duid: 'DUID123' });
  const other = await mockTv({ modelName: 'Router' }, 'Router');
  try {
    const found = await tv.scan({ base: '127.0.0', port: good.port });
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].model, 'UE55NU7021');
    assert.strictEqual(found[0].duid, 'DUID123');
    assert.strictEqual(found[0].developerMode, '0');
    const none = await tv.scan({ base: '127.0.0', port: other.port });
    assert.strictEqual(none.length, 0);
  } finally { good.server.close(); other.server.close(); }
});

test('getTvInfo returns null when nothing answers', async () => {
  assert.strictEqual(await tv.getTvInfo('127.0.0.1', 9), null);
});

test('compatibility only marks the author\u2019s model as verified', () => {
  assert.strictEqual(tv.compatibility('UE55NU7021').level, 'verified');
  assert.strictEqual(tv.compatibility('UE50NU7100').level, 'likely');
  assert.strictEqual(tv.compatibility('QE55Q60RAT').level, 'untested');
  assert.strictEqual(tv.modelYear('QE55Q60RAT'), 2019);
  assert.strictEqual(tv.modelYear('UE43TU7000'), 2020);
  assert.strictEqual(tv.modelYear('UE50AU7100'), 2021);
  assert.strictEqual(tv.compatibility('Mystery').level, 'unknown');
  assert.strictEqual(tv.compatibility('').level, 'unknown');
});

test('layout.normalize repairs bad input', () => {
  const l = layout.normalize({
    apps: Array.from({ length: 12 }, (_, i) => ({ name: 'A' + i, match: 'a', color: 'red' })).concat([{ name: '', match: 'x' }, { name: 'NoMatch' }]),
    settings: { wallpaperSeconds: 1, fadeMs: 99999, idleMinutes: -4, appIcons: 'weird' },
    night: { from: '25:99', to: 'x', level: 99 },
    weather: { enabled: true, place: 'X' },
    bus: { enabled: true, line: '163', stopId: 'bad id!' },
    prayer: { enabled: true, latitude: 51, longitude: -0.1, method: 99, school: 7, tune: 'nope', timezone: '../etc' },
    spotify: { enabled: true, playlistUri: 'javascript:alert(1)', sdkPlayerUrl: 'http://insecure.example' },
  });
  assert.strictEqual(l.apps.length, 8);
  assert.strictEqual(l.apps[0].color, '#1f2a33');
  assert.strictEqual(l.settings.wallpaperSeconds, 10);
  assert.strictEqual(l.settings.fadeMs, 6000);
  assert.strictEqual(l.settings.idleMinutes, 0);
  assert.strictEqual(l.settings.appIcons, 'auto');
  assert.strictEqual(l.night.from, '22:00');
  assert.strictEqual(l.night.level, 4);
  assert.strictEqual(l.weather.enabled, false, 'weather without a location stays off');
  assert.strictEqual(l.bus.enabled, false, 'bus without a valid stop stays off');
  assert.strictEqual(l.prayer.enabled, true);
  assert.strictEqual(l.prayer.method, 24);
  assert.strictEqual(l.prayer.school, 0);
  assert.strictEqual(l.prayer.tune, '0,0,0,0,0,0,0,0,0');
  assert.strictEqual(l.prayer.timezone, 'auto');
  assert.strictEqual(l.spotify.playlistUri, '');
  assert.strictEqual(l.spotify.sdkPlayerUrl, '', 'only https player pages are accepted');
  assert.deepStrictEqual(layout.normalize(undefined), layout.normalize(null));
});

test('defaults contain nothing personal and every widget starts off', () => {
  const d = layout.normalize(null);
  assert.ok(!d.weather.enabled && !d.bus.enabled && !d.prayer.enabled && !d.spotify.enabled);
  assert.strictEqual(d.bus.stopId, '', 'a missing stop id must not become the text "undefined"');
  assert.strictEqual(d.weather.timezone, 'auto');
  assert.strictEqual(d.prayer.timezone, 'auto');
  assert.deepStrictEqual(layout.normalize({}), d);
  const all = JSON.stringify(d) + layout.toConfigJs(d) + layout.toConfigXml(d);
  assert.ok(!/morden|youssef|github\.io|163|miconline|490010018/i.test(all));
});

test('normalize is idempotent and survives JSON round trips', () => {
  const once = layout.normalize({ prayer: { enabled: true, place: 'Leeds', latitude: 53.8, longitude: -1.55, timezone: 'Europe/London', method: 15, school: 1, tune: '0,-1,0,5,0,4,0,4,0' } });
  assert.deepStrictEqual(layout.normalize(JSON.parse(JSON.stringify(once))), once);
  assert.strictEqual(once.prayer.tune, '0,-1,0,5,0,4,0,4,0');
});

test('config.xml requests network access only for widgets that are on', () => {
  const off = layout.toConfigXml(layout.normalize(null));
  assert.ok(!/open-meteo|tfl\.gov|aladhan|spotify/.test(off));
  assert.ok(/HmDockTV01\.Dock/.test(off) && /tv\.inputdevice/.test(off));
  const on = layout.toConfigXml(layout.normalize({
    weather: { enabled: true, latitude: 51.5, longitude: -0.1 },
    bus: { enabled: true, line: '1', stopId: '490000001A' },
    prayer: { enabled: true, latitude: 51.5, longitude: -0.1 },
    spotify: { enabled: true, sdkPlayerUrl: 'https://example.github.io/player/' },
  }));
  ['api.open-meteo.com', 'api.tfl.gov.uk', 'api.aladhan.com', 'api.spotify.com', 'https://example.github.io'].forEach((o) => assert.ok(on.indexOf(o) > 0, o));
});

test('config.js is valid JS that defines every DOCK_ setting the launcher reads', () => {
  const box = {};
  new Function('window', layout.toConfigJs(layout.normalize(null)).replace(/\bvar (DOCK_\w+) =/g, 'window.$1 ='))(box);
  ['DOCK_APPS', 'DOCK_SETTINGS', 'DOCK_SPOTIFY', 'DOCK_WEATHER', 'DOCK_INPUTS', 'DOCK_NIGHT', 'DOCK_BUS', 'DOCK_PRAYER'].forEach((k) => assert.ok(box[k], k));
  assert.strictEqual(box.DOCK_SETTINGS.keyDebug, false);
});

test('launcher reads exactly the globals the app generates', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'js', 'main.js'), 'utf8');
  const used = Array.from(new Set(src.match(/window\.DOCK_[A-Z]+/g))).map((s) => s.slice(7));
  const made = layout.toConfigJs(layout.normalize(null)).match(/var (DOCK_\w+)/g).map((s) => s.slice(4));
  used.forEach((k) => assert.ok(made.indexOf(k) >= 0, 'launcher uses ' + k + ' but the app does not generate it'));
});

test('spotify: link parsing and PKCE', () => {
  const sp = require('../lib/spotify');
  assert.strictEqual(sp.toSpotifyUri('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M');
  assert.strictEqual(sp.toSpotifyUri('https://open.spotify.com/intl-fr/album/2up3OPMp9Tb4dAKM2erWXQ'), 'spotify:album:2up3OPMp9Tb4dAKM2erWXQ');
  assert.strictEqual(sp.toSpotifyUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC'), 'spotify:track:4uLU6hMCjMI75M1A2tKUQC');
  assert.strictEqual(sp.toSpotifyUri('hello'), '');
  const { verifier, challenge, state } = sp.pkcePair();
  const expect = require('crypto').createHash('sha256').update(verifier).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  assert.strictEqual(challenge, expect);
  assert.ok(verifier.length >= 43 && state.length >= 20);
  const u = new URL(sp.authUrl('abc123', challenge, state));
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8888/callback');
});

test('spotify login never reaches the preview or the stage, only the build copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docktv-sp-'));
  try {
    store.init(dir);
    assert.strictEqual(sdk.spotifyAuthFor(layout.normalize(null)), null);
    store.writeJson(store.files.spotify(), { clientId: 'cid', refreshToken: 'rt', name: 'x' });
    const a = sdk.spotifyAuthFor(layout.normalize({ spotify: { enabled: true } }));
    assert.deepStrictEqual(Object.keys(a).sort(), ['clientId', 'playlistName', 'playlistUri', 'refreshToken']);
    const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.ok(!/refreshToken/.test(src.slice(src.indexOf('function writeStage'), src.indexOf('function loadLayout'))), 'writeStage must not touch the token');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wallpaper credits: day and night use the names the launcher expects', () => {
  const wp = require('../lib/wallpapers');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docktv-wp-'));
  try {
    store.init(dir);
    wp.writeCredits([{ file: 'wp01.jpg', title: 'A', artist: 'B', license: 'CC BY 4.0', page: '' }], 'day');
    wp.writeCredits([{ file: 'wp01.jpg', title: 'N', artist: 'M', license: 'CC0', page: '' }], 'night');
    const day = fs.readFileSync(path.join(store.files.wallpapers(), 'credits.js'), 'utf8');
    const night = fs.readFileSync(path.join(store.files.wallpapersNight(), 'credits-night.js'), 'utf8');
    assert.ok(/^var WALLPAPERS = /.test(day));
    assert.ok(/^window\.NIGHT_WALLPAPERS = /.test(night));
    assert.strictEqual(wp.author('Original: Jo Bloggs Derivative work: Someone Else'), 'Jo Bloggs');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('certificate order: last working profile, then DockTizen, then others', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docktv-ord-'));
  try {
    store.init(path.join(root, 'data'));
    const sdkDir = path.join(root, 'sdk');
    fs.mkdirSync(path.join(sdkDir, 'tools', 'tizen-core'), { recursive: true });
    fs.writeFileSync(path.join(sdkDir, 'tools', 'sdb.exe'), ''); fs.writeFileSync(path.join(sdkDir, 'tools', 'tizen-core', 'tz.exe'), '');
    fs.mkdirSync(path.join(sdkDir + '-data', 'profile'), { recursive: true });
    fs.writeFileSync(path.join(sdkDir + '-data', 'profile', 'profiles.xml'), '<profiles active="Dock"><profile name="Dock"/><profile name="Other"/></profiles>');
    const found = sdk.findSdk(sdkDir);
    assert.deepStrictEqual(sdk.profileOrder(found, null), ['DockTizen', 'Dock', 'Other']);
    store.setState({ certProfile: 'Other' });
    assert.deepStrictEqual(sdk.profileOrder(found, null), ['Other', 'DockTizen', 'Dock']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('parseApps reads the TV\u2019s app list format', () => {
  const text = "\tApplication List for user 5001\r\n\r\n\t Name \t AppID \r\n\r\n\t'Photo player'\t 'org.tizen.mycontent-photo-player-tv'\r\n\r\n\t'Netflix'\t 'RN1MCdNq8t.Netflix'\r\n";
  assert.deepStrictEqual(sdk.parseApps(text), [
    { name: 'Photo player', id: 'org.tizen.mycontent-photo-player-tv' },
    { name: 'Netflix', id: 'RN1MCdNq8t.Netflix' },
  ]);
  assert.deepStrictEqual(sdk.parseApps('sdb server is out of date'), []);
});

test('SDK detection, data dir and certificate profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docktv-sdk-'));
  try {
    const sdkDir = path.join(root, 'tizen-sdk');
    fs.mkdirSync(path.join(sdkDir, 'tools', 'tizen-core'), { recursive: true });
    fs.writeFileSync(path.join(sdkDir, 'tools', 'sdb.exe'), '');
    fs.writeFileSync(path.join(sdkDir, 'tools', 'tizen-core', 'tz.exe'), '');
    const data = sdkDir + '-data';
    fs.mkdirSync(path.join(data, 'profile'), { recursive: true });
    fs.writeFileSync(path.join(data, 'profile', 'profiles.xml'),
      '<?xml version="1.0"?><profiles active="Other" version="3.1"><profile name="Other"/><profile name="Dock"><x/></profile></profiles>');
    assert.ok(sdk.isSdkRoot(sdkDir));
    assert.ok(!sdk.isSdkRoot(root));
    const found = sdk.findSdk(sdkDir);
    assert.strictEqual(found.root, sdkDir);
    assert.strictEqual(found.data, data);
    const profiles = sdk.certProfiles(found);
    assert.deepStrictEqual(profiles.names, ['Other', 'Dock']);
    assert.strictEqual(profiles.active, 'Other');
    assert.strictEqual(sdk.pickProfile(profiles), 'Dock', 'prefers a profile named Dock');
    assert.strictEqual(sdk.pickProfile(profiles, 'Other'), 'Other');
    assert.strictEqual(sdk.pickProfile({ names: [], active: null }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('project yaml lists every file and the signing profile', () => {
  const y = sdk.projectYaml({ profile: 'tv-samsung', apiVersion: '10.0', certProfile: 'Dock', files: ['index.html', 'js/main.js'] });
  assert.ok(y.includes('signing_profile: "Dock"') && y.includes('  - "js/main.js"') && y.includes('api_version: "10.0"'));
});

test('change log: upsert, remove, and personal data stays in the data folder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docktv-data-'));
  try {
    store.init(dir);
    store.upsertEntry({ id: 'vis', name: 'VIS', before: 'On', after: 'Off', changed: true, restored: false }, 'UE55NU7021');
    store.upsertEntry({ id: 'vis', name: 'VIS', before: 'On', after: 'Off', changed: true, restored: true }, 'UE55NU7021');
    store.upsertEntry({ id: 'iba', name: 'IBA', before: 'On', after: 'On', changed: false }, 'UE55NU7021');
    let log = store.getLog();
    assert.strictEqual(log.entries.length, 2);
    assert.strictEqual(log.entries.find((e) => e.id === 'vis').restored, true);
    log = store.removeEntry('iba');
    assert.strictEqual(log.entries.length, 1);
    assert.ok(store.files.log().startsWith(dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no personal data is shipped in the app sources', () => {
  const root = path.join(__dirname, '..');
  const skip = new Set(['node_modules', 'release', 'test', '.git', 'package-lock.json']);
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!/\.(js|json|html|css|md|xml|txt)$/i.test(e.name)) continue;
      const text = fs.readFileSync(f, 'utf8');
      if (/[\\/]youssef|C:\\Users\\|\b192\.168\.\d+\.\d+\b|([0-9A-F]{2}:){5}[0-9A-F]{2}/i.test(text.replace(/e\.g\. 192\.168\.1\.50|192\.168\.1\.50/g, ''))) hits.push(path.relative(root, f));
    }
  };
  walk(root);
  assert.deepStrictEqual(hits, []);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
