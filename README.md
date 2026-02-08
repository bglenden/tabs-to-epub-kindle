# Tabs to EPUB & Kindle

Chrome extension that saves one or more open browser tabs as a clean, Kindle-friendly EPUB. Multiple tabs become chapters with a table of contents. Optionally emails the EPUB directly to your Kindle.

## Features

- **One-click EPUB** — select one or more tabs, right-click, save as EPUB.
- **Kindle delivery** — email the EPUB to your Kindle via Gmail with a single checkbox.
- **Image embedding** — images in articles are downloaded and embedded into the EPUB.
- **Clean extraction** — Mozilla Readability strips ads, nav, and boilerplate for a reading-focused output.
- **Flexible output** — choose a specific folder, use Chrome's Downloads, or get a Save As dialog each time.
- **Context menu + popup** — save from the right-click menu or the toolbar popup.

## Install

1. Clone and build:

```sh
git clone https://github.com/brianglendenning/tabs-to-epub-kindle.git
cd tabs-to-epub-kindle
npm install
npm run vendorize
npm run build
```

2. Load the extension in Chrome:

- Open `chrome://extensions` and enable **Developer mode**.
- Click **Load unpacked** and choose the `dist` folder.

## Usage

### Saving tabs

Right-click inside a page (or the toolbar icon) and choose **Tabs to EPUB & Kindle**:

- **Save tab(s) to EPUB** — saves the highlighted tabs (or just the active tab).
- **Save tab(s) to EPUB and close** — saves and then closes the tabs.

Check **Email to Kindle** in the context menu or popup to also email the EPUB to your Kindle. The checkbox state is persistent and synced between the popup and context menu.

### Output folder

The popup offers three output modes:

- **Choose Folder** — pick a directory via the OS folder picker. EPUBs are written directly with no dialog. (Chrome blocks selecting top-level directories like Downloads — pick or create a sub-folder, e.g. `Downloads/EPUB`.)
- **Use Downloads** — saves silently to Chrome's default download location.
- **Clear** — resets to no preference; each save shows a Save As dialog.

### File naming

Files are named with a timestamp and the unique domains from the selected tabs:

```
2026-02-04T20_34_11 nytimes cnn wikipedia.epub
```

## Kindle email setup

Email delivery uses `chrome.identity` with the Gmail API and requires your own Google OAuth client credentials.

1. Create a Google Cloud project and enable the Gmail API.
2. Create an OAuth client for a Chrome Extension with your extension ID.
3. Set the `oauth2.client_id` in `manifest.json` to your client ID.
4. Rebuild (`npm run build`) and reload the extension.
5. Enter your Kindle email address in the popup.
6. Add your Gmail address to Amazon's [approved senders list](https://www.amazon.com/gp/help/customer/display.html?nodeId=GX9XLEVV8G4DB28H) for your Kindle.

See `KINDLE_EMAIL_SETUP.md` for detailed step-by-step instructions.

**Size limit:** The Gmail API enforces a 35 MB message limit, which allows roughly 20 MB attachments after encoding. The extension checks this before sending and will show an error if the EPUB is too large.

## Development

```sh
npm run dev        # Watch mode — rebuilds on changes
npm test           # Unit tests
npm run test:e2e   # End-to-end tests (Playwright + Chromium)
npm run lint       # ESLint
npm run typecheck  # TypeScript type checking
```

See `AGENTS.md` for architecture details and internal documentation.

## Notes

- Extraction quality depends on Mozilla Readability and varies by site.
- If an image fetch fails (CORS, auth, or blocked), the EPUB falls back to the original remote URL.
- The manifest includes a stable `key` so the extension ID stays consistent across installs, which is required for the OAuth client binding.
