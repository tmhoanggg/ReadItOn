// PDF rendering via pdf.js (loaded as window.pdfjsLib from CDN).
import { PDFJS_WORKER } from './config.js';

const pdfjsLib = window.pdfjsLib;

// A Worker script must be same-origin, so we can't point workerSrc straight at
// the CDN. Wrap it in a same-origin blob worker that importScripts() the CDN
// build (jsdelivr serves it with CORS, which importScripts allows).
const workerShim = URL.createObjectURL(
  new Blob([`importScripts(${JSON.stringify(PDFJS_WORKER)});`], { type: 'application/javascript' })
);
pdfjsLib.GlobalWorkerOptions.workerSrc = workerShim;

// Render the first page of a PDF to a JPEG data URL for library thumbnails.
export async function renderPdfThumbnail(arrayBuffer, targetWidth = 320) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidth / base.width;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
    }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    pdf.destroy();
  }
}

export class PdfViewer {
  constructor(container) {
    this.container = container;
    this.pdf = null;
    this.scale = 1.3;
    this.pages = [];               // index by page number (1-based)
    this.onPageRendered = () => {}; // (rec) => void
    this._renderSeq = 0;           // bumped on every renderAll; guards against races
    this._renderTasks = new Set(); // in-flight pdf.js render tasks, for cancellation
  }

  async load(arrayBuffer) {
    // pdf.js transfers/detaches the buffer, so hand it a copy we don't reuse.
    this.pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    await this.renderAll();
  }

  get numPages() { return this.pdf ? this.pdf.numPages : 0; }

  async setScale(scale) {
    this.scale = Math.min(4, Math.max(0.4, scale));
    if (this.pdf) await this.renderAll();
    return this.scale;
  }

  destroy() {
    this._renderSeq++;             // invalidate any render pass still in flight
    this._cancelRenderTasks();
    this.container.innerHTML = '';
    this.pages = [];
    if (this.pdf) { this.pdf.destroy(); this.pdf = null; }
  }

  _cancelRenderTasks() {
    for (const task of this._renderTasks) {
      try { task.cancel(); } catch { /* already settled */ }
    }
    this._renderTasks.clear();
  }

  // Render every page. Guarded so that a second call (e.g. a zoom while the
  // previous pass is still rendering) cleanly supersedes the first instead of
  // interleaving with it — interleaving is what dropped and reordered pages.
  async renderAll() {
    const gen = ++this._renderSeq;
    this._cancelRenderTasks();
    this.container.innerHTML = '';
    this.pages = [];

    // Create the page containers up front, in order, so the DOM order is
    // always 1..N regardless of the order the async renders finish in.
    const slots = [];
    for (let n = 1; n <= this.pdf.numPages; n++) {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'page';
      pageDiv.dataset.page = String(n);
      this.container.appendChild(pageDiv);
      slots[n] = pageDiv;
    }

    for (let n = 1; n <= this.pdf.numPages; n++) {
      if (gen !== this._renderSeq) return; // a newer pass took over
      await this.renderPage(n, slots[n], gen);
    }
  }

  async renderPage(n, pageDiv, gen) {
    const page = await this.pdf.getPage(n);
    if (gen !== this._renderSeq) return; // superseded while awaiting
    const viewport = page.getViewport({ scale: this.scale });

    pageDiv.style.width = `${Math.floor(viewport.width)}px`;
    pageDiv.style.height = `${Math.floor(viewport.height)}px`;
    pageDiv.style.setProperty('--scale-factor', String(this.scale));

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const annotLayer = document.createElement('div');
    annotLayer.className = 'annot-layer';
    const textLayer = document.createElement('div');
    textLayer.className = 'textLayer';
    const captureLayer = document.createElement('div');
    captureLayer.className = 'capture-layer';
    const interactiveLayer = document.createElement('div');
    interactiveLayer.className = 'interactive-layer';

    pageDiv.append(canvas, annotLayer, textLayer, captureLayer, interactiveLayer);

    const ctx = canvas.getContext('2d');
    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
      // We draw annotations ourselves in the overlay layer from the ReadItOn
      // model. The PDF now also carries those same marks as native annotations
      // (so they show in Drive/other readers); disable pdf.js's own annotation
      // painting here so they don't render twice.
      annotationMode: (pdfjsLib.AnnotationMode && pdfjsLib.AnnotationMode.DISABLE) ?? 0,
    });
    this._renderTasks.add(renderTask);
    try {
      await renderTask.promise;
    } catch (e) {
      // A cancelled render (superseded pass / destroy) is expected — bail quietly.
      if (e?.name === 'RenderingCancelledException') return;
      throw e;
    } finally {
      this._renderTasks.delete(renderTask);
    }
    if (gen !== this._renderSeq) return; // superseded while rendering

    const textContent = await page.getTextContent();
    if (gen !== this._renderSeq) return;
    const task = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs: [],
    });
    await task.promise;
    if (gen !== this._renderSeq) return;

    const rec = {
      pageNumber: n,
      pageDiv, viewport,
      annotLayer, textLayer, captureLayer, interactiveLayer,
      width: viewport.width, height: viewport.height,
    };
    this.pages[n] = rec;
    this.onPageRendered(rec);
  }
}
