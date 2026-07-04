// ===================================================================
//  Deployment configuration for ReadItOn
// ===================================================================
//
//  ReadItOn stores every paper and its notes in YOUR Google Drive, so
//  Google sign-in is required to use the app. You register ONE OAuth
//  client once (see SETUP.md) and paste its Client ID below.
//
//  Both values here are PUBLIC by design and safe to commit. Access is
//  restricted by the Authorized origins / referrers you set on them in
//  the Google Cloud Console.
//
// -------------------------------------------------------------------

// OAuth Web Client ID — REQUIRED. Enables "Connect Google Drive".
export const CLIENT_ID = '158324090486-3ou2s7f9dvs5q7k828kg5fk6ov5keale.apps.googleusercontent.com';

// Google API key — no longer required (the folder picker was replaced by an
// in-app Drive browser). Kept here only so old configs don't break; unused.
export const API_KEY = '';

// ---- Internals (no need to change) -------------------------------
export const APP_NAME = 'ReadItOn';
export const LIBRARY_FOLDER_NAME = 'ReadItOn';
export const APP_TAG = 'readiton';

// Full Drive access so the app can BROWSE folders and open files you already
// have in Drive (not just files it created). This is a "restricted" scope, so
// Google shows a one-time "unverified app" screen you click through (Advanced →
// Go to ReadItOn). Add this scope on the OAuth consent screen (see SETUP.md).
export const SCOPES = 'https://www.googleapis.com/auth/drive email profile';

export const PDFJS_WORKER =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

export const DEFAULT_COLORS = ['#ffd400', '#7ee081', '#7fb2ff', '#ff9ecb', '#ff6b6b', '#b892ff'];

// Default ink color per tool (the color is preselected the moment you pick a tool).
export const TOOL_COLORS = {
  highlight: '#ffd400', // yellow
  underline: '#ff6b6b', // red
  freehand:  '#7fb2ff', // blue
  text:      '#7fb2ff', // blue
  note:      '#ffd400', // yellow
};
