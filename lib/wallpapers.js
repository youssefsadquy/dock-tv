// Wallpapers: free photos from Wikimedia Commons Featured Pictures (credit shown on screen,
// as the licences require), or your own pictures, resized to TV size.
// Day photos live in stage/wallpapers (credits.js); night photos in stage/wallpapers-night
// (credits-night.js), which the launcher switches to while night mode is on.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const UA = 'DockTV/1.0 (home-screen wallpaper tool)';

const CATEGORIES = {
  landscapes: 'Featured pictures of landscapes',
  mountains: 'Featured pictures of mountains',
  coasts: 'Featured pictures of coasts',
  islands: 'Featured pictures of islands',
  forests: 'Featured pictures of forests',
  space: 'Featured pictures of astronomy',
};

const dirFor = (kind) => (kind === 'night' ? store.files.wallpapersNight() : store.files.wallpapers());
const creditsFile = (kind) => (kind === 'night' ? 'credits-night.js' : 'credits.js');

function clean(html, max) {
  if (!html) return '';
  const t = String(html).replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '...' : t;
}

// Wikimedia artist fields often read "Original: X Derivative work: Y". Keep the original author.
function author(text) {
  return clean(text, 90).replace(/^Original:\s*/i, '').replace(/\s+Derivative work:.*$/i, '');
}

async function candidates(category) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json'
    + '&generator=categorymembers&gcmtype=file&gcmlimit=50'
    + '&gcmtitle=' + encodeURIComponent('Category:' + category)
    + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1920'
    + '&iiextmetadatafilter=' + encodeURIComponent('Artist|LicenseShortName|ObjectName')
    + '&gcmstartsortkeyprefix=' + 'ABCDEFGHIJKLMNOPRSTW'[Math.floor(Math.random() * 20)];
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('Wikimedia answered ' + res.status);
  const json = await res.json();
  const pages = json.query && json.query.pages ? Object.values(json.query.pages) : [];
  const out = [];
  for (const page of pages) {
    const ii = page.imageinfo && page.imageinfo[0];
    if (!ii || ii.mime !== 'image/jpeg' || !ii.thumburl) continue;
    const ratio = ii.width / ii.height;
    if (ii.width < 2400 || ratio < 1.4 || ratio > 1.9) continue; // skip panoramas and portraits
    const meta = ii.extmetadata || {};
    out.push({
      title: clean(meta.ObjectName && meta.ObjectName.value, 90) || String(page.title).replace(/^File:/, '').replace(/\.[A-Za-z]+$/, ''),
      artist: author(meta.Artist && meta.Artist.value),
      license: meta.LicenseShortName ? String(meta.LicenseShortName.value) : '',
      thumb: ii.thumburl,
      page: ii.descriptionurl,
    });
  }
  return out;
}

function writeCredits(list, kind) {
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const credits = list.map(({ file, title, artist, license }) => ({ file, title, artist, license }));
  const head = kind === 'night' ? 'window.NIGHT_WALLPAPERS = ' : 'var WALLPAPERS = ';
  fs.writeFileSync(path.join(dir, creditsFile(kind)), head + JSON.stringify(credits, null, 2) + ';\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'SOURCES.txt'),
    'Wallpaper sources\r\n\r\n' + list.map((p) => [p.file, '  ' + p.title, '  ' + [p.artist, p.license].filter(Boolean).join(', '), '  ' + (p.page || '')].join('\r\n')).join('\r\n\r\n') + '\r\n', 'utf8');
}

function currentList(kind) {
  try {
    const src = fs.readFileSync(path.join(dirFor(kind), creditsFile(kind)), 'utf8');
    const json = src.slice(src.indexOf('['), src.lastIndexOf(']') + 1);
    return JSON.parse(json).filter((p) => fs.existsSync(path.join(dirFor(kind), p.file)));
  } catch (e) { return []; }
}

function clearPhotos(kind) {
  const dir = dirFor(kind);
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) if (/^wp\d+\.jpe?g$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
}

async function fetchFromWikimedia({ categories, count, kind, onProgress }) {
  const names = (categories && categories.length ? categories : ['landscapes', 'mountains', 'coasts'])
    .map((k) => CATEGORIES[k]).filter(Boolean);
  let pool = [];
  for (const cat of names) {
    try { pool = pool.concat(await candidates(cat)); } catch (e) { onProgress({ text: cat + ': ' + e.message }); }
  }
  const seen = new Set();
  pool = pool.filter((p) => (seen.has(p.thumb) ? false : (seen.add(p.thumb), true)));
  if (!pool.length) throw new Error('No photos could be fetched. Check this PC is online and try again.');
  pool.sort(() => Math.random() - 0.5);
  const picked = pool.slice(0, Math.min(count || 12, pool.length));

  clearPhotos(kind);
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const file = 'wp' + String(i + 1).padStart(2, '0') + '.jpg';
    try {
      const res = await fetch(p.thumb, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
      list.push(Object.assign({ file }, p));
      onProgress({ done: i + 1, total: picked.length, text: p.title });
    } catch (e) {
      onProgress({ text: 'Skipped "' + p.title + '": ' + e.message });
    }
    await new Promise((r) => setTimeout(r, 300)); // be polite to Wikimedia
  }
  writeCredits(list, kind);
  return list.length;
}

// Your own pictures, scaled to 1920 wide so they are light enough for an old TV.
function importFiles(files, nativeImage, onProgress, kind) {
  clearPhotos(kind);
  const dir = dirFor(kind);
  fs.mkdirSync(dir, { recursive: true });
  const list = [];
  files.slice(0, 40).forEach((src, i) => {
    let img = nativeImage.createFromPath(src);
    if (img.isEmpty()) { onProgress({ text: 'Skipped ' + path.basename(src) }); return; }
    if (img.getSize().width > 1920) img = img.resize({ width: 1920, quality: 'best' });
    const file = 'wp' + String(list.length + 1).padStart(2, '0') + '.jpg';
    fs.writeFileSync(path.join(dir, file), img.toJPEG(86));
    list.push({ file, title: '', artist: '', license: '', page: '' });
    onProgress({ done: i + 1, total: files.length, text: path.basename(src) });
  });
  writeCredits(list, kind);
  return list.length;
}

module.exports = { CATEGORIES, fetchFromWikimedia, importFiles, currentList, clearPhotos, writeCredits, clean, author };
