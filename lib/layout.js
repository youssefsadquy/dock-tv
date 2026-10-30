// The Dock settings: which apps, widgets and photos. One JSON document drives both the live
// preview in the app and the build that goes to the TV. Anything personal (your town, bus
// stop, prayer-time tuning, Spotify) is a setting here, never a default in the launcher.

// Tile colours are used when the TV has no sharp icon for the app. IDs listed are the ones
// known to work; every app is also found by name on the TV at runtime.
const APP_PRESETS = [
  { name: 'Netflix', ids: ['org.tizen.netflix-app', 'RN1MCdNq8t.Netflix'], match: 'netflix', color: '#141414', text: '#F5F5F1' },
  { name: 'YouTube', ids: ['com.samsung.tv.cobalt-yt', '9Ur5IzDKqV.TizenYouTube'], match: 'youtube', color: '#E62117', text: '#FFFFFF' },
  { name: 'Spotify', ids: ['rJeHak5zRg.Spotify'], match: 'spotify', color: '#121212', text: '#1ED760' },
  { name: 'Prime Video', ids: [], match: 'prime video', color: '#00A8E1', text: '#FFFFFF' },
  { name: 'Disney+', ids: [], match: 'disney', color: '#0B1E5B', text: '#FFFFFF' },
  { name: 'Apple TV', ids: [], match: 'apple tv', color: '#111111', text: '#FFFFFF' },
  { name: 'Plex', ids: [], match: 'plex', color: '#1F1F1F', text: '#E5A00D' },
  { name: 'Twitch', ids: [], match: 'twitch', color: '#6441A5', text: '#FFFFFF' },
  { name: 'BBC iPlayer', ids: [], match: 'iplayer', color: '#F54997', text: '#FFFFFF' },
  { name: 'Internet', ids: [], match: 'internet', color: '#1A3A5C', text: '#FFFFFF' },
];

// Aladhan calculation methods people ask for most (id -> label).
const PRAYER_METHODS = {
  2: 'ISNA (North America)', 3: 'Muslim World League', 4: 'Umm al-Qura (Makkah)', 5: 'Egyptian General Authority',
  1: 'Karachi (Univ. of Islamic Sciences)', 15: 'Moonsighting Committee', 13: 'Diyanet (Turkey)',
  12: 'UOIF (France)', 16: 'Dubai', 17: 'JAKIM (Malaysia)', 11: 'MUIS (Singapore)',
};

const DEFAULT_LAYOUT = {
  version: 2,
  apps: APP_PRESETS.slice(0, 3),
  settings: { wallpaperSeconds: 45, fadeMs: 2000, slowZoom: false, idleMinutes: 3, appIcons: 'auto', dropLog: true },
  inputs: { enabled: true, liveTv: true, labels: {}, hide: [] },
  night: { enabled: true, from: '22:00', to: '07:00', level: 2 },
  weather: { enabled: false, place: '', latitude: null, longitude: null, timezone: 'auto' },
  bus: { enabled: false, line: '', stopId: '', stopName: '', stop: '', from: '05:00', to: '10:00' },
  prayer: { enabled: false, place: '', latitude: null, longitude: null, method: 2, school: 0, tune: '0,0,0,0,0,0,0,0,0', timezone: 'auto' },
  spotify: { enabled: false, playlistUri: '', playlistName: '', sdkPlayerUrl: '', preferDevice: 'Dock TV', pollSeconds: 5 },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v, lo, hi, d) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v, max, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const hhmm = (v, d) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);
const tz = (v) => (typeof v === 'string' && /^[A-Za-z_]+(\/[A-Za-z_\-+0-9]+){0,2}$/.test(v) ? v : 'auto');

function place(src, dst) {
  dst.place = str(src.place, 60);
  dst.latitude = num(src.latitude, -90, 90, null);
  dst.longitude = num(src.longitude, -180, 180, null);
  dst.timezone = tz(src.timezone);
  // A widget with no resolved location cannot work, so it stays off.
  if (dst.latitude === null || dst.longitude === null) dst.enabled = false;
}

