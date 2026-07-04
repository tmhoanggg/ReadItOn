// Google sign-in via Google Identity Services (GIS) token client.
// We request an OAuth access token for the Drive `drive.file` scope and keep
// it in memory. Interactive sign-in shows Google's popup; a silent attempt
// (prompt:'none') can restore a session for returning users with no UI.
import { SCOPES } from './config.js';
import { settings } from './store.js';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;          // epoch ms
let profile = null;          // { email, name, picture }
let onChangeCb = () => {};
let pending = null;          // { resolve, reject } for the in-flight token request

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
  onChange(cb) { onChangeCb = cb; },

  // Interactive: shows Google's account chooser / consent as needed.
  async signIn() {
    await ensureClient();
    await requestToken('');
    await fetchProfile();
    onChangeCb();
  },

  // Silent restore for returning users; never shows UI. Resolves false on failure.
  async trySilentSignIn() {
    try {
      await ensureClient();
      await requestToken('none');
      await fetchProfile();
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
    localStorage.removeItem('readiton.driveConnected');
    onChangeCb();
  },

  // Returns a valid token, refreshing silently if needed.
  async getToken() {
    if (this.isSignedIn()) return accessToken;
    await ensureClient();
    await requestToken('');
    return accessToken;
  },
};
