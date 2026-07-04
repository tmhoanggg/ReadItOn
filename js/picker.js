// Google Picker — lets the user choose ANY folder in their Drive to store
// papers in. Requires an API key (config.js API_KEY) and the "Google Picker
// API" enabled in the Cloud project. Loaded lazily on first use.
//
// Under the drive.file scope, choosing a folder here grants the app access to
// that folder so it can create and list ReadItOn papers inside it.
import { auth } from './auth.js';
import { settings } from './store.js';

let pickerReady = null;

// Load the picker module of the Google API client (gapi from apis.google.com).
function loadPicker() {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    const start = Date.now();
    (function wait() {
      if (window.gapi?.load) {
        window.gapi.load('picker', {
          callback: () => resolve(),
          onerror: () => reject(new Error('Failed to load Google Picker')),
          timeout: 10000,
          ontimeout: () => reject(new Error('Google Picker timed out')),
        });
        return;
      }
      if (Date.now() - start > 12000) return reject(new Error('Google API library failed to load'));
      setTimeout(wait, 60);
    })();
  });
  return pickerReady;
}

// Opens the folder picker. Resolves { id, name } on choose, null on cancel.
export async function pickFolder() {
  if (!settings.hasPicker()) throw new Error('NO_API_KEY');
  const token = await auth.getToken();
  await loadPicker();
  const gp = window.google.picker;

  return new Promise((resolve, reject) => {
    try {
      const view = new gp.DocsView(gp.ViewId.FOLDERS)
        .setSelectFolderEnabled(true)
        .setIncludeFolders(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const picker = new gp.PickerBuilder()
        .setTitle('Choose a folder for your ReadItOn papers')
        .addView(view)
        .setOAuthToken(token)
        .setDeveloperKey(settings.getApiKey())
        .setSelectableMimeTypes('application/vnd.google-apps.folder')
        .setCallback((data) => {
          const action = data[gp.Response.ACTION];
          if (action === gp.Action.PICKED) {
            const doc = data[gp.Response.DOCUMENTS][0];
            resolve({ id: doc[gp.Document.ID], name: doc[gp.Document.NAME] });
          } else if (action === gp.Action.CANCEL) {
            resolve(null);
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}