// Accepts anything (an old file, a hand edit) and returns a safe, complete settings object.
function normalize(input) {
  const d = clone(DEFAULT_LAYOUT);
  const l = input && typeof input === 'object' ? input : {};

  if (Array.isArray(l.apps)) {
    d.apps = l.apps.slice(0, 8).map((a) => ({
      name: str(a && a.name, 24),
      ids: Array.isArray(a && a.ids) ? a.ids.map(String).filter(Boolean).slice(0, 6) : [],
      match: str(a && a.match, 40),
      color: color(a && a.color, '#1f2a33'),
      text: color(a && a.text, '#FFFFFF'),
    })).filter((a) => a.name && (a.ids.length || a.match));
  }

  const s = l.settings || {};
  d.settings.wallpaperSeconds = num(s.wallpaperSeconds, 10, 600, d.settings.wallpaperSeconds);
  d.settings.fadeMs = num(s.fadeMs, 0, 6000, d.settings.fadeMs);
  d.settings.slowZoom = bool(s.slowZoom, false);
  d.settings.idleMinutes = num(s.idleMinutes, 0, 120, d.settings.idleMinutes);
  d.settings.appIcons = s.appIcons === 'never' ? 'never' : 'auto';
  d.settings.dropLog = bool(s.dropLog, true);

  const i = l.inputs || {};
  d.inputs.enabled = bool(i.enabled, true);
  d.inputs.liveTv = bool(i.liveTv, true);
  if (i.labels && typeof i.labels === 'object') {
    Object.keys(i.labels).slice(0, 8).forEach((k) => { if (/^HDMI\d$/.test(k)) d.inputs.labels[k] = str(i.labels[k], 20); });
  }
  d.inputs.hide = Array.isArray(i.hide) ? i.hide.filter((k) => /^HDMI\d$/.test(k)).slice(0, 8) : [];

  const n = l.night || {};
  d.night.enabled = bool(n.enabled, true);
  d.night.from = hhmm(n.from, d.night.from);
  d.night.to = hhmm(n.to, d.night.to);
  d.night.level = Math.round(num(n.level, 1, 4, 2));

  const w = l.weather || {};
  d.weather.enabled = bool(w.enabled, false);
  place(w, d.weather);

  const b = l.bus || {};
  d.bus.enabled = bool(b.enabled, false);
  d.bus.line = str(b.line, 12);
  d.bus.stopId = typeof b.stopId === 'string' && /^[A-Za-z0-9]{3,20}$/.test(b.stopId) ? b.stopId : '';
  d.bus.stopName = str(b.stopName, 60);
  d.bus.stop = str(b.stop, 20);
  d.bus.from = hhmm(b.from, d.bus.from);
  d.bus.to = hhmm(b.to, d.bus.to);
  if (!d.bus.line || !d.bus.stopId) d.bus.enabled = false;

  const p = l.prayer || {};
  d.prayer.enabled = bool(p.enabled, false);
  place(p, d.prayer);
  d.prayer.method = Math.round(num(p.method, 0, 24, 2));
  d.prayer.school = p.school === 1 ? 1 : 0;
  d.prayer.tune = /^-?\d+(,-?\d+){8}$/.test(String(p.tune)) ? String(p.tune) : d.prayer.tune;

  const sp = l.spotify || {};
  d.spotify.enabled = bool(sp.enabled, false);
  d.spotify.playlistUri = /^spotify:(playlist|album|artist|track):[A-Za-z0-9]+$/.test(String(sp.playlistUri)) ? String(sp.playlistUri) : '';
  d.spotify.playlistName = str(sp.playlistName, 60);
  d.spotify.sdkPlayerUrl = /^https:\/\/[A-Za-z0-9.\-]+(\/[A-Za-z0-9._~\-\/]*)?$/.test(String(sp.sdkPlayerUrl)) ? String(sp.sdkPlayerUrl) : '';
  d.spotify.preferDevice = str(sp.preferDevice, 40, d.spotify.preferDevice);
  d.spotify.pollSeconds = Math.round(num(sp.pollSeconds, 2, 60, 5));
  return d;
}

