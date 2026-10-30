// Everything personal (your TV, backups, change log, wallpapers) lives in the per-user
// data folder, never next to the app, so nothing private can end up in a repo or a zip.
const fs = require('fs');
const path = require('path');

let root = null;

function init(dir) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
}

const p = (...parts) => path.join(root, ...parts);

function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

const files = {
  root: () => root,
  tv: () => p('tv.json'),
  state: () => p('state.json'),
  log: () => p('settings-log.json'),
  layout: () => p('layout.json'),
  stage: () => p('stage'),
  wallpapers: () => p('stage', 'wallpapers'),
  wallpapersNight: () => p('stage', 'wallpapers-night'),
  spotify: () => p('spotify.json'),
  backups: () => p('backups'),
};

function getState() { return root ? readJson(files.state(), {}) : {}; }
function setState(patch) { writeJson(files.state(), Object.assign(getState(), patch)); }

function latestBackup() {
  try {
    const names = fs.readdirSync(files.backups()).filter((n) => n.startsWith('backup-')).sort();
    return names.length ? path.join(files.backups(), names[names.length - 1]) : null;
  } catch (e) {
    return null;
  }
}

// ----- settings change log (what the privacy clean-up changed, so Restore can undo it) -----
function getLog() { return readJson(files.log(), { tv: '', updated: '', entries: [] }); }

function upsertEntry(entry, tvModel) {
  const log = getLog();
  log.tv = tvModel || log.tv;
  log.updated = new Date().toISOString();
  log.entries = log.entries.filter((e) => e.id !== entry.id).concat([entry]);
  writeJson(files.log(), log);
  return log;
}

function removeEntry(id) {
  const log = getLog();
  log.entries = log.entries.filter((e) => e.id !== id);
  log.updated = new Date().toISOString();
  writeJson(files.log(), log);
  return log;
}

module.exports = { removeEntry, init, files, readJson, writeJson, getState, setState, latestBackup, getLog, upsertEntry };
