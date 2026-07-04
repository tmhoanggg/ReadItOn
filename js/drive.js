// Thin wrapper over the Google Drive v3 REST API.
// Uses `drive.file` scope: we can only see files this app created — which is
// exactly the ReaditOn library folder and its contents. Nice and private.
import { auth } from './auth.js';
import { LIBRARY_FOLDER_NAME, APP_TAG } from './config.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// Fetch with bearer token; retry once on 401 after a silent token refresh.
async function driveFetch(url, opts = {}, _retry = false) {
  const token = await auth.getToken();
  const headers = new Headers(opts.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401 && !_retry) {
    return driveFetch(url, opts, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function driveJson(url, opts) {
  const res = await driveFetch(url, opts);
  return res.json();
}

function q(params) {
  return Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

// Build a multipart/related upload body (metadata + content) as a Blob.
function multipartBody(metadata, content, contentType) {
  const boundary = 'readiton' + Math.random().toString(36).slice(2);
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const blob = new Blob([head, content, tail], {
    type: `multipart/related; boundary=${boundary}`,
  });
  return blob;
}

export const drive = {
  // Find (or lazily create) the ReaditOn library folder; returns its id.
  async getLibraryFolderId() {
    const query =
      `mimeType='application/vnd.google-apps.folder' and name='${LIBRARY_FOLDER_NAME}' ` +
      `and trashed=false and 'root' in parents`;
    const url = `${API}/files?` + q({ q: query, fields: 'files(id,name)', spaces: 'drive' });
    const data = await driveJson(url);
    if (data.files?.length) return data.files[0].id;

    const created = await driveJson(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: LIBRARY_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      }),
    });
    return created.id;
  },

  // List PDFs in the library folder (newest first).
  async listPapers(folderId) {
    const query =
      `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
    const url = `${API}/files?` + q({
      q: query,
      fields: 'files(id,name,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
      pageSize: '200',
    });
    const data = await driveJson(url);
    return data.files || [];
  },

  // Upload a new PDF (bytes = ArrayBuffer/Uint8Array/Blob). Returns file meta.
  async uploadPdf(folderId, name, bytes) {
    const metadata = {
      name,
      parents: [folderId],
      mimeType: 'application/pdf',
      appProperties: { [APP_TAG]: 'pdf' },
    };
    const body = multipartBody(metadata, bytes, 'application/pdf');
    return driveJson(
      `${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`,
      { method: 'POST', body }
    );
  },

  // Find the annotations JSON file that belongs to a given PDF, if any.
  async findAnnotationFile(pdfId) {
    const query =
      `appProperties has { key='pdfId' and value='${pdfId}' } and trashed=false`;
    const url = `${API}/files?` + q({ q: query, fields: 'files(id,name,modifiedTime)' });
    const data = await driveJson(url);
    return data.files?.[0] || null;
  },

  // Create the annotations JSON file for a PDF. Returns file meta.
  async createAnnotationFile(folderId, pdfId, pdfName, jsonObject) {
    const metadata = {
      name: `${pdfName}.readiton.json`,
      parents: [folderId],
      mimeType: 'application/json',
      appProperties: { [APP_TAG]: 'annot', pdfId },
    };
    const body = multipartBody(metadata, JSON.stringify(jsonObject), 'application/json');
    return driveJson(
      `${UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`,
      { method: 'POST', body }
    );
  },

  // Overwrite the content of an existing file with a JSON object.
  async updateJson(fileId, jsonObject) {
    return driveJson(
      `${UPLOAD}/files/${fileId}?uploadType=media&fields=id,modifiedTime`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonObject),
      }
    );
  },

  async downloadArrayBuffer(fileId) {
    const res = await driveFetch(`${API}/files/${fileId}?alt=media`);
    return res.arrayBuffer();
  },

  async downloadJson(fileId) {
    const res = await driveFetch(`${API}/files/${fileId}?alt=media`);
    return res.json();
  },

  // Move a file to trash (recoverable). Used for both PDF and its annotations.
  async trash(fileId) {
    return driveJson(`${API}/files/${fileId}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  },
};
