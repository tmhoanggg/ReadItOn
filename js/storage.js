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

function emptyAnnots() { return { version: 1, annotations: [] }; }

export function createDriveBackend() {
  let libraryFolderId = null;              // lazily-created fallback folder
  const annotFileIds = new Map();          // paperId -> annotations file id

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
