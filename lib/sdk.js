// Talking to the Tizen SDK (sdb.exe and tz.exe) that Samsung's VS Code extension installs.
// Tizen Studio is retired; the current SDK keeps sdb at <sdk>\tools\sdb.exe and the build
// tool at <sdk>\tools\tizen-core\tz.exe. Signing profiles live in <sdk-data>\profile\profiles.xml.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./store');
const layoutLib = require('./layout');

const SDB_PORT = 26101;

// Runs a tool and always resolves with { code, text }; never throws on a non-zero exit.
function run(exe, args, { env, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, env: env || process.env, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, text: String(stdout || '') + String(stderr || '') });
      });
  });
}

function isSdkRoot(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'tools', 'sdb.exe')) && fs.existsSync(path.join(dir, 'tools', 'tizen-core', 'tz.exe'));
  } catch (e) { return false; }
}

function candidates() {
  const home = os.homedir();
  const list = [];
  try {
    const line = fs.readFileSync(path.join(home, '.tizen.sdk.path.config'), 'utf8').split(/\r?\n/)[0];
    if (line) list.push(line.trim());
  } catch (e) { /* not present */ }
  if (process.env.TIZEN_SDK_PATH) list.push(process.env.TIZEN_SDK_PATH);
  const saved = store.getState().sdkPath;
  if (saved) list.push(saved);
  list.push(path.join(home, '.tizen-extension-platform', 'server', 'sdktools', 'data'));
  list.push(path.join(home, 'tizen-sdk'));
  list.push('C:\\tizen-sdk');
  return list;
}

function dataDirFor(root) {
  const guesses = [];
  try {
    const info = fs.readFileSync(path.join(root, 'sdk.info'), 'utf8').split(/\r?\n/);
    const line = info.find((l) => /^\s*TIZEN_SDK_DATA_PATH\s*=/.test(l));
    if (line) guesses.push(line.replace(/^\s*TIZEN_SDK_DATA_PATH\s*=\s*/, '').trim());
  } catch (e) { /* no sdk.info */ }
  guesses.push(root.replace(/[\\/]+$/, '') + '-data');
  guesses.push(path.join(os.homedir(), 'tizen-sdk-data'));
  return guesses.find((d) => d && fs.existsSync(path.join(d, 'profile', 'profiles.xml'))) || guesses[0];
}

function findSdk(extraRoot) {
  const roots = (extraRoot ? [extraRoot] : []).concat(candidates());
  const root = roots.find(isSdkRoot);
  if (!root) return null;
  return {
    root,
    sdb: path.join(root, 'tools', 'sdb.exe'),
    tz: path.join(root, 'tools', 'tizen-core', 'tz.exe'),
    data: dataDirFor(root),
  };
}

// Certificate profile names from profiles.xml (the password never lives in this file).
function certProfiles(sdk) {
  const file = path.join(sdk.data, 'profile', 'profiles.xml');
  try {
    const xml = fs.readFileSync(file, 'utf8');
    const active = (/<profiles[^>]*\bactive="([^"]*)"/.exec(xml) || [])[1] || null;
    const names = [];
    const re = /<profile\s+name="([^"]+)"/g;
    let m;
    while ((m = re.exec(xml))) names.push(m[1]);
    return { active, names, file };
  } catch (e) {
    return { active: null, names: [], file };
  }
}

function pickProfile(profiles, wanted) {
  if (wanted && profiles.names.indexOf(wanted) >= 0) return wanted;
  if (profiles.names.indexOf('Dock') >= 0) return 'Dock';
  return profiles.active || profiles.names[0] || null;
}

async function connect(sdk, ip) {
  const serial = ip + ':' + SDB_PORT;
  await run(sdk.sdb, ['connect', serial], { timeoutMs: 20000 });
  const list = await run(sdk.sdb, ['devices'], { timeoutMs: 20000 });
  const ok = list.text.split(/\r?\n/).some((l) => l.indexOf(serial) === 0 && /\bdevice\b/.test(l));
  return ok ? serial : null;
}

