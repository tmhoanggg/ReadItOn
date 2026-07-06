// Write ReadItOn's annotations into the PDF itself as NATIVE, editable PDF
// annotation objects (like PDF Expert), instead of a separate sidecar file.
//
//  - Highlights / underlines  -> /Highlight, /Underline (QuadPoints + appearance)
//  - Freehand pen             -> /Ink (InkList + appearance)
//  - Sticky notes             -> /Text  (a note icon carrying the comment)
//  - Text boxes               -> /FreeText (carries the typed text)
//
// Every annotation we create is tagged with a private /ReadItOn key so we can
// strip and re-emit exactly our own marks on each save (idempotent, never
// stacking) while leaving annotations made by other apps untouched.
//
// ReadItOn's own structured model (normalized coordinates, undo-friendly) is
// stored losslessly inside the PDF under the catalog's /ReadItOn key, so
// re-opening in ReadItOn keeps every mark fully editable — no external JSON.
//
// pdf-lib is used via window.PDFLib in the browser; tests inject it on
// globalThis.PDFLib. All coordinates in the model are normalized (0..1) with a
// top-left origin; PDF user space is bottom-left, so y is flipped on the way out.

const PDFLib = (typeof window !== 'undefined' && window.PDFLib) || globalThis.PDFLib;

const MARK_KEY = 'ReadItOn';          // private tag on annotations we authored
const DATA_KEY = 'ReadItOn';          // catalog key holding our structured model

function lib() {
  const L = (typeof window !== 'undefined' && window.PDFLib) || globalThis.PDFLib || PDFLib;
  if (!L) throw new Error('pdf-lib (PDFLib) is not loaded');
  return L;
}

