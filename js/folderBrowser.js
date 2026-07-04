// In-app Google Drive folder browser. Replaces the Google Picker so we can
// show the full folder path (breadcrumbs) and let the user drill into their
// real Drive. Requires the full Drive scope.
import { drive } from './drive.js';

const $ = (id) => document.getElementById(id);
const ROOT = { id: 'root', name: 'My Drive' };

let stack = [];        // navigated folders below root: [{id,name}, ...]
let resolver = null;

const modal = () => $('folder-browser');
const current = () => (stack.length ? stack[stack.length - 1] : ROOT);
const crumbs = () => [ROOT, ...stack];
const pathText = () => crumbs().map(c => c.name).join(' / ');

export function initFolderBrowser() {
  $('fb-close').addEventListener('click', () => finish(null));
  modal().addEventListener('click', (e) => { if (e.target === modal()) finish(null); });
  $('fb-use').addEventListener('click', () => finish(current()));
}

// Opens the browser. Resolves { id, name, path } on choose, null on cancel.
export function pickFolderInApp() {
  return new Promise((resolve) => {
    resolver = resolve;
    stack = [];
    modal().classList.remove('hidden');
    render();
  });
}

function finish(folder) {
  modal().classList.add('hidden');
  const r = resolver; resolver = null;
  if (!r) return;
  r(folder ? { id: folder.id, name: folder.name, path: pathText() } : null);
}

async function render() {
  // Breadcrumbs
  const bc = $('fb-breadcrumb');
  bc.innerHTML = '';
  crumbs().forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'fb-crumb';
    b.textContent = c.name;
    b.disabled = i === crumbs().length - 1;
    b.addEventListener('click', () => { stack = stack.slice(0, i); render(); });
    bc.appendChild(b);
    if (i < crumbs().length - 1) {
      const sep = document.createElement('span');
      sep.className = 'fb-crumb-sep';
      sep.textContent = '/';
      bc.appendChild(sep);
    }
  });
  $('fb-current').textContent = 'Save papers to: ' + pathText();

  // Folder list
  const list = $('fb-list');
  list.innerHTML = '<div class="fb-empty">Loading…</div>';
  try {
    const folders = await drive.listFolders(current().id);
    list.innerHTML = '';
    if (!folders.length) {
      list.innerHTML = '<div class="fb-empty">No sub-folders here — you can still use this folder.</div>';
      return;
    }
    for (const f of folders) {
      const row = document.createElement('button');
      row.className = 'fb-row';
      row.innerHTML = '<svg class="ic"><use href="#i-folder"/></svg><span class="fb-name"></span><svg class="ic fb-chevron"><use href="#i-chevron"/></svg>';
      row.querySelector('.fb-name').textContent = f.name;
      row.addEventListener('click', () => { stack.push({ id: f.id, name: f.name }); render(); });
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'fb-empty';
    err.textContent = 'Could not load folders: ' + (e?.message || e);
    list.appendChild(err);
  }
}
