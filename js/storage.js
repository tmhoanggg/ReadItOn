// Storage backends behind one interface so the app doesn't care where papers
// live. Two implementations:
//   • local  — IndexedDB in the browser (default, zero setup, this-device-only)
//   • drive  — the user's Google Drive (optional, syncs across devices)
//
// Interface (all async):
//   kind
//   listPapers()               -> [{ id, name, modifiedTime }]
//   importPdf(name, buffer)    -> paper meta
//   openPaper(paper)           -> { bytes: ArrayBuffer, annotations: {...} }
//   saveAnnotations(paper,data)
//   deletePaper(paper)
import { idbGet, idbGetAll, idbPut, idbDelete } from './db.js';
import { drive } from './drive.js';
import { uid } from './store.js';

function emptyAnnots() { return { version: 1, annotations: [] }; }

export function createLocalBackend() {
  return {
    kind: 'local',

    async listPapers() {
      const rows = await idbGetAll('papers');
      return rows.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
    },

    async importPdf(name, buffer) {
      const id = uid();
      const now = new Date().toISOString();
      const meta = { id, name, modifiedTime: now, createdAt: now, size: buffer.byteLength };
      await idbPut('pdfs', { id, blob: new Blob([buffer], { type: 'application/pdf' }) });
      await idbPut('annots', { id, data: { ...emptyAnnots(), pdfName: name } });
      await idbPut('papers', meta);
      return meta;
    },

    async openPaper(paper) {
      const rec = await idbGet('pdfs', paper.id);
      const ann = await idbGet('annots', paper.id);
      const bytes = await rec.blob.arrayBuffer();
      const annotations = ann?.data && Array.isArray(ann.data.annotations) ? ann.data : emptyAnnots();
      return { bytes, annotations };
    },

    async saveAnnotations(paper, data) {
      await idbPut('annots', { id: paper.id, data });
      const meta = await idbGet('papers', paper.id);
      if (meta) { meta.modifiedTime = new Date().toISOString(); await idbPut('papers', meta); }
    },

    async deletePaper(paper) {
      await idbDelete('pdfs', paper.id);
      await idbDelete('annots', paper.id);
      await idbDelete('papers', paper.id);
    },
  };
}

export function createDriveBackend() {
  let folderId = null;
  const annotFileIds = new Map(); // paperId -> annotations file id

  async function folder() {
    if (!folderId) folderId = await drive.getLibraryFolderId();
    return folderId;
  }

  return {
    kind: 'drive',

    async listPapers() {
      return drive.listPapers(await folder());
    },

    async importPdf(name, buffer) {
      return drive.uploadPdf(await folder(), name, buffer);
    },

    async openPaper(paper) {
      const bytes = await drive.downloadArrayBuffer(paper.id);
      let data;
      const af = await drive.findAnnotationFile(paper.id);
      if (af) {
        annotFileIds.set(paper.id, af.id);
        data = await drive.downloadJson(af.id);
      } else {
        data = { ...emptyAnnots(), pdfId: paper.id, pdfName: paper.name };
        const created = await drive.createAnnotationFile(await folder(), paper.id, paper.name, data);
        annotFileIds.set(paper.id, created.id);
      }
      if (!Array.isArray(data.annotations)) data.annotations = [];
      return { bytes, annotations: data };
    },

    async saveAnnotations(paper, data) {
      let fid = annotFileIds.get(paper.id);
      if (!fid) {
        const created = await drive.createAnnotationFile(await folder(), paper.id, paper.name, data);
        fid = created.id;
        annotFileIds.set(paper.id, fid);
      }
      await drive.updateJson(fid, data);
    },

    async deletePaper(paper) {
      const af = await drive.findAnnotationFile(paper.id);
      if (af) await drive.trash(af.id);
      await drive.trash(paper.id);
    },
  };
}

// Copy every paper in the local library into Drive (best effort, per-paper).
export async function migrateLocalToDrive(driveBackend) {
  const local = createLocalBackend();
  const papers = await local.listPapers();
  let ok = 0;
  for (const p of papers) {
    try {
      const { bytes, annotations } = await local.openPaper(p);
      const created = await driveBackend.importPdf(p.name, bytes);
      if (annotations.annotations?.length) {
        await driveBackend.saveAnnotations(created, annotations);
      }
      ok++;
    } catch (e) {
      console.warn('Migrate failed for', p.name, e);
    }
  }
  return { total: papers.length, ok };
}