function hexToRgb01(hex) {
  const h = String(hex || '#000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---- low-level helpers -----------------------------------------------------

function numArray(ctx, nums) {
  const { PDFArray, PDFNumber } = lib();
  const arr = PDFArray.withContext(ctx);
  for (const n of nums) arr.push(PDFNumber.of(n));
  return arr;
}

// A form XObject appearance stream drawn in page coordinates: BBox == Rect and
// an identity matrix means our content stream can use absolute page-space
// numbers and it lines up exactly under the annotation.
function appearanceStream(ctx, rect, content, extraResources) {
  const { PDFName, PDFNumber } = lib();
  const dict = {
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Form'),
    FormType: PDFNumber.of(1),
    BBox: numArray(ctx, rect),
    Matrix: numArray(ctx, [1, 0, 0, 1, 0, 0]),
    Resources: ctx.obj(extraResources || {}),
  };
  const stream = ctx.stream(content, dict);
  return ctx.register(stream);
}

function apDict(ctx, ref) {
  const { PDFName } = lib();
  const d = ctx.obj({});
  d.set(PDFName.of('N'), ref);
  return d;
}

// Normalized rect [x,y,w,h] (top-left origin) -> PDF edges for a page W×H.
function edges([x, y, w, h], W, H) {
  return {
    left: x * W,
    right: (x + w) * W,
    top: H * (1 - y),
    bottom: H * (1 - (y + h)),
  };
}

function pageAnnots(page) {
  const { PDFName, PDFArray } = lib();
  let annots = page.node.get(PDFName.of('Annots'));
  const ctx = page.node.context;
  annots = ctx.lookup(annots);
  if (!(annots instanceof PDFArray)) {
    annots = PDFArray.withContext(ctx);
    page.node.set(PDFName.of('Annots'), annots);
  }
  return annots;
}

function tagOurs(ctx, dict) {
  const { PDFName, PDFBool } = lib();
  dict.set(PDFName.of(MARK_KEY), PDFBool.True);
  dict.set(PDFName.of('T'), PDFLibString(ctx, 'ReadItOn'));
  dict.set(PDFName.of('F'), lib().PDFNumber.of(4)); // Print flag
}

function PDFLibString(ctx, s) {
  return lib().PDFString.of(String(s));
}

// ---- per-type annotation builders ------------------------------------------

function addHighlight(ctx, page, a, W, H) {
  const { PDFName } = lib();
  const [r, g, b] = hexToRgb01(a.color);
  const quads = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rect of a.rects || []) {
    const e = edges(rect, W, H);
    // top-left, top-right, bottom-left, bottom-right (the order Acrobat writes)
    quads.push(e.left, e.top, e.right, e.top, e.left, e.bottom, e.right, e.bottom);
    minX = Math.min(minX, e.left); maxX = Math.max(maxX, e.right);
    minY = Math.min(minY, e.bottom); maxY = Math.max(maxY, e.top);
  }
  if (!quads.length) return null;
  const rect = [minX, minY, maxX, maxY];

  // Appearance: fill each quad with the colour under a Multiply blend so text
  // shows through, exactly like a marker.
  let content = `/GS gs ${r} ${g} ${b} rg\n`;
  for (const rc of a.rects || []) {
    const e = edges(rc, W, H);
    content += `${e.left} ${e.bottom} ${e.right - e.left} ${e.top - e.bottom} re f\n`;
  }
  const gsRef = ctx.register(ctx.obj({
    Type: PDFName.of('ExtGState'), BM: PDFName.of('Multiply'), ca: 0.4,
  }));
  const apRef = appearanceStream(ctx, rect, content, { ExtGState: { GS: gsRef } });

  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Highlight'));
  dict.set(PDFName.of('Rect'), numArray(ctx, rect));
  dict.set(PDFName.of('QuadPoints'), numArray(ctx, quads));
  dict.set(PDFName.of('C'), numArray(ctx, [r, g, b]));
  dict.set(PDFName.of('CA'), lib().PDFNumber.of(0.4));
  dict.set(PDFName.of('AP'), apDict(ctx, apRef));
  tagOurs(ctx, dict);
  return dict;
}

function addUnderline(ctx, page, a, W, H) {
  const { PDFName } = lib();
  const [r, g, b] = hexToRgb01(a.color);
  const quads = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let content = `${r} ${g} ${b} RG 1.5 w\n`;
  for (const rect of a.rects || []) {
    const e = edges(rect, W, H);
    quads.push(e.left, e.top, e.right, e.top, e.left, e.bottom, e.right, e.bottom);
    const yy = e.bottom + 1;
    content += `${e.left} ${yy} m ${e.right} ${yy} l S\n`;
    minX = Math.min(minX, e.left); maxX = Math.max(maxX, e.right);
    minY = Math.min(minY, e.bottom); maxY = Math.max(maxY, e.top);
  }
  if (!quads.length) return null;
  const rect = [minX, minY, maxX, maxY];
  const apRef = appearanceStream(ctx, rect, content, {});

  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Underline'));
  dict.set(PDFName.of('Rect'), numArray(ctx, rect));
  dict.set(PDFName.of('QuadPoints'), numArray(ctx, quads));
  dict.set(PDFName.of('C'), numArray(ctx, [r, g, b]));
  dict.set(PDFName.of('AP'), apDict(ctx, apRef));
  tagOurs(ctx, dict);
  return dict;
}

function addInk(ctx, page, a, W, H) {
  const { PDFName } = lib();
  const [r, g, b] = hexToRgb01(a.color);
  const pts = (a.points || []).map(([x, y]) => [x * W, H * (1 - y)]);
  if (pts.length < 2) return null;
  const width = Math.max(1, (a.width || 0.003) * W);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ink = [];
  for (const [px, py] of pts) {
    ink.push(px, py);
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  const pad = width + 2;
  const rect = [minX - pad, minY - pad, maxX + pad, maxY + pad];

  let content = `${r} ${g} ${b} RG ${width} w 1 J 1 j\n`;
  content += `${pts[0][0]} ${pts[0][1]} m\n`;
  for (let i = 1; i < pts.length; i++) content += `${pts[i][0]} ${pts[i][1]} l\n`;
  content += 'S\n';
  const apRef = appearanceStream(ctx, rect, content, {});

  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Ink'));
  dict.set(PDFName.of('Rect'), numArray(ctx, rect));
  const inkList = lib().PDFArray.withContext(ctx);
  inkList.push(numArray(ctx, ink));
  dict.set(PDFName.of('InkList'), inkList);
  dict.set(PDFName.of('C'), numArray(ctx, [r, g, b]));
  dict.set(PDFName.of('BS'), ctx.obj({ W: width }));
  dict.set(PDFName.of('AP'), apDict(ctx, apRef));
  tagOurs(ctx, dict);
  return dict;
}

function addNote(ctx, page, a, W, H) {
  const { PDFName } = lib();
  const [r, g, b] = hexToRgb01(a.color);
  const x = a.x * W, yTop = H * (1 - a.y);
  const s = 18;
  const rect = [x, yTop - s, x + s, yTop];
  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Text'));
  dict.set(PDFName.of('Rect'), numArray(ctx, rect));
  dict.set(PDFName.of('Name'), PDFName.of('Comment'));
  dict.set(PDFName.of('Contents'), PDFLibString(ctx, a.text || ''));
  dict.set(PDFName.of('C'), numArray(ctx, [r, g, b]));
  dict.set(PDFName.of('Open'), lib().PDFBool.False);
  tagOurs(ctx, dict);
  return dict;
}

function addFreeText(ctx, page, a, W, H) {
  const { PDFName } = lib();
  const [r, g, b] = hexToRgb01(a.color);
  const size = Math.max(6, (a.size || 0.022) * H);
  const lines = String(a.text || '').split('\n');
  const x = a.x * W, yTop = H * (1 - a.y);
  const boxW = Math.max(40, W - x - 6);
  const boxH = Math.max(size + 4, size * 1.3 * lines.length + 4);
  const rect = [x, yTop - boxH, x + boxW, yTop];
  const dict = ctx.obj({});
  dict.set(PDFName.of('Type'), PDFName.of('Annot'));
  dict.set(PDFName.of('Subtype'), PDFName.of('FreeText'));
  dict.set(PDFName.of('Rect'), numArray(ctx, rect));
  dict.set(PDFName.of('Contents'), PDFLibString(ctx, a.text || ''));
  dict.set(PDFName.of('DA'), PDFLibString(ctx, `${r} ${g} ${b} rg /Helv ${size} Tf`));
  dict.set(PDFName.of('Q'), lib().PDFNumber.of(0));
  dict.set(PDFName.of('C'), numArray(ctx, [])); // no background fill
  tagOurs(ctx, dict);
  return dict;
}

const BUILDERS = {
  highlight: addHighlight,
  underline: addUnderline,
  freehand: addInk,
  note: addNote,
  text: addFreeText,
};

// ---- strip / embed / read --------------------------------------------------

// Remove every annotation ReadItOn previously authored (leaving other apps'
// annotations in place), so a re-save re-emits our marks cleanly.
export function stripReadItOnAnnots(doc) {
  const { PDFName, PDFArray } = lib();
  const ctx = doc.context;
  for (const page of doc.getPages()) {
    const annots = ctx.lookup(page.node.get(PDFName.of('Annots')));
    if (!(annots instanceof PDFArray)) continue;
    const keep = PDFArray.withContext(ctx);
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const dict = ctx.lookup(ref);
      const mine = dict && dict.get && dict.get(PDFName.of(MARK_KEY));
      if (mine) continue; // drop ours
      keep.push(ref);
    }
    if (keep.size()) page.node.set(PDFName.of('Annots'), keep);
    else page.node.delete(PDFName.of('Annots'));
  }
}

// Store ReadItOn's structured model inside the PDF (catalog /ReadItOn) as an
// uncompressed JSON stream, so re-opening is lossless with no external file.
function embedData(doc, dataObj) {
  const { PDFName } = lib();
  const ctx = doc.context;
  const json = JSON.stringify(dataObj || { version: 1, annotations: [] });
  const streamRef = ctx.register(ctx.stream(json, { Type: PDFName.of('ReadItOnData') }));
  doc.catalog.set(PDFName.of(DATA_KEY), streamRef);
}

function decodeStreamText(stream) {
  const bytes = stream.getContents ? stream.getContents() : null;
  if (!bytes) return null;
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  return Buffer.from(bytes).toString('utf8');
}

export function readEmbeddedData(doc) {
  const { PDFName, PDFStream } = lib();
  const ctx = doc.context;
  const ref = doc.catalog.get(PDFName.of(DATA_KEY));
  if (!ref) return null;
  const stream = ctx.lookup(ref, PDFStream);
  if (!stream) return null;
  try {
    const text = decodeStreamText(stream);
    const data = JSON.parse(text);
    if (!Array.isArray(data.annotations)) data.annotations = [];
    return data;
  } catch {
    return null;
  }
}

// ---- public API ------------------------------------------------------------

// Build a PDF (Uint8Array) that carries `dataObj.annotations` as native PDF
// annotations plus the embedded ReadItOn model. Idempotent: pass a PDF we
// previously produced and it re-emits cleanly instead of stacking.
export async function buildAnnotatedPdf(baseBytes, dataObj) {
  const { PDFDocument } = lib();
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const pages = doc.getPages();

  stripReadItOnAnnots(doc);

  const annotations = (dataObj && Array.isArray(dataObj.annotations)) ? dataObj.annotations : [];
  for (const a of annotations) {
    const page = pages[a.page - 1];
    const builder = BUILDERS[a.type];
    if (!page || !builder) continue;
    const { width: W, height: H } = page.getSize();
    const dict = builder(ctx, page, a, W, H);
    if (!dict) continue;
    const ref = ctx.register(dict);
    pageAnnots(page).push(ref);
  }

  embedData(doc, dataObj);
  return doc.save({ useObjectStreams: false });
}

// Read ReadItOn's structured model back out of a PDF's bytes (or null if this
// PDF was never annotated by ReadItOn).
export async function readAnnotationData(baseBytes) {
  const { PDFDocument } = lib();
  const doc = await PDFDocument.load(baseBytes, { ignoreEncryption: true });
  return readEmbeddedData(doc);
}
