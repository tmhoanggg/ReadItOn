// Tiny localStorage-backed settings + helpers.
import { CLIENT_ID } from './config.js';

const K_CLIENT_ID = 'readiton.clientId'; // optional per-browser override
const K_INK_COLOR = 'readiton.inkColor';

export const settings = {
  // Effective client id: the deployment's baked-in id, or a local override.
  getClientId() {
    const override = (localStorage.getItem(K_CLIENT_ID) || '').trim();
    return override || (CLIENT_ID || '').trim();
  },
  setClientIdOverride(v) {
    const t = (v || '').trim();
    if (t) localStorage.setItem(K_CLIENT_ID, t);
    else localStorage.removeItem(K_CLIENT_ID);
  },
  getClientIdOverride() { return (localStorage.getItem(K_CLIENT_ID) || '').trim(); },
  hasDrive() { return !!this.getClientId(); },

  getInkColor() { return localStorage.getItem(K_INK_COLOR) || '#ffd400'; },
  setInkColor(v) { localStorage.setItem(K_INK_COLOR, v); },
};

export function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

let toastTimer;
export function toast(msg, ms = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
