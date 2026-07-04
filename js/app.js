// ReadItOn — app controller. Papers live in the user's Google Drive, so the
// app requires sign-in; there is no on-device mode.
import { auth } from './auth.js';
import { PdfViewer } from './viewer.js';
import { AnnotationManager } from './annotations.js';
import { exportAnnotatedPdf } from './export.js';
import { settings, toast } from './store.js';
import { DEFAULT_COLORS } from './config.js';
import { createDriveBackend } from './storage.js';
import { pickFolder } from './picker.js';

const $ = (id) => document.getElementById(id);
const K_THEME = 'readiton.theme';
const COLOR_TOOLS = ['highlight', 'underline', 'note', 'freehand', 'text'];

const els = {
  viewerControls: $('viewer-controls'),
  grid: $('library-grid'),
  hero: $('hero'),
  libHead: $('lib-head'),
  signinGate: $('signin-gate'),
  importBtn: $('import-btn'),
  dropzone: $('dropzone'),
  storagePill: $('storage-pill'),
  folderChip: $('folder-chip'),
  folderName: $('folder-name'),
  fileInput: $('file-input'),
  libraryView: $('library-view'),
  viewerView: $('viewer-view'),
  pdfScroll: $('pdf-scroll'),
  notesPanel: $('notes-panel'),
  notesList: $('notes-list'),
  docTitle: $('doc-title'),
  inkColor: $('ink-color'),
  swatches: $('swatches'),
  annotTools: $('annotation-tools'),
  undoBtn: $('undo-btn'),
  redoBtn: $('redo-btn'),
  saveBtn: $('save-drive'),
  zoomLevel: $('zoom-level'),
  syncStatus: $('sync-status'),
  connectBtn: $('connect-drive-btn'),
  userChip: $('user-chip'),
  userAvatar: $('user-avatar'),
  userEmail: $('user-email'),
  themeBtn: $('theme-btn'),
  dropOverlay: $('drop-overlay'),
  settingsModal: $('settings-modal'),
  accountState: $('account-state'),
  clientIdInput: $('client-id-input'),
};

const backend = createDriveBackend();

const state = { paper: null, pdfBytes: null };
let viewer = null;
let annot = null;
let currentTool = 'select';
let dirty = false;               // unsaved annotation changes (manual save)

// ---------- sync / save status ----------
function setSync(text, cls = '') {
  els.syncStatus.textContent = text;
  els.syncStatus.className = 'sync-status' + (cls ? ' ' + cls : '');
}
function markDirty() {
  dirty = true;
  setSync('● Unsaved changes', 'dirty');
  els.saveBtn?.classList.add('has-unsaved');
}
function markSaved() {
  dirty = false;
  setSync('✓ Saved', 'ok');
  els.saveBtn?.classList.remove('has-unsaved');
}
async function doSave() {
  if (!annot || !state.paper) return;
  if (!dirty) { setSync('✓ Saved', 'ok'); return; }
  try {
    setSync('Saving…');
    await backend.saveAnnotations(state.paper, annot.getData());
    markSaved();
  } catch (e) {
    setSync('⚠ Save failed', 'warn');
    toast('Could not save: ' + (e?.message || e));
  }
}

