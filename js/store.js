// Tiny localStorage-backed settings + helpers.
import { CLIENT_ID, TOOL_COLORS } from './config.js';

const K_CLIENT_ID = 'readiton.clientId'; // optional per-browser override
const K_COLOR = 'readiton.color.';       // + tool name
const K_FOLDER = 'readiton.folder';      // { id, name } chosen Drive folder

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

  // Per-tool ink color (preselected when a tool is chosen).
  getToolColor(tool) {
    return localStorage.getItem(K_COLOR + tool) || TOOL_COLORS[tool] || '#ffd400';
  },
  setToolColor(tool, v) {
    if (tool) localStorage.setItem(K_COLOR + tool, v);
  },

  // Chosen Drive folder for storing papers.
  getFolder() {
    try { return JSON.parse(localStorage.getItem(K_FOLDER) || 'null'); }
    catch { return null; }
  },
  setFolder(folder) {
    if (folder && folder.id) localStorage.setItem(K_FOLDER, JSON.stringify({ id: folder.id, name: folder.name || 'Folder' }));
    else localStorage.removeItem(K_FOLDER);
  },
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
