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

// Google API key — OPTIONAL. Enables the "Choose folder" picker so users
// can store papers in ANY folder of their Drive. Leave blank to skip the
// picker: papers then go into an auto-created "ReadItOn" folder instead.
// To enable: enable the "Google Picker API" and create an API key (SETUP.md).
export const API_KEY = 'AIzaSyDWdk8yT5x7zqwwK2aST_sCppQNFgKM0Hw';

// ---- Internals (no need to change) -------------------------------
export const APP_NAME = 'ReadItOn';
export const LIBRARY_FOLDER_NAME = 'ReadItOn';
export const APP_TAG = 'readiton';

// Non-sensitive scopes → no Google verification / no "unverified app" screen.
export const SCOPES = 'https://www.googleapis.com/auth/drive.file email profile';

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
