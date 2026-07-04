// Google sign-in via Google Identity Services (GIS) token client.
// We request an OAuth access token for the Drive scope (see config SCOPES).
//
// The token (and the fetched profile) are persisted in localStorage so a
// page reload keeps the user signed in without any popup, for as long as
// the token is valid (~1h). When it expires we refresh it silently
// (prompt:'none'), which needs no UI while the user's Google session is
// alive. Caching the token locally is an acceptable trade-off for this
// personal tool.
import { SCOPES } from './config.js';
import { settings } from './store.js';

// Bumped to invalidate old drive.file-only sessions so returning users
// re-consent for the broader Drive scope.
const K_SESSION = 'readiton.session.v2';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;          // epoch ms
let profile = null;          // { email, name, picture }
let onChangeCb = () => {};
let pending = null;          // { resolve, reject } for the in-flight token request

// ---- Session persistence ----
(function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(K_SESSION) || 'null');
    if (s && s.accessToken && Date.now() < s.tokenExpiry) {
      accessToken = s.accessToken;
      tokenExpiry = s.tokenExpiry;
      profile = s.profile || null;
    }
  } catch { /* ignore corrupt session */ }
})();

function persistSession() {
  try {
    localStorage.setItem(K_SESSION, JSON.stringify({ accessToken, tokenExpiry, profile }));
  } catch { /* storage full / disabled — non-fatal */ }
}
function clearSession() {
  try { localStorage.removeItem(K_SESSION); } catch {}
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > 12000) return reject(new Error('Google library failed to load'));
      setTimeout(poll, 60);
    })();
  });
}

function resolveToken(resp) {
  accessToken = resp.access_token;
  tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
  const p = pending; pending = null;
  p?.resolve(resp);
}
function rejectToken(err) {
  const p = pending; pending = null;
  p?.reject(err || new Error('token request failed'));
}

async function ensureClient() {
  const clientId = settings.getClientId();
  if (!clientId) throw new Error('NO_CLIENT_ID');
  await waitForGis();
  if (!tokenClient || tokenClient.__clientId !== clientId) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp && resp.access_token) resolveToken(resp);
        else rejectToken(resp);
      },
      error_callback: (err) => rejectToken(err),
    });
    tokenClient.__clientId = clientId;
  }
  return tokenClient;
}

function requestToken(prompt) {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    try { tokenClient.requestAccessToken({ prompt }); }
    catch (e) { pending = null; reject(e); }
  });
}

async function fetchProfile() {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j = await r.json();
      profile = { email: j.email || null, name: j.name || null, picture: j.picture || null };
    }
  } catch { /* non-fatal */ }
}

export const auth = {
  isSignedIn() { return !!accessToken && Date.now() < tokenExpiry; },
  getProfile() { return profile; },
  getEmail() { return profile?.email || null; },
  getAccessToken() { return this.isSignedIn() ? accessToken : null; },
  onChange(cb) { onChangeCb = cb; },

  // Interactive: shows Google's account chooser / consent as needed.
  async signIn() {
    await ensureClient();
    await requestToken('');
    await fetchProfile();
    persistSession();
    onChangeCb();
  },

  // Silent restore for returning users; never shows UI. Resolves false on failure.
  async trySilentSignIn() {
    try {
      await ensureClient();
      await requestToken('none');
      await fetchProfile();
      persistSession();
      onChangeCb();
      return true;
    } catch {
      return false;
    }
  },

  signOut() {
    if (accessToken && window.google?.accounts?.oauth2) {
      try { window.google.accounts.oauth2.revoke(accessToken, () => {}); } catch {}
    }
    accessToken = null; tokenExpiry = 0; profile = null;
    clearSession();
    onChangeCb();
  },

  // Returns a valid token, refreshing silently if needed.
  async getToken() {
    if (this.isSignedIn()) return accessToken;
    await ensureClient();
    // Try silent first (no popup); fall back to interactive.
    try { await requestToken('none'); }
    catch { await requestToken(''); }
    await fetchProfile();
    persistSession();
    return accessToken;
  },
};
