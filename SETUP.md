# Deploying ReadItOn

This is the **deployer's** guide (setup, hosting, Google config). End users don't
need any of this — see the [README](README.md) for how to *use* the app.

ReadItOn is vanilla ES modules — no framework, no bundler, no build step. It stores
every paper and its notes in the signed-in user's **Google Drive**, so Google sign-in
is required and you must register one OAuth client.

---

## 1. Run it locally

Any static file server works. With Python:

```bash
cd readiton
python3 -m http.server 8000
```

Open <http://localhost:8000>.

---

## 2. Create the Google credentials

Both values you create here are **public and safe to commit**; access is restricted by
the origins/referrers you set on them. The app uses only **non-sensitive scopes**
(`drive.file`, `email`, `profile`), so Google requires **no verification** and shows
**no "unverified app" warning**.

In the [Google Cloud Console](https://console.cloud.google.com/):

1. **Create a project.**
2. **APIs & Services → Library** → enable **Google Drive API**.
   - Also enable **Google Picker API** (only needed for the "choose any folder" picker — see step 3b).
3. **APIs & Services → OAuth consent screen:**
   - User type **External** → create; fill in app name / emails.
   - **Publish app → In production** (removes the test-user limit; no verification needed for these scopes).

### 3a. OAuth Client ID — **required**

- **APIs & Services → Credentials → Create credentials → OAuth client ID.**
- Type **Web application**.
- **Authorized JavaScript origins** — add each origin (scheme + host + port, no path):
  - `http://localhost:8000`
  - `https://YOURNAME.github.io`
- Create, copy the **Client ID**, and paste it into [`js/config.js`](js/config.js):
  ```js
  export const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
  ```

### 3b. API key for the folder picker — **optional**

Without this, papers go into an auto-created **`ReadItOn`** folder. Add it to let users
store papers in **any** folder of their Drive via Google's folder picker.

- **APIs & Services → Credentials → Create credentials → API key.**
- Recommended: **restrict** the key to *HTTP referrers* (your origins) and to the
  *Google Picker API*.
- Make sure the **Google Picker API** is enabled (step 2).
- Paste it into [`js/config.js`](js/config.js):
  ```js
  export const API_KEY = 'AIza...';
  ```

> Users can also override the Client ID for their own browser under
> **Settings ⚙ → Advanced**, without editing code.

---

## 3. Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → *Deploy from a branch* → `main` / root.
3. Your app is live at `https://YOURNAME.github.io/REPO/`.
4. Make sure that origin is listed in your OAuth client's **Authorized JavaScript origins** (step 3a).

Pushing to `main` re-deploys automatically.

---

## How data is stored

| What | Where |
|------|-------|
| PDF | The chosen Drive folder (or auto `ReadItOn` folder) |
| Notes | A `<name>.readiton.json` sidecar next to the PDF |
| Session | The OAuth token is cached in the browser's `localStorage` so reloads stay signed in (~1h, then refreshed silently) |

Annotations use zoom-independent coordinates, so they render correctly at any size.
Saving is **manual** — changes are written to Drive when the user clicks **Save**
(or `Ctrl/⌘ + S`); the app warns before leaving with unsaved changes. Your original
PDF is never modified — **Export** produces a separate flattened copy.

---

## Troubleshooting

- **"Connect Drive" does nothing / "add a Client ID"** — `CLIENT_ID` isn't set in `js/config.js` (step 3a).
- **`redirect_uri_mismatch` / origin error** — the current URL isn't in the OAuth client's *Authorized JavaScript origins*. Add the exact origin (scheme + host + port).
- **Folder picker won't open** — set `API_KEY` and enable the **Google Picker API** (step 3b).
- **Popup blocked** — allow popups for the site, then click *Connect Drive* again.
- **Blank page** — the app loads pdf.js / pdf-lib / Google scripts from CDNs, so it needs an internet connection. Check the browser console.

---

## Project structure

```
index.html          shell, toolbar, SVG icon sprite
css/styles.css      design system (light + dark)
js/config.js        deployment config (Client ID, API key, scopes)
js/store.js         settings (colors, folder) + helpers
js/auth.js          Google sign-in (GIS token client, persisted session)
js/drive.js         Google Drive v3 REST wrapper
js/picker.js        Google Picker folder chooser
js/storage.js       Drive storage backend
js/viewer.js        pdf.js rendering (canvas + text layer)
js/annotations.js   annotation model, rendering, input, undo
js/export.js        flatten annotations into a PDF
js/app.js           controller wiring it all together
```
