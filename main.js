const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const store = require('./lib/store');
const tvLib = require('./lib/tv');
const sdk = require('./lib/sdk');
const layoutLib = require('./lib/layout');
const wallpapers = require('./lib/wallpapers');
const places = require('./lib/places');
const spotify = require('./lib/spotify');
const { STEPS, WARNING } = require('./lib/steps');

let win = null;
const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

// ---------- the staged launcher (live preview + build source) ----------
function copyTemplate() {
  const src = path.join(__dirname, 'launcher');
  const dst = store.files.stage();
  // Never overwrite the user's photo credits with the empty template ones.
  sdk.copyDirSync(src, dst, (n) => n === 'credits.js' || n === 'credits-night.js' || n === 'spotify-config.js');
  fs.mkdirSync(store.files.wallpapers(), { recursive: true });
  fs.mkdirSync(store.files.wallpapersNight(), { recursive: true });
  if (!fs.existsSync(path.join(store.files.wallpapers(), 'credits.js'))) wallpapers.writeCredits([], 'day');
  if (!fs.existsSync(path.join(store.files.wallpapersNight(), 'credits-night.js'))) wallpapers.writeCredits([], 'night');
  fs.mkdirSync(path.join(dst, 'js'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'js', 'spotify-config.js'), 'window.SPOTIFY_AUTH = {};\n', 'utf8'); // the preview never gets a login
}

function writeStage(layout) {
  const js = path.join(store.files.stage(), 'js');
  fs.mkdirSync(js, { recursive: true });
  fs.writeFileSync(path.join(js, 'dock-config.js'), layoutLib.toConfigJs(layout), 'utf8');
}

function loadLayout() { return layoutLib.normalize(store.readJson(store.files.layout(), null)); }

function saveLayout(input) {
  const layout = layoutLib.normalize(input);
  store.writeJson(store.files.layout(), layout);
  writeStage(layout);
  return layout;
}

function savedTv() {
  const tv = store.readJson(store.files.tv(), null);
  return tv ? Object.assign({}, tv, { compat: tvLib.compatibility(tv.model) }) : null;
}

