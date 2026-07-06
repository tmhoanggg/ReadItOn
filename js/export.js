// Flatten annotations into a downloadable PDF using pdf-lib (window.PDFLib).
// Our coordinates are normalized with a top-left origin; PDF uses a bottom-left
// origin, so y is flipped on the way out.
import { stripReadItOnAnnots } from './pdfAnnotator.js';

const { PDFDocument, rgb, StandardFonts } = window.PDFLib;

function hexToRgb01(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function exportAnnotatedPdf(pdfBytes, annotations, fileName) {
  const doc = await PDFDocument.load(pdfBytes);
  // The live PDF may already carry ReadItOn's native annotations; drop them so
  // the flattened export draws each mark exactly once (burned into the page).
  stripReadItOnAnnots(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  for (const a of annotations) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const color = hexToRgb01(a.color);

    if (a.type === 'highlight') {
      for (const [x, y, w, h] of a.rects) {
        page.drawRectangle({
          x: x * W, y: H * (1 - (y + h)), width: w * W, height: h * H,
          color, opacity: 0.4,
        });
      }
    } else if (a.type === 'underline') {
      for (const [x, y, w, h] of a.rects) {
        const yy = H * (1 - (y + h)) + 1;
        page.drawLine({
          start: { x: x * W, y: yy }, end: { x: (x + w) * W, y: yy },
          thickness: 1.5, color,
        });
      }
    } else if (a.type === 'freehand') {
      const pts = a.points;
      const thickness = Math.max(1, a.width * W);
      for (let i = 1; i < pts.length; i++) {
        page.drawLine({
          start: { x: pts[i - 1][0] * W, y: H * (1 - pts[i - 1][1]) },
          end: { x: pts[i][0] * W, y: H * (1 - pts[i][1]) },
          thickness, color, lineCap: 1,
        });
      }
    } else if (a.type === 'text') {
      const size = Math.max(6, a.size * H);
      const lines = String(a.text || '').split('\n');
      lines.forEach((line, i) => {
        page.drawText(line, {
          x: a.x * W, y: H * (1 - a.y) - size * (i + 1), size, font, color,
        });
      });
    } else if (a.type === 'note') {
      const s = 10;
      const bx = a.x * W, by = H * (1 - a.y);
      page.drawRectangle({ x: bx, y: by - s, width: s, height: s, color });
      const text = String(a.text || '').replace(/\n/g, ' ');
      if (text) {
        page.drawText(text.slice(0, 80), {
          x: bx + s + 3, y: by - s + 1, size: 8, font, color: rgb(0.2, 0.2, 0.2),
        });
      }
    }
  }

  const bytes = await doc.save();
  const base = fileName.replace(/\.pdf$/i, '');
  triggerDownload(bytes, `${base} (annotated).pdf`);
}

function triggerDownload(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
