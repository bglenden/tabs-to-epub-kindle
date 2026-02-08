# AGENTS.md

Project: **Tabs to EPUB & Kindle** — Chrome MV3 extension that turns one or more open browser tabs into Kindle-friendly output files. Article tabs become an EPUB (with multi-tab TOC); PDF tabs are preserved as standalone PDFs. Optionally emails output files to a Kindle via Gmail API.

## Architecture

### Core (`src/core/`)
Platform-independent EPUB generation. No Chrome APIs.

- **`epub.ts`** — assembles XHTML sections + assets into a ZIP (EPUB 3.0) with TOC, NCX, and OPF metadata. Entry point: `buildEpub(articles, options)`.
- **`zip.ts`** — minimal ZIP archive builder (store-only, no compression). Produces valid EPUB containers.
- **`strings.ts`** — XML escaping, filename sanitization, timestamp formatting.
- **`types.ts`** — shared types (`ArticleInput`, `EpubAsset`, `BuildEpubOptions`, etc.).

### Extension (`src/extension/`)
Chrome extension glue: content scripts, background service worker, popup UI.

- **`background.ts`** — MV3 service worker. Orchestrates tab classification (article vs PDF), extraction, image embedding, EPUB building, PDF fetching, downloading, and emailing. Registers context menus. Handles all `TEST_*` and `UI_*` messages from the test harness and popup.
- **`content-extract.ts`** — content script injected into pages. Sanitizes HTML, collects image tokens, serializes valid XHTML.
- **`extractor-readability.ts`** — content script that runs Mozilla Readability on a cloned DOM with pre-cleaning heuristics to strip boilerplate.
- **`popup.html` / `popup.ts`** — toolbar popup UI. Two save buttons, "Email to Kindle" checkbox, output folder picker (File System Access API), Kindle email configuration.
- **`directory-handle.ts`** — IndexedDB helper to persist a `FileSystemDirectoryHandle` across sessions. Functions: `storeHandle`, `loadHandle`, `clearHandle`, `getDirectoryState`, `writeFile`.
- **`email-gmail.ts`** — Gmail API client. Builds MIME messages with one or more attachments, handles base64url encoding, auth token retry on 401/403. Enforces a 35 MB Gmail API size limit before sending.
- **`kindle-email.ts`** — Kindle-specific layer over Gmail. Email validation, `chrome.identity` token management, attachment batching (`splitAttachmentsForKindle`), and calls to `sendGmailMessage`.
- **`email-artifacts.ts`** — artifact-level Kindle email orchestration. Sends EPUB/PDF artifacts, captures oversize-email failures, and applies `TOO LARGE FOR EMAIL ` filename prefixes before save.
- **`filename.ts`** — generates output filenames as `YYYY-MM-DDTHH_MM_SS <domain list>.epub`.
- **`pdf.ts`** — PDF tab detection and naming utilities. Detects PDFs from URL patterns, Chrome PDF viewer `src`, or network content-type/magic bytes; generates sanitized timestamped PDF filenames.
- **`pdf-dom-discovery.ts`** — wrapper-page PDF source discovery. Scans DOM/script/meta candidates (including `fetch("...pdf")` patterns and arXiv/alphaxiv URL heuristics), ranks candidates, and returns likely PDF URLs for verification.
- **`image-assets.ts`** — image fetch/embed pipeline used by the background EPUB builder.
- **`harness.ts`** — test harness script loaded by `test.html`. Exposes `window.TabToEpubTest.send()` (for `TEST_*` messages) and `sendUi()` (for `UI_*` messages) to Playwright.
- **`fs-access.d.ts`** — type declarations for File System Access API extensions (`queryPermission`, `requestPermission`, `showDirectoryPicker`).
- **`types.ts`** — extension-specific types: `Settings`, `TestMessage`, `UiMessage`, `TestResponse`, `UiResponse`, etc.
- **`icons/`** — toolbar and extension icons at 16, 48, 128px.

### Global types (`src/types/`)
- **`globals.d.ts`** — ambient type declarations for `TestMessage`, `TestResponse`, `UiMessage`, `UiResponse`, `TabToEpubTestApi`, and `TabToEpubExtractor`. Used by the test harness (which has no imports).

## Message protocols

### `TEST_*` messages (test harness → background)
Require `testMode: true` in settings. Used by Playwright e2e tests.

| Message | Purpose |
|---|---|
| `TEST_SET_MODE` | Enable/disable test mode |
| `TEST_RESET_STATE` | Reset all settings to defaults |
| `TEST_LIST_TABS` | List tabs in current window |
| `TEST_SAVE_ACTIVE_TAB` | Build EPUB from active tab, return base64 |
| `TEST_SAVE_TAB_IDS` | Build EPUB from specific tab IDs, return base64 |

### `UI_*` messages (popup → background)
Used by the popup UI. Both protocols require `isTrustedSender()` (same extension origin).

| Message | Purpose |
|---|---|
| `UI_GET_SETTINGS` | Return current settings |
| `UI_SET_KINDLE_EMAIL` | Set or clear Kindle email (validates format) |
| `UI_SET_EMAIL_TO_KINDLE` | Toggle email-to-Kindle preference (syncs context menu checkbox) |
| `UI_SET_DEFAULT_DOWNLOADS` | Toggle "Use Downloads" mode |
| `UI_CLEAR_DIRECTORY` | Clear stored directory handle and reset to Save As mode |
| `UI_BUILD_EPUB` | Build output files for selected tabs and return `files[]` payload (EPUB and/or PDFs) for popup-side File System Access writes |
| `UI_SAVE_TAB_IDS` | Build output files and save via background (`chrome.downloads` or stored directory handle fallback) |

