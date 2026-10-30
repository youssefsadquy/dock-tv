// One-time Spotify login for the Dock's Spotify card: Authorization Code with PKCE and a
// loopback redirect, so no client secret exists anywhere. Needs Spotify Premium.
// The refresh token is stored in the user's data folder and added only to the build copy
// that goes to the TV, never to the preview or to anything shareable.
const http = require('http');
const crypto = require('crypto');

const REDIRECT = 'http://127.0.0.1:8888/callback';
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';

const b64url = (buf) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// Accepts spotify: URIs and open.spotify.com links.
function toSpotifyUri(value) {
  const v = String(value || '').trim();
  let m = /^spotify:(playlist|album|artist|track):([A-Za-z0-9]+)/.exec(v);
  if (m) return m[0];
  m = /open\.spotify\.com\/(?:(?:[a-z]{2}(?:-[a-z]{2})?|intl-[a-z]{2})\/)?(playlist|album|artist|track)\/([A-Za-z0-9]+)/.exec(v);
  return m ? 'spotify:' + m[1] + ':' + m[2] : '';
}

function pkcePair() {
  const verifier = b64url(crypto.randomBytes(64));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest()), state: b64url(crypto.randomBytes(24)) };
}

function authUrl(clientId, challenge, state) {
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  return 'https://accounts.spotify.com/authorize?' + q.toString();
}

// Waits for Spotify to redirect the browser back to 127.0.0.1:8888 with ?code=...
function waitForCode(state, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const page = (title, msg) => '<!doctype html><meta charset="utf-8"><title>' + title + '</title><body style="font-family:Arial;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="color:#1ed760">' + title + '</h1><p>' + msg + '</p></div>';
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1:8888');
      if (u.pathname !== '/callback') { res.statusCode = 404; res.end(); return; }
      let error = null;
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state) error = 'The login response did not match this request. Please try again.';
      else if (u.searchParams.get('error')) error = 'Spotify returned: ' + u.searchParams.get('error');
      else if (!code) error = 'No login code was returned.';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(error ? page('Spotify login failed', error.replace(/[<>&]/g, '')) : page('Login approved', 'You can close this tab and return to Dock TV.'));
      clearTimeout(timer); server.close();
      error ? reject(new Error(error)) : resolve(code);
    });
    const timer = setTimeout(() => { server.close(); reject(new Error('The login timed out. Nothing changed.')); }, timeoutMs);
    server.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'EADDRINUSE' ? 'Port 8888 is already in use. Close the other program and try again.' : e.message)); });
    server.listen(8888, '127.0.0.1');
  });
}

async function exchange(clientId, code, verifier) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) throw new Error('Spotify refused the login' + (json.error_description ? ': ' + json.error_description : '.') + ' Check the Redirect URI in your Spotify app settings.');
  return json;
}

async function playlistName(accessToken, uri) {
  const m = /^spotify:playlist:([A-Za-z0-9]+)$/.exec(uri || '');
  if (!m) return '';
  try {
    const res = await fetch('https://api.spotify.com/v1/playlists/' + m[1] + '?fields=name', { headers: { Authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(15000) });
    return res.ok ? String((await res.json()).name || '') : '';
  } catch (e) { return ''; }
}

// openExternal(url) opens the user's browser. Returns { clientId, refreshToken, name }.
async function login(clientId, openExternal) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(String(clientId))) throw new Error('That does not look like a Spotify Client ID (about 32 letters and digits).');
  const { verifier, challenge, state } = pkcePair();
  const pending = waitForCode(state);
  pending.catch(() => {}); // a rejection is handled below; avoid an unhandled one if the browser fails to open
  await openExternal(authUrl(clientId, challenge, state));
  const code = await pending;
  const token = await exchange(clientId, code, verifier);
  let name = '';
  try {
    const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token.access_token }, signal: AbortSignal.timeout(15000) });
    if (me.ok) name = String((await me.json()).display_name || '');
  } catch (e) { /* the name is only shown back to the user */ }
  return { clientId, refreshToken: token.refresh_token, name };
}

module.exports = { REDIRECT, toSpotifyUri, pkcePair, authUrl, login, playlistName };
