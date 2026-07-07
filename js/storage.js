// Storage backend: the user's Google Drive is the single source of truth.
// Papers (and their notes) live in the Drive folder the user chose via the
// picker, or — when no picker/API key is configured — an auto-created
// "ReadItOn" folder.
//
// Interface (all async):
//   kind
//   listPapers()               -> [{ id, name, modifiedTime }]
//   importPdf(name, buffer)    -> paper meta
//   openPaper(paper)           -> { bytes: ArrayBuffer, annotations: {...} }
//   saveAnnotations(paper,data)
//   deletePaper(paper)
import { drive } from './drive.js';
import { settings } from './store.js';
import { buildAnnotatedPdf, readAnnotationData } from './pdfAnnotator.js';

function emptyAnnots() { return { version: 1, annotations: [] }; }

export function createDriveBackend() {
  let libraryFolderId = null;              // lazily-created fallback folder
  const sidecarIds = new Map();            // paperId -> legacy .json file id (for migration)
  const migrated = new Set();              // papers whose legacy sidecar was already cleaned up

  // The folder papers are stored in: the user's chosen folder, else the
  // auto "ReadItOn" folder.
  async function folder() {
    const chosen = settings.getFolder();
    if (chosen?.id) return chosen.id;
    if (!libraryFolderId) libraryFolderId = await drive.getLibraryFolderId();
    return libraryFolderId;
  }

  return {
    kind: 'drive',

    async listPapers() {
      return drive.listPapers(await folder());
    },

    async importPdf(name, buffer) {
      return drive.uploadPdf(await folder(), name, buffer);
    },

    // Just the PDF bytes (used for rendering library thumbnails).
    async getBytes(paper) {
      return drive.downloadArrayBuffer(paper.id);
    },

    async openPaper(paper) {
      const bytes = await drive.downloadArrayBuffer(paper.id);

      // Annotations now live INSIDE the PDF (as native annotations plus an
      // embedded ReadItOn model), so there's no sidecar to read.
      let data = null;
      try { data = await readAnnotationData(bytes.slice(0)); } catch { data = null; }

      // Back-compat: papers annotated by older builds still have an external
      // ".readiton.json" sidecar. Read it, then it gets folded into the PDF and
      // trashed on the next save.
      if (!data) {
        const af = await drive.findAnnotationFile(paper.id);
        if (af) {
          sidecarIds.set(paper.id, af.id);
          try { data = await drive.downloadJson(af.id); } catch { data = null; }
        }
      }

      if (!data) data = { ...emptyAnnots(), pdfId: paper.id, pdfName: paper.name };
      if (!Array.isArray(data.annotations)) data.annotations = [];
      if (!data.pdfId) data.pdfId = paper.id;
      if (!data.pdfName) data.pdfName = paper.name;
      return { bytes, annotations: data };
    },

    // Write the annotations into the PDF itself and replace the file on Drive,
    // so the marks are visible in Drive and any reader — and stay editable in
    // ReadItOn. Returns the new PDF bytes so the caller can keep working from
    // the up-to-date document.
    async saveAnnotations(paper, data, pdfBytes) {
      // Rebuild from the FRESHEST bytes on Drive, not the copy downloaded at
      // open time. Another app (PDF Expert, Acrobat…) may have synced its own
      // annotations to this PDF since then; building on stale bytes would
      // silently wipe those. Only our tagged marks are replaced.
      let base = pdfBytes;
      try { base = await drive.downloadArrayBuffer(paper.id); } catch { /* offline — fall back to in-memory copy */ }
      const newBytes = await buildAnnotatedPdf(base, data);
      await drive.updatePdf(paper.id, newBytes);

      // Retire any leftover legacy sidecar now that everything lives in the PDF.
      const sid = sidecarIds.get(paper.id);
      if (sid) {
        await drive.trash(sid).catch(() => {});
        sidecarIds.delete(paper.id);
        migrated.add(paper.id);
      } else if (!migrated.has(paper.id)) {
        const af = await drive.findAnnotationFile(paper.id).catch(() => null);
        if (af) await drive.trash(af.id).catch(() => {});
        migrated.add(paper.id);
      }
      return newBytes;
    },

    async deletePaper(paper) {
      const af = await drive.findAnnotationFile(paper.id);
      if (af) await drive.trash(af.id);
      await drive.trash(paper.id);
    },
  };
}