## Output folder modes

Three modes, managed via popup:

1. **File System Access API** — user picks a folder via `showDirectoryPicker()`. Handle stored in IndexedDB. Popup writes directly via `writeFile()`. Background also tries stored handle for context menu saves.
2. **Use Downloads** — `chrome.downloads.download({ saveAs: false })`. Silent save to Chrome's default download location.
3. **Save As** (default) — `chrome.downloads.download({ saveAs: true })`. Shows Save As dialog each time.

## Extraction pipeline

1. **Pre-clean** (`extractor-readability.ts`): removes obvious boilerplate before Readability runs.
2. **Readability parse** on a cloned DOM.
3. **Post-clean** (`content-extract.ts`): removes residual boilerplate and link-heavy blocks, serializes XHTML.
4. **Image embedding** (`image-assets.ts`): `collectImages` tokenizes image `src` URLs; background fetches images and replaces tokens with embedded assets.

Heuristics are intentionally conservative:
- Boilerplate detection uses tag name, `role`, `aria-label`, `id`, `class`, and `data-uri`.
- Link-density pruning targets nav/recirc blocks and ranked headline lists.

## Email delivery

- Uses `chrome.identity.getAuthToken` for OAuth (Gmail send scope).
- Builds MIME multipart messages with one or more base64-encoded attachments (EPUB/PDF).
- The encoded message is base64url-encoded for the Gmail API `/messages/send` endpoint.
- Pre-send size check: rejects if the encoded payload exceeds Gmail's 35 MB API limit (~20 MB raw attachment).
- Auth retry: on 401/403, clears cached token and retries with a fresh one.
- PDF batching: PDFs are grouped into message batches (`splitAttachmentsForKindle`) by attachment count and total raw bytes to stay under Gmail/API limits.
- UI behavior: when output generation succeeds but email fails, save/download still proceeds and UI handlers return a warning string.
- Oversized attachments: if a file is too large for Gmail/Kindle email, it is not emailed, is renamed with a `TOO LARGE FOR EMAIL ` prefix before save, and the popup shows an alert listing affected filenames.

## PDF handling flow

1. **Tab classification** (`background.ts` + `pdf.ts`): selected tabs are split into article tabs and PDF tabs.
   - Non-obvious wrapper pages are probed via `pdf-dom-discovery.ts`; top candidates are validated with `detectPdfTab` before classifying as PDF.
2. **Article tabs**: run standard extraction + image embedding + EPUB build.
3. **PDF tabs**: fetch source bytes directly, validate PDF signature, and generate sanitized per-tab `.pdf` filenames.
4. **Output assembly**: mixed selections return/save both EPUB and PDF artifacts in one operation.
5. **Kindle email behavior**: EPUB is sent as a single attachment message; PDFs are bundled into one or more multi-attachment messages.

## Build system

- `npm run build` — runs `tsc -p tsconfig.json`, copies manifest, HTML, vendor JS, and icons to `dist/`.
- `npm run dev` — watch mode with auto-copy of static files.
- `npm run vendorize` — fetches Mozilla Readability into `src/extension/vendor/readability.js`.
- TypeScript config: `module: "ES2022"`, `target: "ES2021"`, `strict: true`.
- Files with `import type` compile with `export {};` — these **must** use `<script type="module">` or JS silently fails.

## Testing

- **Unit tests** (`npm test`): `tests/*.test.ts` — EPUB structure, ZIP format, multi-attachment email MIME building, directory handle IndexedDB, PDF detection/naming, Kindle attachment batching, and oversized-email artifact prefixing/handling.
- **Coverage** (`npm run test:coverage`): c8 with 80% threshold.
- **E2E** (`npm run test:e2e`): Playwright with Chromium. Two spec files:
  - `tabstoepub.spec.ts` — extraction, image embedding, TOC, boilerplate stripping.
  - `ui-handlers.spec.ts` — all `UI_*` message handlers (settings, kindle email, directory, build outputs), including PDF-only and mixed HTML+PDF scenarios.
- **Live-site E2E** (optional): set `REAL_WEB_URLS=url1,url2` before `npm run test:e2e`.
- **Lint**: `npm run lint` (ESLint, zero warnings).
- **Typecheck**: `npm run typecheck` (tsc --noEmit).
- **Pre-commit hook** (husky): runs lint, unit tests, coverage, and e2e before every commit.

## Debugging

- Load `dist/` via `chrome://extensions` (Developer mode).
- Service worker logs: click the extension's "service worker" link in chrome://extensions.
- For repeatable local runs, use `test.html` + `TEST_*` messages rather than UI clicks.

## Key gotchas

- `window.prompt()` is silently blocked in Chrome extension popups — use inline UI instead.
- `document.querySelectorAll('button')` in `setBusy()` disables ALL buttons including dynamically-shown ones — call `setBusy(false)` before showing inline forms.
- Chrome blocks `showDirectoryPicker()` on top-level system directories (Downloads, Desktop). The extension catches `SecurityError` and suggests creating a sub-folder.
- The manifest `key` field ensures a stable extension ID across installs. Changing it breaks the OAuth client binding.