// The TV prints apps as:  'Name'<tab> 'org.app.id'
function parseApps(text) {
  const apps = [];
  const re = /'([^'\r\n]+)'\s+'([^'\r\n]+)'/g;
  let m;
  while ((m = re.exec(text))) apps.push({ name: m[1], id: m[2] });
  return apps;
}

async function saveAppList(sdk, serial, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const r = await run(sdk.sdb, ['-s', serial, 'shell', '0', 'applist'], { timeoutMs: 30000 });
  fs.writeFileSync(path.join(dir, 'installed-apps.txt'), r.text, 'utf8');
  const cap = await run(sdk.sdb, ['-s', serial, 'capability'], { timeoutMs: 30000 });
  fs.writeFileSync(path.join(dir, 'sdb-capability.txt'), cap.text, 'utf8');
  return parseApps(r.text).length > 0 && !/closed/.test(r.text);
}

function copyDirSync(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip && skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirSync(s, d, skip);
    else fs.copyFileSync(s, d);
  }
}

function listFiles(dir, base = dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function projectYaml({ profile, apiVersion, certProfile, files }) {
  return [
    'project_type: web_app',
    'profile: ' + profile,
    'api_version: "' + apiVersion + '"',
    'build_type: Release',
    'output_name: Dock',
    'output_path: ""',
    'opt: false',
    'signing_profile: "' + certProfile + '"',
    'trust_anchor: []',
    'files:',
  ].concat(files.map((f) => '  - "' + f + '"')).concat([
    'excludes:', '  - Debug/*', '  - Release/*', '  - Test/*', '  - tizen_web_project.yaml', 'deps: []', '',
  ]).join('\r\n');
}

// ---------- certificates ----------
// 2018-2022 TVs accept apps signed with a plain Tizen developer certificate (the way the
// widely used Jellyfin builds are signed). Newer Samsung certificates are issued by 2025 CAs
// that older TV firmware does not trust, so the app creates its own profile, DockTizen,
// needing no account, and only falls back to your other profiles if the TV refuses it.
const TIZEN_DEV_PROFILE = 'DockTizen';
const TIZEN_AUTHOR_FILE = 'DockTizenAuthor';
const TIZEN_DIST_PASSWORD = 'tizenpkcs12passfordsigner'; // the public password of the SDK's bundled test distributor

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = require('crypto').randomBytes(20);
  return 'Dk' + Array.from(bytes, (b) => chars[b % chars.length]).join('') + '7a';
}

// Creates (once) an author certificate plus a signing profile that uses the SDK's public
// distributor. The author password is kept in the user's data folder, never in the app.
async function ensureTizenProfile(sdk, log, env) {
  if (certProfiles(sdk).names.indexOf(TIZEN_DEV_PROFILE) >= 0) return;
  log('Creating the "' + TIZEN_DEV_PROFILE + '" Tizen developer certificate (one-off, no account needed)...');
  const keyDir = path.join(sdk.data, 'keystore', 'author');
  let author = path.join(keyDir, TIZEN_AUTHOR_FILE + '.p12');
  const pwFile = path.join(store.files.root(), 'tizen-author-password.txt');
  let pw = null;
  try { pw = fs.readFileSync(pwFile, 'utf8').trim(); } catch (e) { /* first run */ }
  if (!fs.existsSync(author)) {
    pw = randomPassword();
    const r = await run(sdk.tz, ['cert', '-n', 'Dock', '-p', pw, '-f', TIZEN_AUTHOR_FILE], { env });
    const m = /certificate created at\s*:\s*(.+)/.exec(r.text);
    if (m) author = m[1].trim();
    if (!fs.existsSync(author)) throw new Error('Could not create the author certificate:\n' + r.text.split(pw).join('***'));
    fs.writeFileSync(pwFile, pw, 'utf8');
  }
  if (!pw) throw new Error('The password for ' + author + ' is missing (' + pwFile + ').');
  const pwdFile = author.replace(/\.p12$/i, '.pwd');
  if (!fs.existsSync(pwdFile)) fs.writeFileSync(pwdFile, pw, 'utf8');

  let distDir = path.join(sdk.root, 'tools', 'certificate-generator', 'certificates', 'distributor', 'sdk-public');
  if (!fs.existsSync(path.join(distDir, 'tizen-distributor-signer.p12'))) distDir = path.join(sdk.root, 'tools', 'certificate-generator', 'certificates', 'distributor');
  const signer = path.join(distDir, 'tizen-distributor-signer.p12');
  const ca = path.join(distDir, 'tizen-distributor-ca.cer');
  if (!fs.existsSync(signer)) throw new Error('The SDK’s Tizen distributor certificate is missing: ' + signer);
  const r = await run(sdk.tz, ['security-profiles', 'add', '-n', TIZEN_DEV_PROFILE, '-a', author, '-p', pw,
    '-d', signer, '-P', TIZEN_DIST_PASSWORD, '-C', ca, '-x', certProfiles(sdk).file], { env });
  if (certProfiles(sdk).names.indexOf(TIZEN_DEV_PROFILE) < 0) throw new Error('Could not add the signing profile:\n' + r.text.split(pw).join('***'));
  log('Created signing profile ' + TIZEN_DEV_PROFILE + '.');
}

