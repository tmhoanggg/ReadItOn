<div align="center">

# ReadItOn 📖

**A beautiful, in-browser PDF reader that lets you highlight and annotate your
papers — and optionally sync them to your own Google Drive across every device.**

*Local-first · no account required · no build step · works on any laptop*

</div>

---

## ✨ Features

- **Annotate anything** — highlight, underline, sticky notes, freehand pen, typed text boxes, custom colors.
- **Works instantly, no sign-in** — open a PDF and start marking it up. Notes save right in your browser.
- **Optional Google Drive sync** — one click connects your Drive so your papers and notes follow you to every device.
- **Export** a flattened PDF with all annotations burned in.
- **Polished UI** — clean design, light & dark themes, keyboard shortcuts.
- **Private** — with Drive, files live in a `ReadItOn` folder in *your* Drive; the app can only see files it created.

---

## 🚀 Use it

Just open the deployed site. That's it — import a PDF (drag it in or click **Import**)
and annotate. Your work is saved locally in the browser.

Want it on all your laptops? Click **Connect Drive** once. From then on, opening the
site on any device and connecting the same Google account shows your whole library.

**Keyboard shortcuts:** `V` select · `H` highlight · `U` underline · `N` note ·
`P` pen · `T` text · `Esc` back to select.

---

## 🖥️ Run locally

You need any static file server. With Python:

```bash
cd readiton
python3 -m http.server 8000
```

Open <http://localhost:8000>. (Or use `npx serve`, VS Code Live Server, etc.)

---

## 🌐 Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Repo → **Settings → Pages** → *Deploy from branch* → `main` (or `master`) / root.
3. Your app is live at `https://YOURNAME.github.io/REPO/`.

The app is fully functional at this point (local-first mode). Google Drive sync is
**optional** and set up separately below.

---

## ☁️ Enable Google Drive sync (optional, one-time)

This lets **every visitor** connect their own Drive with a single click — they
create nothing. You, the deployer, register **one** OAuth client once. Because the
app only uses **non-sensitive scopes** (`drive.file`, `email`, `profile`), Google
requires **no verification and shows no "unverified app" warning**.

1. In the [Google Cloud Console](https://console.cloud.google.com/), create a project.
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen:**
   - User type **External** → create; fill app name/emails.
   - **Publish app → In production.** (No verification needed for these scopes; this
     removes the test-user limit so anyone can sign in.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Type **Web application**.
   - **Authorized JavaScript origins** — add each URL the app runs at, origin only:
     - `http://localhost:8000`
     - `https://YOURNAME.github.io`
   - Create, then copy the **Client ID**.
5. Paste it into [`js/config.js`](js/config.js):
   ```js
   export const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
   ```
   Commit & redeploy. (This ID is public by design — safe to commit. Access is
   restricted to the origins you listed.)

> Prefer not to edit code? Each user can instead paste their own Client ID under
> **Settings ⚙ → Advanced**; it's stored only in their browser.

---

## 📦 How your data is stored

| Mode | Where notes live | Syncs across devices? |
|------|------------------|-----------------------|
| **On-device** (default) | Browser IndexedDB | No |
| **Google Drive** (connected) | `ReadItOn` folder in your Drive: the PDF + a `<name>.readiton.json` sidecar | Yes |

Annotations are stored in zoom-independent coordinates, so they render correctly at
any size. Drive edits autosave within ~1 second. Your original PDF is never modified —
**Export** produces a separate flattened copy.

When you first connect Drive, the app offers to upload your existing on-device papers.

---

## 🛠️ Tech & structure

Vanilla ES modules — no framework, no bundler. Libraries load from CDN:
[pdf.js](https://mozilla.github.io/pdf.js/) (render), [pdf-lib](https://pdf-lib.js/) (export),
Google Identity Services (auth).

```
index.html          shell, toolbar, SVG icon sprite
css/styles.css      design system (light + dark)
js/config.js        deployment config (Client ID, scopes)
js/store.js         settings + helpers
js/db.js            IndexedDB helper (local library)
js/storage.js       local + Drive backends behind one interface
js/auth.js          Google sign-in (GIS token client)
js/drive.js         Google Drive v3 REST wrapper
js/viewer.js        pdf.js rendering (canvas + text layer)
js/annotations.js   annotation model, rendering, input, autosave
js/export.js        flatten annotations into a PDF
js/app.js           controller wiring it all together
```

---

## 🧯 Troubleshooting

- **Connect Drive does nothing / "add a Client ID"** — Drive sync isn't configured;
  see *Enable Google Drive sync* above.
- **`redirect_uri_mismatch` / origin error** — the URL you're on isn't in the OAuth
  client's *Authorized JavaScript origins*. Add the exact origin (scheme + host + port).
- **Popup blocked** — allow popups for the site, then click *Connect Drive* again.
- **Blank page** — the app loads pdf.js / pdf-lib / Google's script from CDNs, so it
  needs an internet connection. Check the browser console.

---

<div align="center"><sub>Made for readers who annotate. 📚</sub></div>
