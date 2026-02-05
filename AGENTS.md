# AGENTS.md

Project intent: Chrome extension that turns one or more open tabs into a Kindle‑friendly EPUB. Multiple tabs become chapters with a simple TOC.

## How it works (high‑level)
- **Background service worker** (`src/extension/background.ts`): entry point. Injects content scripts, extracts articles, embeds images, builds EPUB, downloads file, manages queue.
- **Content extraction** (`src/extension/content-extract.ts`): sanitizes HTML, collects images, and serializes valid XHTML.
- **Extractor** (`src/extension/extractor-readability.ts`): runs Mozilla Readability on a cloned document with pre‑cleaning heuristics.
- **EPUB builder** (`src/core/epub.ts`): assembles XHTML + assets into a ZIP (EPUB) with TOC + metadata.
- **Popup UI** (`src/extension/popup.html`, `src/extension/popup.ts`): toolbar popup that triggers background actions.

## Build / vendorize
- `npm install`
- `npm run vendorize` to replace the placeholder Readability in `src/extension/vendor/readability.js` with the real Mozilla Readability implementation.
- `npm run build` compiles TypeScript into `dist/` (extension root). Reload the unpacked extension after rebuilds.
- `npm run dev` runs the TypeScript watch build and copies static files into `dist/` so you only need to reload the extension.

## Testing / harness
- Unit tests: `npm test` (validates core ZIP/EPUB structure).
- Coverage: `npm run test:coverage` (writes `coverage/`).
- E2E: `npm run test:e2e` (Playwright, uses system Chrome).
- Optional live-site E2E: set `REAL_WEB_URLS` (comma-separated) before running `npm run test:e2e`.
- Test harness page: `dist/extension/test.html` exposes `window.TabToEpubTest.send(...)` which speaks to background via `TEST_*` messages.
  - Useful messages: `TEST_SET_MODE`, `TEST_LIST_TABS`, `TEST_SAVE_TAB_IDS`, `TEST_SAVE_ACTIVE_TAB`, `TEST_GET_QUEUE`, `TEST_CLEAR_QUEUE`.
- Linting: `npm run lint` (ESLint recommended rules + max-lines).
- Typecheck: `npm run typecheck` (tsc --noEmit).

## Extraction pipeline (details)
1. **Pre‑clean (Readability)**: `extractor-readability.ts` removes obvious boilerplate before Readability runs.
2. **Readability parse** on a cloned DOM.
3. **Post‑clean**: `content-extract.ts` removes boilerplate and link‑heavy blocks, then serializes XHTML.
4. **Image embedding**: `collectImages` tokenizes image `src` URLs for embedding; background replaces tokens with downloaded assets.

Heuristics are intentionally conservative but can be tuned:
- Boilerplate detection uses tag name, `role`, `aria-label`, `id`, `class`, and `data-uri`.
- Link‑density pruning targets nav/recirc blocks and ranked headline lists.

## Output naming
- EPUB filenames are generated as `YYYY-MM-DDTHH_MM_SS <domain list>.epub` using unique domain labels from the selected tabs.

## Debugging
- Load `dist/` via `chrome://extensions` (Developer mode).
- Service worker logs are under the extension’s “service worker” link.
- For repeatable local runs, use `test.html` + `TEST_*` messages rather than UI clicks.

## Notes / future improvements
- If Readability continues to miss/over‑include content on some sites, consider switching to **DOM Distiller** (Chromium’s reader mode extractor). This is likely a more Chrome‑aligned long‑term path.
- Keep README user‑facing; dev/test/internal details belong here.