// The file the launcher loads on the TV (and in the preview).
function toConfigJs(l) {
  const j = (v) => JSON.stringify(v, null, 2);
  const apps = l.apps.map((a) => ({ name: a.name, ids: a.ids, match: a.match, color: a.color, text: a.text }));
  return [
    '/* Generated by Dock TV. Do not edit by hand. */',
    'var DOCK_APPS = ' + j(apps) + ';',
    'var DOCK_SETTINGS = ' + j(Object.assign({}, l.settings, { keyDebug: false })) + ';',
    'var DOCK_SPOTIFY = ' + j(l.spotify) + ';',
    'var DOCK_WEATHER = ' + j(l.weather) + ';',
    'var DOCK_INPUTS = ' + j(l.inputs) + ';',
    'var DOCK_NIGHT = ' + j(l.night) + ';',
    'var DOCK_BUS = ' + j(l.bus) + ';',
    'var DOCK_PRAYER = ' + j(l.prayer) + ';',
    '',
  ].join('\n');
}

const APP_ID = 'HmDockTV01.Dock';
const PACKAGE_ID = 'HmDockTV01';

// config.xml is generated so network access is only requested for widgets that are on.
function toConfigXml(l) {
  const access = ['https://speed.cloudflare.com'];
  if (l.weather.enabled) access.push('https://api.open-meteo.com');
  if (l.bus.enabled) access.push('https://api.tfl.gov.uk');
  if (l.prayer.enabled) access.push('https://api.aladhan.com');
  if (l.spotify.enabled) {
    access.push('https://api.spotify.com', 'https://accounts.spotify.com', 'https://scdn.co', 'https://mosaic.scdn.co',
      'https://spotifycdn.com', 'https://sdk.scdn.co', 'https://spotify.com', 'https://spclient.wg.spotify.com',
      'https://api-partner.spotify.com', 'https://apresolve.spotify.com', 'https://seektables.scdn.co');
    const m = /^https:\/\/[^/]+/.exec(l.spotify.sdkPlayerUrl || '');
    if (m) access.push(m[0]);
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://homedock.local/Dock" version="1.0.0" viewmodes="maximized">',
    '    <tizen:application id="' + APP_ID + '" package="' + PACKAGE_ID + '" required_version="2.3"/>',
    '    <content src="index.html"/>',
    '    <feature name="http://tizen.org/feature/screen.size.normal.1080.1920"/>',
    '    <icon src="icon.png"/>',
    '    <name>Dock</name>',
    '    <description>Minimal home screen: a dock of favourite apps over rotating photos.</description>',
    '    <tizen:privilege name="http://tizen.org/privilege/application.launch"/>',
    '    <tizen:privilege name="http://tizen.org/privilege/application.info"/>',
    '    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>',
    '    <tizen:privilege name="http://tizen.org/privilege/internet"/>',
    '    <tizen:privilege name="http://tizen.org/privilege/tv.window"/>',
    '    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>',
  ].concat(access.map((o) => '    <access origin="' + o + '" subdomains="true"/>'));
  if (l.spotify.enabled) lines.push('    <access origin="wss://spotify.com" subdomains="true"/>');
  return lines.concat([
    '    <tizen:metadata key="http://samsung.com/tv/metadata/multitasking.support" value="true"/>',
    '    <tizen:app-control>',
    '        <tizen:src name="index.html" reload="disable"/>',
    '        <tizen:operation name="http://samsung.com/appcontrol/operation/eden_resume"/>',
    '    </tizen:app-control>',
    '    <tizen:profile name="tv-samsung"/>',
    '    <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="enable" encryption="disable" install-location="auto" hwkey-event="enable"/>',
    '</widget>',
    '',
  ]).join('\n');
}

module.exports = { DEFAULT_LAYOUT, APP_PRESETS, PRAYER_METHODS, APP_ID, PACKAGE_ID, normalize, toConfigJs, toConfigXml, clone };