// The TV's DUID (the ID a Samsung distributor certificate must include).
async function getDuid(sdk, serial) {
  const r = await run(sdk.sdb, ['-s', serial, 'shell', '0', 'getduid'], { timeoutMs: 20000 });
  for (const line of r.text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^[A-Z0-9][A-Z0-9#.\-]{8,}$/.test(t) && !/closed|error/i.test(t)) return t;
  }
  return null;
}

// device-profile.xml sits next to a profile's distributor or author key, when it has one.
function deviceProfileFor(sdk, name) {
  try {
    const xml = fs.readFileSync(path.join(sdk.data, 'profile', 'profiles.xml'), 'utf8');
    const block = new RegExp('<profile\\s+name="' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[\\s\\S]*?</profile>').exec(xml);
    if (!block) return null;
    const keys = [];
    const re = /\bkey="([^"]+)"/g;
    let m;
    while ((m = re.exec(block[0]))) keys.push(m[1]);
    for (const k of keys.reverse()) {
      const dp = path.join(path.dirname(k), 'device-profile.xml');
      if (fs.existsSync(dp)) return dp;
    }
  } catch (e) { /* no profile file */ }
  return null;
}

// The Spotify login saved by "Connect Spotify", plus this layout's playlist.
function spotifyAuthFor(layout) {
  const s = store.readJson(store.files.spotify(), null);
  if (!s || !s.clientId || !s.refreshToken) return null;
  return { clientId: s.clientId, refreshToken: s.refreshToken, playlistUri: layout.spotify.playlistUri || '', playlistName: layout.spotify.playlistName || '' };
}

// Profiles to try, in order: the one that worked last time, DockTizen, then any others.
function profileOrder(sdk, preferred) {
  const names = certProfiles(sdk).names;
  const state = store.getState().certProfile;
  return [preferred, state, TIZEN_DEV_PROFILE].concat(names).filter((n, i, a) => n && a.indexOf(n) === i
    && (n === TIZEN_DEV_PROFILE || names.indexOf(n) >= 0));
}

// Everything the install needs, as a checklist the UI can show before anything is attempted.
async function preflight(tv, pcIp, sdkRootOverride) {
  const tvLib = require('./tv');
  const checks = [];
  const sdk = findSdk(sdkRootOverride);
  checks.push({ id: 'sdk', ok: !!sdk, label: 'Tizen SDK installed', detail: sdk ? sdk.root : 'Not found', help: 'sdk' });

  let profiles = { names: [], active: null };
  if (sdk) profiles = certProfiles(sdk);
  checks.push({
    id: 'cert', ok: true, label: 'Signing certificate',
    detail: (profiles.names.length ? 'Found: ' + profiles.names.join(', ') + '. ' : '') + 'Dock TV creates "' + TIZEN_DEV_PROFILE + '" for you if needed (no account required).', help: 'cert',
  });

  const info = tv ? await tvLib.getTvInfo(tv.ip) : null;
  checks.push({ id: 'tv', ok: !!info, label: 'TV answers on the network', detail: tv ? tv.ip : 'No TV selected', help: 'tv' });
  const d = (info && info.json.device) || {};
  const devOn = String(d.developerMode) === '1';
  checks.push({ id: 'dev', ok: devOn, label: 'Developer Mode is on', detail: devOn ? 'On' : 'Off', help: 'dev' });
  const pointsHere = !d.developerIP || d.developerIP === pcIp;
  checks.push({
    id: 'devip', ok: true, warn: !pointsHere, label: 'Developer Mode IP' + (pointsHere ? ' matches this PC' : ' differs from this PC (usually still works)'),
    detail: 'TV has ' + (d.developerIP || 'none') + ', this PC is ' + pcIp, help: 'dev',
  });
  return { checks, ready: checks.every((c) => c.ok), sdk: sdk && { root: sdk.root }, profiles, duid: d.duid || '' };
}