// ================= Theme =================
function effectiveDark() {
  const t = localStorage.getItem(K_THEME);
  if (t) return t === 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme() {
  const t = localStorage.getItem(K_THEME);
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  els.themeBtn.querySelector('use').setAttribute('href', effectiveDark() ? '#i-sun' : '#i-moon');
}
els.themeBtn.addEventListener('click', () => {
  localStorage.setItem(K_THEME, effectiveDark() ? 'light' : 'dark');
  applyTheme();
});

// ================= Auth / account =================
auth.onChange(() => {
  updateAccountUI();
  renderGate();
  if (auth.isSignedIn()) loadLibrary();
});

function updateAccountUI() {
  const signedIn = auth.isSignedIn();
  const p = auth.getProfile();
  els.connectBtn.classList.toggle('hidden', signedIn);
  els.userChip.classList.toggle('hidden', !signedIn);
  if (signedIn && p) {
    els.userAvatar.src = p.picture || '';
    els.userEmail.textContent = p.email || 'Google account';
  }
  renderStoragePill();
  renderFolderChip();
  renderAccountState();
}

function renderGate() {
  const signedIn = auth.isSignedIn();
  els.signinGate.classList.toggle('hidden', signedIn);
  els.libHead.classList.toggle('hidden', !signedIn);
  els.importBtn.classList.toggle('hidden', !signedIn);
  els.grid.classList.toggle('hidden', !signedIn);
  if (!signedIn) els.hero.classList.add('hidden');
  renderFolderChip();
}

function renderStoragePill() {
  const signedIn = auth.isSignedIn();
  if (signedIn) {
    const email = auth.getEmail() || '';
    els.storagePill.classList.remove('hidden');
    els.storagePill.className = 'storage-pill synced';
    els.storagePill.innerHTML =
      `<svg class="ic"><use href="#i-cloud"/></svg> Synced to Google Drive${email ? ' · ' + escapeHtml(email) : ''}`;
  } else {
    els.storagePill.classList.add('hidden');
  }
}

function renderFolderChip() {
  const show = auth.isSignedIn() && settings.hasPicker();
  els.folderChip.classList.toggle('hidden', !show);
  if (show) {
    const f = settings.getFolder();
    els.folderName.textContent = f?.name || 'ReadItOn';
  }
}

function renderAccountState() {
  const signedIn = auth.isSignedIn();
  const p = auth.getProfile();
  if (signedIn) {
    els.accountState.innerHTML = `
      <div class="as-info">
        <img src="${p?.picture || ''}" alt="" />
        <div><strong>${escapeHtml(p?.name || 'Signed in')}</strong><br/>
        <span class="muted">${escapeHtml(p?.email || '')}</span></div>
      </div>
      <button class="btn ghost" id="disconnect-btn">Sign out</button>`;
    $('disconnect-btn').addEventListener('click', () => { auth.signOut(); toast('Signed out.'); });
  } else {
    const hasDrive = settings.hasDrive();
    els.accountState.innerHTML = `
      <div class="muted" style="line-height:1.5">Your papers and notes are stored in your Google Drive.
        ${hasDrive ? 'Sign in to open your library.' : 'Drive isn’t configured for this site yet (see Advanced).'}</div>
      <button class="btn" id="connect-btn2"><svg class="ic"><use href="#i-cloud"/></svg><span>Connect Google Drive</span></button>`;
    $('connect-btn2').addEventListener('click', connectDrive);
  }
}

async function connectDrive() {
  if (!settings.hasDrive()) {
    openSettings();
    $('advanced-section').open = true;
    toast('Add a Google OAuth Client ID to enable Drive (Advanced).');
    return;
  }
  try {
    setSync('Connecting…');
    await auth.signIn(); // triggers onChange -> loads library
    els.settingsModal.classList.add('hidden');
    setSync('');
  } catch (e) {
    setSync('');
    toast('Could not connect: ' + (e?.message || e));
  }
}

els.connectBtn.addEventListener('click', connectDrive);
$('gate-connect').addEventListener('click', connectDrive);
els.userChip.addEventListener('click', openSettings);

// ================= Folder picker =================
els.folderChip.addEventListener('click', chooseFolder);
async function chooseFolder() {
  try {
    const picked = await pickFolder();
    if (picked) {
      settings.setFolder(picked);
      renderFolderChip();
      toast(`Folder set to “${picked.name}”`);
      await loadLibrary();
    }
  } catch (e) {
    if (e?.message === 'NO_API_KEY') toast('Folder picker needs a Google API key (see SETUP.md).');
    else toast('Could not open picker: ' + (e?.message || e));
  }
}

// ================= Settings =================
function openSettings() {
  els.clientIdInput.value = settings.getClientIdOverride();
  renderAccountState();
  els.settingsModal.classList.remove('hidden');
}
$('settings-btn').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => els.settingsModal.classList.add('hidden'));
els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) els.settingsModal.classList.add('hidden'); });
$('save-settings').addEventListener('click', () => {
  settings.setClientIdOverride(els.clientIdInput.value);
  els.settingsModal.classList.add('hidden');
  toast('Saved. Click "Connect Drive" to sign in.');
});

// ================= Library =================
async function loadLibrary() {
  if (!auth.isSignedIn()) return;
  try {
    setSync('Loading…');
    const papers = await backend.listPapers();
    renderLibrary(papers);
    setSync('');
  } catch (e) {
    setSync('');
    toast('Could not load library: ' + (e?.message || e));
  }
}

