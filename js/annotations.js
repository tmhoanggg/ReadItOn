// Annotation model, rendering and input handling.
//
// All geometry is stored in NORMALIZED page coordinates (fractions 0..1 of the
// page width/height) so annotations render correctly at any zoom and on any
// screen. Rendering multiplies by the current page pixel size.
import { uid } from './store.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export class AnnotationManager {
  constructor(viewer, opts = {}) {
    this.viewer = viewer;
    this.data = { version: 1, annotations: [] };
    this._history = [];        // undo stack of annotation snapshots (JSON)
    this._redo = [];           // redo stack
    this._maxHistory = 100;
    this.tool = 'select';
    this.color = opts.color || '#ffd400';
    this.onDirty = opts.onDirty || (() => {});
    this.onToolReset = opts.onToolReset || (() => {});
    this.onHistoryChange = opts.onHistoryChange || (() => {});
    this.notesListEl = opts.notesListEl || null;

    this.noteEditor = {
      el: document.getElementById('note-editor'),
      text: document.getElementById('note-text'),
      save: document.getElementById('note-save'),
      del: document.getElementById('note-delete'),
      current: null,
    };
    this._wireNoteEditor();

    // Global mouseup handles text-selection based tools (highlight/underline).
    this._onMouseUp = () => this._handleTextSelection();
    document.addEventListener('mouseup', this._onMouseUp);

    viewer.onPageRendered = (rec) => this.attachPage(rec);
  }

  destroy() {
    document.removeEventListener('mouseup', this._onMouseUp);
    this.noteEditor.el.classList.add('hidden');
  }

  setData(data) {
    this.data = data && Array.isArray(data.annotations)
      ? data
      : { version: 1, annotations: [] };
    this._history = [];   // fresh document → nothing to undo
    this._redo = [];
    for (const rec of this.viewer.pages) if (rec) this.renderPage(rec);
    this.refreshPanel();
    this.onHistoryChange();
  }

  getData() {
    this.data.updatedAt = new Date().toISOString();
    return this.data;
  }

  setTool(tool) { this.tool = tool; }
  setColor(color) { this.color = color; }

  _markDirty() { this.onDirty(); }

  _forPage(n) { return this.data.annotations.filter(a => a.page === n); }

  // ---- Undo / Redo ----
  // Snapshot the annotations array before a mutation so it can be reverted.
  // Any new mutation invalidates the redo stack.
  _pushHistory() {
    this._history.push(JSON.stringify(this.data.annotations));
    if (this._history.length > this._maxHistory) this._history.shift();
    this._redo = [];
  }

  canUndo() { return this._history.length > 0; }
  canRedo() { return this._redo.length > 0; }

  _restore(snapshot) {
    try { this.data.annotations = JSON.parse(snapshot); } catch { return false; }
    this.noteEditor.el.classList.add('hidden');
    this.noteEditor.current = null;
    for (const rec of this.viewer.pages) if (rec) this.renderPage(rec);
    this.refreshPanel();
    this._markDirty();
    this.onHistoryChange();
    return true;
  }

  undo() {
    if (!this._history.length) return false;
    this._redo.push(JSON.stringify(this.data.annotations));
    return this._restore(this._history.pop());
  }

  redo() {
    if (!this._redo.length) return false;
    this._history.push(JSON.stringify(this.data.annotations));
    return this._restore(this._redo.pop());
  }

  add(annotation) {
    this._pushHistory();
    this.data.annotations.push(annotation);
    const rec = this.viewer.pages[annotation.page];
    if (rec) this.renderPage(rec);
    this.refreshPanel();
    this._markDirty();
    this.onHistoryChange();
  }

  remove(id) {
    const idx = this.data.annotations.findIndex(a => a.id === id);
    if (idx < 0) return;
    this._pushHistory();
    const page = this.data.annotations[idx].page;
    this.data.annotations.splice(idx, 1);
    const rec = this.viewer.pages[page];
    if (rec) this.renderPage(rec);
    this.refreshPanel();
    this._markDirty();
    this.onHistoryChange();
  }

  // ---- Per-page wiring + rendering ----
  attachPage(rec) {
    this._wireCapture(rec);
    this.renderPage(rec);
  }

  renderPage(rec) {
    rec.annotLayer.innerHTML = '';
    rec.interactiveLayer.innerHTML = '';
    for (const a of this._forPage(rec.pageNumber)) {
      if (a.type === 'highlight') this._renderHighlight(rec, a);
      else if (a.type === 'underline') this._renderUnderline(rec, a);
      else if (a.type === 'freehand') this._renderFreehand(rec, a);
      else if (a.type === 'note') this._renderNote(rec, a);
      else if (a.type === 'text') this._renderText(rec, a);
    }
  }

  _renderHighlight(rec, a) {
    for (const [x, y, w, h] of a.rects) {
      const d = document.createElement('div');
      d.className = 'annot-hl';
      d.dataset.annotId = a.id;
      d.style.left = `${x * rec.width}px`;
      d.style.top = `${y * rec.height}px`;
      d.style.width = `${w * rec.width}px`;
      d.style.height = `${h * rec.height}px`;
      d.style.background = hexToRgba(a.color, 0.4);
      rec.annotLayer.appendChild(d);
    }
  }

  _renderUnderline(rec, a) {
    for (const [x, y, w, h] of a.rects) {
      const d = document.createElement('div');
      d.className = 'annot-ul';
      d.dataset.annotId = a.id;
      d.style.left = `${x * rec.width}px`;
      d.style.top = `${(y + h) * rec.height - 2}px`;
      d.style.width = `${w * rec.width}px`;
      d.style.height = `2px`;
      d.style.background = a.color;
      rec.annotLayer.appendChild(d);
    }
  }

  _renderFreehand(rec, a) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'annot-freehand');
    svg.dataset.annotId = a.id;
    const poly = document.createElementNS(SVGNS, 'polyline');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', a.color);
    poly.setAttribute('stroke-width', String(Math.max(1, a.width * rec.width)));
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('points', a.points.map(([x, y]) => `${x * rec.width},${y * rec.height}`).join(' '));
    svg.appendChild(poly);
    rec.annotLayer.appendChild(svg);
  }

  _renderNote(rec, a) {
    const m = document.createElement('button');
    m.className = 'note-marker';
    m.dataset.annotId = a.id;
    m.style.left = `${a.x * rec.width}px`;
    m.style.top = `${a.y * rec.height}px`;
    m.style.background = a.color;
    m.textContent = '📝';
    m.title = a.text || 'Note';
    m.addEventListener('click', (e) => { e.stopPropagation(); this._openNoteEditor(a, m); });
    rec.interactiveLayer.appendChild(m);
  }

  _renderText(rec, a) {
    const box = document.createElement('div');
    box.className = 'text-box';
    box.dataset.annotId = a.id;
    box.contentEditable = 'true';
    box.spellcheck = false;
    box.textContent = a.text || '';
    box.style.left = `${a.x * rec.width}px`;
    box.style.top = `${a.y * rec.height}px`;
    box.style.color = a.color;
    box.style.fontSize = `${a.size * rec.height}px`;
    box.style.maxWidth = `${rec.width - a.x * rec.width - 6}px`;

    box.addEventListener('input', () => { a.text = box.textContent; this._markDirty(); });
    box.addEventListener('blur', () => {
      if (!box.textContent.trim()) this.remove(a.id);
      else { this.refreshPanel(); this._markDirty(); }
    });

    const del = document.createElement('button');
    del.className = 'tb-del';
    del.textContent = '✕';
    del.contentEditable = 'false';
    del.title = 'Delete text';
    del.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.remove(a.id); });
    box.appendChild(del);

    rec.interactiveLayer.appendChild(box);
    if (a.__focus) { delete a.__focus; setTimeout(() => box.focus(), 0); }
  }

  // ---- Pointer tools (freehand / text / note) ----
  _wireCapture(rec) {
    const cap = rec.captureLayer;
    const rel = (e) => {
      const r = rec.pageDiv.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };

    cap.addEventListener('pointerdown', (e) => {
      if (this.tool === 'freehand') this._startFreehand(rec, e, rel);
      else if (this.tool === 'text') this._placeText(rec, rel(e));
      else if (this.tool === 'note') this._placeNote(rec, rel(e));
    });
  }

  _startFreehand(rec, e, rel) {
    e.preventDefault();
    rec.captureLayer.setPointerCapture(e.pointerId);
    const points = [rel(e)];
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'annot-freehand');
    const poly = document.createElementNS(SVGNS, 'polyline');
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', this.color);
    poly.setAttribute('stroke-width', String(Math.max(1, 0.003 * rec.width)));
    poly.setAttribute('stroke-linecap', 'round');
    poly.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(poly);
    rec.annotLayer.appendChild(svg);

    const draw = () => poly.setAttribute('points',
      points.map(p => `${p.x * rec.width},${p.y * rec.height}`).join(' '));
    draw();

    const move = (ev) => { points.push(rel(ev)); draw(); };
    const up = () => {
      rec.captureLayer.removeEventListener('pointermove', move);
      rec.captureLayer.removeEventListener('pointerup', up);
      svg.remove();
      if (points.length > 1) {
        this.add({
          id: uid(), type: 'freehand', page: rec.pageNumber, color: this.color,
          width: 0.003, points: points.map(p => [p.x, p.y]),
        });
      }
    };
    rec.captureLayer.addEventListener('pointermove', move);
    rec.captureLayer.addEventListener('pointerup', up);
  }

  _placeText(rec, pos) {
    this.add({
      id: uid(), type: 'text', page: rec.pageNumber, color: this.color,
      x: pos.x, y: pos.y, size: 0.022, text: '', __focus: true,
    });
    this.onToolReset();
  }

  _placeNote(rec, pos) {
    const a = {
      id: uid(), type: 'note', page: rec.pageNumber, color: this.color,
      x: pos.x, y: pos.y, text: '',
    };
    this.add(a);
    const marker = rec.interactiveLayer.querySelector(`.note-marker[data-annot-id="${a.id}"]`);
    this._openNoteEditor(a, marker);
    this.onToolReset();
  }

  // ---- Text selection tools (highlight / underline) ----
  _handleTextSelection() {
    if (this.tool !== 'highlight' && this.tool !== 'underline') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const anchor = range.commonAncestorContainer;
    const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
    const pageEl = el?.closest?.('.page');
    if (!pageEl) return;
    const rec = this.viewer.pages[Number(pageEl.dataset.page)];
    if (!rec) return;

    const pageRect = pageEl.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter(r => r.width > 1 && r.height > 1)
      .map(r => [
        (r.left - pageRect.left) / pageRect.width,
        (r.top - pageRect.top) / pageRect.height,
        r.width / pageRect.width,
        r.height / pageRect.height,
      ])
      .filter(([x, y, w, h]) => x >= -0.02 && y >= -0.02 && x + w <= 1.02 && y + h <= 1.02);
    if (!rects.length) return;

    this.add({
      id: uid(),
      type: this.tool,
      page: rec.pageNumber,
      color: this.color,
      rects,
    });
    sel.removeAllRanges();
  }

  // ---- Sticky-note editor popover ----
  _wireNoteEditor() {
    const ne = this.noteEditor;
    ne.save.addEventListener('click', () => this._closeNoteEditor(true));
    ne.del.addEventListener('click', () => {
      if (ne.current) this.remove(ne.current.id);
      this._closeNoteEditor(false);
    });
  }

  _openNoteEditor(a, markerEl) {
    const ne = this.noteEditor;
    ne.current = a;
    ne.text.value = a.text || '';
    ne.el.classList.remove('hidden');
    const r = markerEl.getBoundingClientRect();
    ne.el.style.left = `${Math.min(window.innerWidth - 260, r.left)}px`;
    ne.el.style.top = `${r.bottom + 6}px`;
    setTimeout(() => ne.text.focus(), 0);
  }

  _closeNoteEditor(persist) {
    const ne = this.noteEditor;
    if (persist && ne.current) {
      ne.current.text = ne.text.value;
      const rec = this.viewer.pages[ne.current.page];
      const marker = rec?.interactiveLayer.querySelector(`.note-marker[data-annot-id="${ne.current.id}"]`);
      if (marker) marker.title = ne.current.text || 'Note';
      this.refreshPanel();
      this._markDirty();
    }
    ne.el.classList.add('hidden');
    ne.current = null;
  }

  // ---- Annotations side panel ----
  refreshPanel() {
    if (!this.notesListEl) return;
    const list = this.notesListEl;
    list.innerHTML = '';
    const items = [...this.data.annotations].sort((a, b) => a.page - b.page);
    if (!items.length) {
      list.innerHTML = '<p class="muted" style="padding:8px">No annotations yet.</p>';
      return;
    }
    const labels = { highlight: 'Highlight', underline: 'Underline', note: 'Note', freehand: 'Drawing', text: 'Text' };
    for (const a of items) {
      const item = document.createElement('div');
      item.className = 'note-item';
      const body = (a.text || '').trim();
      item.innerHTML = `
        <div class="ni-head">
          <span class="ni-swatch" style="background:${a.color}"></span>
          <span>${labels[a.type] || a.type} · p.${a.page}</span>
          <button class="ni-del" title="Delete">🗑</button>
        </div>
        ${body ? `<div class="ni-body"></div>` : ''}`;
      if (body) item.querySelector('.ni-body').textContent = body;
      item.addEventListener('click', () => this._scrollTo(a));
      item.querySelector('.ni-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.remove(a.id);
      });
      list.appendChild(item);
    }
  }

  _scrollTo(a) {
    const rec = this.viewer.pages[a.page];
    if (!rec) return;
    const el = rec.pageDiv.querySelector(`[data-annot-id="${a.id}"]`) || rec.pageDiv;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
