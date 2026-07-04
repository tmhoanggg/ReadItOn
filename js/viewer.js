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
    this.container.innerHTML = '';
    this.pages = [];
    if (this.pdf) { this.pdf.destroy(); this.pdf = null; }
  }

  async renderAll() {
    this.container.innerHTML = '';
    this.pages = [];
    for (let n = 1; n <= this.pdf.numPages; n++) {
      await this.renderPage(n);
    }
  }

  async renderPage(n) {
    const page = await this.pdf.getPage(n);
    const viewport = page.getViewport({ scale: this.scale });

    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.dataset.page = String(n);
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
    this.container.appendChild(pageDiv);

    const ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
    }).promise;

    const textContent = await page.getTextContent();
    const task = pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs: [],
    });
    await task.promise;

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