function renderLibrary(papers) {
  els.grid.innerHTML = '';
  els.hero.classList.toggle('hidden', papers.length > 0);
  for (const p of papers) {
    const card = document.createElement('div');
    card.className = 'paper-card';
    const title = p.name.replace(/\.pdf$/i, '');
    const [c1, c2] = coverColors(p.name);
    card.innerHTML = `
      <div class="paper-cover" style="--cover:linear-gradient(135deg, ${c1}, ${c2})">
        <span class="cover-file"><svg class="ic"><use href="#i-file"/></svg></span>
        <span class="cover-glyph">${escapeHtml((title[0] || '?').toUpperCase())}</span>
      </div>
      <div class="paper-meta">
        <div style="flex:1;min-width:0">
          <div class="paper-name"></div>
          <div class="paper-sub">${p.modifiedTime ? shortDate(p.modifiedTime) : ''}</div>
        </div>
        <button class="paper-del" title="Remove"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>`;
    card.querySelector('.paper-name').textContent = title;
    card.addEventListener('click', () => openPaper(p));
    card.querySelector('.paper-del').addEventListener('click', (e) => { e.stopPropagation(); deletePaper(p); });
    els.grid.appendChild(card);
  }
}

async function importFiles(fileList) {
  if (!auth.isSignedIn()) { toast('Connect Google Drive first.'); return; }
  const pdfs = [...fileList].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfs.length) { toast('Please choose PDF files'); return; }
  for (const f of pdfs) {
    try {
      setSync(`Importing ${f.name}…`);
      const buf = await f.arrayBuffer();
      await backend.importPdf(f.name, buf);
    } catch (e) { toast(`Import failed for ${f.name}: ${e.message}`); }
  }
  setSync('');
  toast(`Imported ${pdfs.length} file${pdfs.length > 1 ? 's' : ''}`);
  await loadLibrary();
}
els.fileInput.addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
els.dropzone.addEventListener('click', () => els.fileInput.click());

async function deletePaper(p) {
  if (!confirm(`Remove “${p.name.replace(/\.pdf$/i, '')}” and its notes from Google Drive (moves to trash)?`)) return;
  try { await backend.deletePaper(p); await loadLibrary(); }
  catch (e) { toast('Delete failed: ' + e.message); }
}

// ================= Open / view a paper =================
async function openPaper(p) {
  try {
    setSync('Opening…');
    if (annot) annot.destroy();
    if (viewer) viewer.destroy();
    state.paper = p;

    const { bytes, annotations } = await backend.openPaper(p);
    state.pdfBytes = bytes;

    els.libraryView.classList.add('hidden');
    els.viewerView.classList.remove('hidden');
    els.viewerControls.classList.remove('hidden');
    els.docTitle.textContent = p.name.replace(/\.pdf$/i, '');

    viewer = new PdfViewer(els.pdfScroll);
    annot = new AnnotationManager(viewer, {
      color: settings.getToolColor('highlight'),
      notesListEl: els.notesList,
      onDirty: () => markDirty(),
      onToolReset: () => activateTool('select'),
      onHistoryChange: () => updateHistoryButtons(),
    });
    activateTool('select');
    updateHistoryButtons();

    await viewer.load(state.pdfBytes.slice(0));
    annot.setData(annotations);
    updateZoomLabel();
    markSaved();
  } catch (e) {
    setSync('');
    toast('Could not open: ' + e.message);
    backToLibrary();
  }
}

async function backToLibrary() {
  if (dirty && annot && state.paper) {
    if (confirm('Save your changes to Google Drive before leaving?')) await doSave();
  }
  if (annot) annot.destroy();
  if (viewer) viewer.destroy();
  viewer = null; annot = null; dirty = false;
  els.viewerView.classList.add('hidden');
  els.viewerControls.classList.add('hidden');
  els.libraryView.classList.remove('hidden');
  els.notesPanel.classList.add('hidden');
  setSync('');
  loadLibrary();
}
$('back-to-library').addEventListener('click', backToLibrary);
$('brand').addEventListener('click', (e) => { e.preventDefault(); if (!els.viewerView.classList.contains('hidden')) backToLibrary(); });
els.saveBtn.addEventListener('click', doSave);

// ================= Undo / redo =================
function updateHistoryButtons() {
  els.undoBtn.disabled = !(annot && annot.canUndo());
  els.redoBtn.disabled = !(annot && annot.canRedo());
}
els.undoBtn.addEventListener('click', () => { if (annot && !annot.undo()) toast('Nothing to undo'); });
els.redoBtn.addEventListener('click', () => { if (annot) annot.redo(); });

