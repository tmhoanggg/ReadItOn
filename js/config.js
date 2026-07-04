// ===================================================================
//  Deployment configuration for ReadItOn
// ===================================================================
//
//  OPTIONAL — only needed if you want Google Drive sync on your deployment.
//  The app works fully without it (annotations save in the browser).
//
//  To enable one-click "Connect Google Drive" for every visitor, paste ONE
//  OAuth Client ID below (you create it once — see README §"Enable Drive sync").
//  It is safe to commit: OAuth Web Client IDs are public; access is restricted
//  by the Authorized JavaScript origins you set on the client.
//
export const CLIENT_ID = ''; // e.g. '1234567890-abcдef.apps.googleusercontent.com'

// ---- Internals (no need to change) -------------------------------
export const APP_NAME = 'ReadItOn';
export const LIBRARY_FOLDER_NAME = 'ReadItOn';
export const APP_TAG = 'readiton';

// Non-sensitive scopes → no Google verification / no "unverified app" screen.
export const SCOPES = 'https://www.googleapis.com/auth/drive.file email profile';

export const PDFJS_WORKER =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export const DEFAULT_COLORS = ['#ffd400', '#7ee081', '#7fb2ff', '#ff9ecb', '#ff6b6b', '#b892ff'];