// Builds the signed package from the staged launcher and installs it. `log` receives progress lines.
async function installWith({ tv, pcIp, layout, certProfile, sdkRoot, log, dryRun }) {
  const sdk = findSdk(sdkRoot);
  if (!sdk) throw new Error('The Tizen SDK was not found.');
  const env = Object.assign({}, process.env, { TIZEN_STUDIO_DIR: sdk.root, TIZEN_STUDIO: sdk.root });

  const serial = await connect(sdk, tv.ip);
  if (!serial) throw new Error('SDB could not connect to ' + tv.ip + ':' + SDB_PORT + '. Restart the TV (hold power for 5+ seconds) and try again.');
  log('Connected over SDB: ' + serial);

  // Save the app list once, before the first install.
  let backup = store.latestBackup();
  if (!backup) backup = path.join(store.files.backups(), 'backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
  if (!fs.existsSync(path.join(backup, 'installed-apps.txt'))) {
    const ok = await saveAppList(sdk, serial, backup);
    log(ok ? 'Saved the TV\u2019s installed-app list.' : 'The TV would not list its apps over SDB; continuing.');
  }

  const cert = certProfile;
  if (!cert) throw new Error('No certificate profile to sign with.');
  if (cert === TIZEN_DEV_PROFILE) await ensureTizenProfile(sdk, log, env);
  else if (certProfiles(sdk).names.indexOf(cert) < 0) throw new Error('Certificate profile "' + cert + '" does not exist.');
  log('Signing with certificate profile: ' + cert);
  const duid = await getDuid(sdk, serial);
  if (duid) log('This TV’s DUID: ' + duid);
  const deviceProfile = deviceProfileFor(sdk, cert);
  if (deviceProfile && !dryRun) {
    // "Permit to install applications": give the TV the distributor's device profile.
    const push = await run(sdk.sdb, ['-s', serial, 'push', deviceProfile, '/home/developer/'], { timeoutMs: 30000 });
    if (/pushed/.test(push.text)) log('Sent the certificate’s device profile to the TV.');
  }

  // The newest TV profile the SDK has installed.
  let apiVersion = '10.0';
  const tpl = await run(sdk.tz, ['list', 'templates'], { env, timeoutMs: 60000 });
  const versions = [];
  tpl.text.split(/\r?\n/).forEach((line) => {
    const m = /^\s*tv-samsung-(\d+)\.(\d+)\s*:\s*$/.exec(line);
    if (m) versions.push([Number(m[1]), Number(m[2])]);
  });
  if (versions.length) {
    versions.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    apiVersion = versions[0][0] + '.' + versions[0][1];
  } else {
    log('No TV profile found in the SDK. In VS Code: Tizen sidebar > Packages > Advanced > install the TV extension. Trying anyway.');
  }

  // Stage a clean project folder (never build inside the live preview folder).
  const work = path.join(store.files.root(), 'build', 'Dock');
  fs.rmSync(work, { recursive: true, force: true });
  copyDirSync(store.files.stage(), work, (n) => n === 'SOURCES.txt');
  fs.writeFileSync(path.join(work, 'config.xml'), layoutLib.toConfigXml(layout), 'utf8');
  // The Spotify login goes into this temporary build copy only, never into the preview or stage.
  const auth = layout.spotify.enabled ? spotifyAuthFor(layout) : null;
  fs.writeFileSync(path.join(work, 'js', 'spotify-config.js'), 'window.SPOTIFY_AUTH = ' + JSON.stringify(auth || {}) + ';\n', 'utf8');
  log(auth ? 'Spotify login included in the app.' : (layout.spotify.enabled ? 'Spotify is on but not connected yet; its card stays hidden.' : 'Spotify is off.'));
  const photos = fs.existsSync(path.join(work, 'wallpapers'))
    ? fs.readdirSync(path.join(work, 'wallpapers')).filter((f) => /\.jpe?g$/i.test(f)).length : 0;
  log(photos ? photos + ' wallpapers included.' : 'No wallpapers: the Dock will use a plain background.');

  const files = listFiles(work).filter((f) => f !== 'config.xml');
  fs.writeFileSync(path.join(work, 'tizen_web_project.yaml'),
    projectYaml({ profile: 'tv-samsung', apiVersion, certProfile: cert, files }), 'utf8');

  log('Building...');
  const build = await run(sdk.tz, ['build', '-b', 'Release', '-w', work, '-s', cert], { env });
  if (build.code !== 0) throw new Error('Build failed:\n' + build.text);
  log('Packaging...');
  const pack = await run(sdk.tz, ['pack', '-w', work, '-s', cert], { env });
  const wgt = listFiles(work).filter((f) => /\.wgt$/i.test(f)).map((f) => path.join(work, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (pack.code !== 0 || !wgt) {
    throw new Error('Packaging failed:\n' + pack.text + (/certificate|profile|password|sign/i.test(pack.text)
      ? '\nCheck the profile in VS Code: Tizen sidebar > Certificate Manager.' : ''));
  }
  if (dryRun) {
    log('Dry run: signed package built (' + Math.round(fs.statSync(wgt).size / 1024) + ' KB). Nothing was installed.');
    fs.rmSync(work, { recursive: true, force: true });
    return { dryRun: true, certProfile: cert };
  }
  log('Installing on the TV...');
  const inst = await run(sdk.tz, ['install', '-e', serial, '-p', wgt], { env });
  const installed = (/install completed|cmd_ret:0\b/.test(inst.text) || inst.code === 0) && !/install failed|cmd_ret:-?[1-9]/.test(inst.text);
  if (!installed) {
    throw new Error('Install failed:\n' + inst.text + (/certificate|signature|author|-11|-12/i.test(inst.text)
      ? '\nThe certificate does not match this TV. Recreate it in VS Code with this TV\u2019s DUID ticked.' : ''));
  }
  log('Installed on the TV.');

  const open = await run(sdk.sdb, ['-s', serial, 'shell', '0', 'was_execute', layoutLib.APP_ID], { timeoutMs: 30000 });
  const launched = new RegExp('app_id\\[' + layoutLib.APP_ID.replace('.', '\\.') + '\\] (launched|resumed)').test(open.text);
  log(launched ? 'Dock is open on the TV.' : 'Installed. Open it yourself: Home > APPS > Dock.');
  fs.rmSync(work, { recursive: true, force: true }); // the build copy holds the Spotify login
  store.setState({ installed: true, installedAt: new Date().toISOString(), serial, sdkPath: sdk.root, certProfile: cert });
  return { launched };
}

// Tries each certificate profile in turn (a TV only accepts the one made with its DUID),
// unless one was chosen. Stops at the first success; reports the last error otherwise.
async function buildAndInstall(opts) {
  const found = findSdk(opts.sdkRoot);
  if (!found) throw new Error('The Tizen SDK was not found.');
  const order = opts.certProfile ? [opts.certProfile] : profileOrder(found, null);
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    try {
      return await installWith(Object.assign({}, opts, { certProfile: order[i] }));
    } catch (e) {
      lastErr = e;
      if (i < order.length - 1) opts.log('Profile "' + order[i] + '" was not accepted; trying "' + order[i + 1] + '".');
    }
  }
  throw lastErr;
}

// Samsung TVs only accept a few "0 ..." commands over SDB, so try the TV uninstaller first.
async function uninstall({ tv, sdkRoot }) {
  const sdk = findSdk(sdkRoot);
  if (!sdk || !tv) return false;
  const serial = await connect(sdk, tv.ip);
  if (!serial) return false;
  const pkg = layoutLib.PACKAGE_ID;
  const tries = [
    ['-s', serial, 'shell', '0', 'vd_appuninstall', layoutLib.APP_ID],
    ['-s', serial, 'uninstall', pkg],
    ['-s', serial, 'shell', 'pkgcmd', '-u', '-n', pkg],
  ];
  const first = await run(sdk.sdb, ['-s', serial, 'shell', '0', 'applist'], { timeoutMs: 30000 });
  const listUsable = first.text.indexOf(pkg) >= 0;
  for (const t of tries) {
    const r = await run(sdk.sdb, t, { timeoutMs: 30000 });
    const after = await run(sdk.sdb, ['-s', serial, 'shell', '0', 'applist'], { timeoutMs: 30000 });
    if (listUsable && after.text.indexOf(pkg) < 0) return true;
    if (!listUsable && /success|completed|uninstalled/i.test(r.text) && !/fail/i.test(r.text)) return true;
  }
  return false;
}

module.exports = { TIZEN_DEV_PROFILE, profileOrder, spotifyAuthFor, deviceProfileFor, findSdk, certProfiles, pickProfile, preflight, buildAndInstall, uninstall, parseApps, connect, saveAppList, projectYaml, isSdkRoot, copyDirSync, listFiles };