// ================= Toolbar =================
function activateTool(tool) {
  currentTool = tool;
  if (annot) annot.setTool(tool);
  els.pdfScroll.className = `pdf-scroll tool-${tool}`;
  document.querySelectorAll('#annotation-tools .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));

  const hasColor = COLOR_TOOLS.includes(tool);
  els.annotTools.classList.toggle('no-color', !hasColor);
  if (hasColor) {
    // Preselect this tool's color the moment the tool is chosen.
    const c = settings.getToolColor(tool);
    if (annot) annot.setColor(c);
    els.inkColor.value = c;
    highlightSwatch(c);
  }
}
document.querySelectorAll('#annotation-tools .tool').forEach(btn =>
  btn.addEventListener('click', () => activateTool(btn.dataset.tool)));

// color swatches — apply to the currently selected tool
function buildSwatches() {
  els.swatches.innerHTML = '';
  for (const c of DEFAULT_COLORS) {
    const s = document.createElement('button');
    s.className = 'swatch';
    s.style.background = c;
    s.dataset.color = c;
    s.title = c;
    s.addEventListener('click', () => setColor(c));
    els.swatches.appendChild(s);
  }
}
function setColor(c) {
  const tool = COLOR_TOOLS.includes(currentTool) ? currentTool : 'highlight';
  settings.setToolColor(tool, c);
  if (annot) annot.setColor(c);
  els.inkColor.value = c;
  highlightSwatch(c);
}
function highlightSwatch(c) {
  els.swatches.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('active', s.dataset.color.toLowerCase() === c.toLowerCase()));
}
els.inkColor.addEventListener('input', (e) => setColor(e.target.value));

function updateZoomLabel() { els.zoomLevel.textContent = viewer ? `${Math.round(viewer.scale * 100)}%` : '100%'; }
$('zoom-in').addEventListener('click', async () => { if (viewer) { await viewer.setScale(viewer.scale + 0.15); updateZoomLabel(); } });
$('zoom-out').addEventListener('click', async () => { if (viewer) { await viewer.setScale(viewer.scale - 0.15); updateZoomLabel(); } });

$('toggle-panel').addEventListener('click', () => { els.notesPanel.classList.toggle('hidden'); if (annot) annot.refreshPanel(); });
$('close-panel').addEventListener('click', () => els.notesPanel.classList.add('hidden'));

$('export-pdf').addEventListener('click', async () => {
  if (!annot || !state.pdfBytes) return;
  try {
    setSync('Exporting…');
    await exportAnnotatedPdf(state.pdfBytes.slice(0), annot.getData().annotations, state.paper.name);
    setSync(dirty ? '● Unsaved changes' : '✓ Saved', dirty ? 'dirty' : 'ok');
  } catch (e) { toast('Export failed: ' + e.message); setSync(''); }
});

// ================= Keyboard =================
const TOOL_KEYS = { v: 'select', h: 'highlight', u: 'underline', n: 'note', p: 'freehand', t: 'text' };
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const editable = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;

  // Redo — Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
  if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
    if (editable) return;
    if (annot) { e.preventDefault(); annot.redo(); }
    return;
  }
  // Undo — Ctrl/Cmd+Z (let native undo run inside text fields)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
    if (editable) return;
    if (annot) { e.preventDefault(); if (!annot.undo()) toast('Nothing to undo'); }
    return;
  }
  // Save — Ctrl/Cmd+S
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    if (annot && state.paper) doSave();
    return;
  }

  if (e.key === 'Escape') {
    if (!els.settingsModal.classList.contains('hidden')) els.settingsModal.classList.add('hidden');
    else if (annot) activateTool('select');
    return;
  }
  if (editable || e.metaKey || e.ctrlKey) return;
  if (annot && TOOL_KEYS[e.key]) { activateTool(TOOL_KEYS[e.key]); }
});

// ================= Drag & drop =================
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  if (!auth.isSignedIn()) return;
  dragDepth++; els.dropOverlay.classList.remove('hidden');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.dropOverlay.classList.add('hidden'); } });
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; els.dropOverlay.classList.add('hidden');
  if (!auth.isSignedIn()) return;
  if (e.dataTransfer.files?.length) {
    if (!els.viewerView.classList.contains('hidden')) backToLibrary();
    importFiles(e.dataTransfer.files);
  }
});
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

// ================= Helpers =================
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function coverColors(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return [`hsl(${h}, 68%, 58%)`, `hsl(${(h + 40) % 360}, 66%, 48%)`];
}
function shortDate(iso) {
  const d = new Date(iso), now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// ================= Boot =================
async function boot() {
  applyTheme();
  buildSwatches();
  updateAccountUI();
  renderGate();
  if (auth.isSignedIn()) {
    await loadLibrary();
  } else if (settings.hasDrive()) {
    // Returning user whose token expired: refresh silently (no popup).
    auth.trySilentSignIn();
  }
}
boot();