function requireTv() {
  const tv = store.readJson(store.files.tv(), null);
  if (!tv) throw new Error('No TV selected yet. Go to step 1.');
  return tv;
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: store.files.root(),
    stageUrl: pathToFileURL(path.join(store.files.stage(), 'index.html')).href,
  }));

  // --- TV ---
  ipcMain.handle('app:meta', () => ({ prayerMethods: layoutLib.PRAYER_METHODS, presets: layoutLib.APP_PRESETS }));
  ipcMain.handle('tv:pc', () => tvLib.getPcIPv4());
  ipcMain.handle('tv:scan', async () => {
    const tvs = await tvLib.scan({ onProgress: (p) => send('tv:progress', p) });
    return tvs.map((tv) => Object.assign({}, tv, { compat: tvLib.compatibility(tv.model) }));
  });
  ipcMain.handle('tv:probe', async (_e, ip) => {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(String(ip))) throw new Error('That is not an IP address (example: 192.168.1.50).');
    const info = await tvLib.getTvInfo(ip);
    if (!info || !tvLib.isSamsung(info)) return null;
    const pc = tvLib.getPcIPv4();
    const tv = tvLib.summarize(ip, info.json, pc && pc.ip);
    return Object.assign({}, tv, { compat: tvLib.compatibility(tv.model) });
  });
  ipcMain.handle('tv:saved', () => savedTv());
  ipcMain.handle('tv:select', (_e, tv) => {
    const { compat, ...clean } = tv;
    store.writeJson(store.files.tv(), clean);
    return savedTv();
  });
  ipcMain.handle('tv:forget', () => { fs.rmSync(store.files.tv(), { force: true }); return true; });

  ipcMain.handle('tv:backup', async () => {
    const tv = requireTv();
    const raw = await tvLib.getTvInfo(tv.ip);
    if (!raw) throw new Error('The TV did not answer at ' + tv.ip + '. Switch it on (not standby), or find it again if its IP changed.');
    const dir = path.join(store.files.backups(), 'backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tv-info.json'), raw.raw, 'utf8');
    const pc = tvLib.getPcIPv4();
    fs.writeFileSync(path.join(dir, 'pc-network.txt'), pc ? 'IP ' + pc.ip + '\r\nAdapter ' + pc.iface + '\r\n' : 'unknown\r\n', 'utf8');

    let appList = false;
    const found = sdk.findSdk();
    const d = raw.json.device || {};
    if (found && String(d.developerMode) === '1' && (!d.developerIP || d.developerIP === (pc && pc.ip))) {
      const serial = await sdk.connect(found, tv.ip);
      if (serial) appList = await sdk.saveAppList(found, serial, dir);
    }
    const photos = [
      'Home bar: press Home and photograph the whole row of tiles (scroll right for the rest).',
      'Settings > Support > Terms & Policy (every item listed there).',
      'Settings > General > Smart Features.',
      'Settings > General > Network > Network Status > IP Settings (the DNS line).',
      'Settings > General > Network > Expert Settings.',
      'Settings > Support > About This TV.',
    ];
    fs.writeFileSync(path.join(dir, 'README.txt'),
      'Backup taken ' + new Date().toString() + '\r\nTV: ' + tv.model + '\r\n\r\nPhotos to keep with this backup:\r\n  - ' + photos.join('\r\n  - ') + '\r\n', 'utf8');
    store.setState({ lastBackup: dir });
    return { dir, appList, photos };
  });

  // --- privacy clean-up log ---
  ipcMain.handle('steps:list', () => ({
    steps: STEPS, warning: WARNING, log: store.getLog().entries, hasBackup: !!store.latestBackup(),
  }));
  ipcMain.handle('steps:record', (_e, entry) => {
    const def = STEPS.find((s) => s.id === entry.id);
    if (!def) throw new Error('Unknown step.');
    const clean = {
      id: def.id, name: def.name, path: def.path,
      before: String(entry.before || ''), after: String(entry.after || ''),
      changed: !!entry.changed, restored: false, skipped: !!entry.skipped,
      time: new Date().toISOString(),
    };
    if (Array.isArray(entry.items)) clean.items = entry.items.map(String).slice(0, 40);
    if (Array.isArray(entry.tiles)) clean.tiles = entry.tiles.map(String).slice(0, 40);
    const tv = store.readJson(store.files.tv(), null);
    return store.upsertEntry(clean, tv && tv.model).entries;
  });

  ipcMain.handle('steps:reset', (_e, id) => {
    const log = store.getLog();
    const e = log.entries.find((x) => x.id === id);
    if (e && e.changed) throw new Error('That change is already made on the TV. Use Restore to undo it.');
    return store.removeEntry(id).entries;
  });

  // --- layout / design ---
  ipcMain.handle('layout:get', () => loadLayout());
  ipcMain.handle('layout:save', (_e, l) => saveLayout(l));
  ipcMain.handle('layout:reset', () => saveLayout(layoutLib.DEFAULT_LAYOUT));

  ipcMain.handle('weather:find', (_e, q) => places.findPlace(q));
  ipcMain.handle('bus:find', (_e, q) => places.findBusStops(q));

  // --- Spotify (one-time login; the token never leaves this PC except inside the build for your TV) ---
  const spotifyStatus = () => {
    const s = store.readJson(store.files.spotify(), null);
    return s && s.refreshToken ? { connected: true, clientId: s.clientId, name: s.name || '' } : { connected: false, clientId: (s && s.clientId) || '' };
  };
  ipcMain.handle('spotify:status', () => spotifyStatus());
  ipcMain.handle('spotify:uri', async (_e, link) => {
    const uri = spotify.toSpotifyUri(link);
    if (!uri) throw new Error('That does not look like a Spotify playlist link.');
    return uri;
  });
  ipcMain.handle('spotify:login', async (_e, clientId) => {
    const r = await spotify.login(String(clientId || '').trim(), (u) => shell.openExternal(u));
    store.writeJson(store.files.spotify(), { clientId: r.clientId, refreshToken: r.refreshToken, name: r.name, connectedAt: new Date().toISOString() });
    return spotifyStatus();
  });
  ipcMain.handle('spotify:forget', () => { fs.rmSync(store.files.spotify(), { force: true }); return spotifyStatus(); });

  // --- wallpapers (kind is 'day' or 'night') ---
  const kindOf = (k) => (k === 'night' ? 'night' : 'day');
  ipcMain.handle('wp:list', (_e, kind) => wallpapers.currentList(kindOf(kind)));
  ipcMain.handle('wp:fetch', async (_e, opts) => wallpapers.fetchFromWikimedia({
    categories: (opts && opts.categories) || [], count: Math.min(30, Number(opts && opts.count) || 12),
    kind: kindOf(opts && opts.kind), onProgress: (p) => send('wp:progress', p),
  }));
  ipcMain.handle('wp:pick', async (_e, kind) => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose your pictures', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
    });
    if (r.canceled || !r.filePaths.length) return 0;
    return wallpapers.importFiles(r.filePaths, nativeImage, (p) => send('wp:progress', p), kindOf(kind));
  });
  ipcMain.handle('wp:clear', (_e, kind) => { wallpapers.clearPhotos(kindOf(kind)); wallpapers.writeCredits([], kindOf(kind)); return true; });

  // --- apps found on the TV (from the backup's app list) ---
  ipcMain.handle('apps:fromTv', () => {
    const dir = store.latestBackup();
    const file = dir && path.join(dir, 'installed-apps.txt');
    if (!file || !fs.existsSync(file)) return { apps: [], presets: layoutLib.APP_PRESETS };
    const apps = sdk.parseApps(fs.readFileSync(file, 'utf8'))
      .filter((a) => !/^(org\.tizen|com\.samsung\.tv|com\.samsung\.sec|com\.samsung\.tizen|hdmicec|org\.volt)/i.test(a.id) || /netflix|youtube|spotify|prime|disney/i.test(a.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { apps, presets: layoutLib.APP_PRESETS };
  });

  // --- install ---
  ipcMain.handle('install:preflight', async () => {
    const tv = savedTv();
    const pc = tvLib.getPcIPv4();
    const r = await sdk.preflight(tv, pc && pc.ip, store.getState().sdkPath);
    return Object.assign(r, { pcIp: pc && pc.ip, tv, compat: tv && tv.compat });
  });
  ipcMain.handle('install:pickSdk', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the Tizen SDK folder (it contains tools\\sdb.exe)', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    if (!sdk.isSdkRoot(r.filePaths[0])) throw new Error('That folder has no tools\\sdb.exe and tools\\tizen-core\\tz.exe.');
    store.setState({ sdkPath: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('install:run', async (_e, opts) => {
    const tv = requireTv();
    const pc = tvLib.getPcIPv4();
    const layout = saveLayout(loadLayout());
    return sdk.buildAndInstall({
      tv, pcIp: pc && pc.ip, layout, certProfile: opts && opts.certProfile,
      sdkRoot: store.getState().sdkPath, log: (line) => send('install:log', line),
    });
  });

  // --- restore ---
  ipcMain.handle('restore:list', () => {
    const entries = store.getLog().entries.filter((e) => e.changed && !e.restored).reverse();
    return { entries, installed: !!store.getState().installed };
  });
  ipcMain.handle('restore:done', (_e, id) => {
    const log = store.getLog();
    const e = log.entries.find((x) => x.id === id);
    if (e) { e.restored = true; store.upsertEntry(e); }
    return true;
  });
  ipcMain.handle('restore:uninstall', async (_e, opts) => {
    if (opts && opts.manual) { store.setState({ installed: false }); return true; }
    const ok = await sdk.uninstall({ tv: requireTv(), sdkRoot: store.getState().sdkPath });
    if (ok) store.setState({ installed: false });
    return ok;
  });
  ipcMain.handle('restore:devOff', () => true);

  // --- shell ---
  ipcMain.handle('open:folder', () => shell.openPath(store.files.root()));
  ipcMain.handle('open:link', (_e, url) => {
    const u = new URL(String(url));
    const ok = u.protocol === 'https:' && ['code.visualstudio.com', 'marketplace.visualstudio.com', 'commons.wikimedia.org', 'github.com', 'developer.spotify.com', 'accounts.spotify.com'].indexOf(u.hostname) >= 0;
    if (!ok) throw new Error('Blocked link.');
    return shell.openExternal(u.href);
  });
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 1000, minHeight: 680,
    backgroundColor: '#0e1318', title: 'Dock TV', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Test-only: DOCKTV_PAGE=<file URL> loads the staged launcher directly (used to test dragging).
  const testPage = process.env.DOCKTV_PAGE;
  if (testPage && /^file:/i.test(testPage)) win.loadURL(testPage);
  else win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  // Links in the UI never navigate the app window.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const shotIdx = process.argv.indexOf('--shot');
  if (shotIdx > 0) {
    const out = process.argv[shotIdx + 1];
    const viewIdx = process.argv.indexOf('--view');
    const view = viewIdx > 0 ? process.argv[viewIdx + 1] : 'connect';
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1200));
      const evalIdx = process.argv.indexOf('--run-js');
      if (evalIdx > 0) {
        let result;
        try { result = await win.webContents.executeJavaScript(fs.readFileSync(process.argv[evalIdx + 1], 'utf8')); } catch (e) { result = { error: String(e) }; }
        fs.writeFileSync(out + '.json', JSON.stringify(result, null, 1));
      } else {
        await win.webContents.executeJavaScript('window.__go && window.__go(' + JSON.stringify(view) + ')');
      }
      await new Promise((r) => setTimeout(r, 2500));
      // Test-only: the DevTools protocol screenshot works even when the window is not on screen.
      const dbg = win.webContents.debugger;
      dbg.attach('1.3');
      const shot = await dbg.sendCommand('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store.init(process.env.DOCKTV_DATA || path.join(app.getPath('userData'), 'data'));
  copyTemplate();
  writeStage(loadLayout());
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
