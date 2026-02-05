# Tabs to EPUB

Chrome extension that saves one or more open tabs as a Kindle‑friendly EPUB (clean reading view, no interactive elements). Multiple tabs become chapters with a simple table of contents.

## Install

1. Install dependencies and build:

```sh
npm install
npm run vendorize
npm run build
```

2. Load the extension:

- Open `chrome://extensions` and enable **Developer mode**.
- Click **Load unpacked** and choose `dist`.

## Usage

Right‑click inside a page (or right‑click the extension toolbar icon) and choose **Tabs to EPUB**:

- **Save tab(s) to EPUB**: saves the highlighted tabs (or just the clicked tab).
- **Save tab(s) to EPUB and close**: same, then closes the tabs.
- **Add tab(s) to EPUB queue**: collect tabs for later.
- **Save queued tabs to EPUB**: builds one EPUB from queued tabs.
- **Clear EPUB queue**: clears the queue.
- **Change output folder (prompt next save)**: resets output directory so the next save asks again.

You can also click the extension toolbar icon to open a popup with the same actions.

### Output folder behavior

On the first save, Chrome shows a save dialog. The extension remembers that folder and tries to reuse it on subsequent saves. If Chrome rejects the path (e.g., outside the default downloads folder), it will prompt again and update the stored folder.

### File naming

Saved files use a timestamp plus the unique domains in the selected tabs, for example:

`2026-02-04T20_34_11 nytimes cnn wikipedia.epub`

## Notes

- Images referenced in the extracted content are downloaded and embedded into the EPUB when possible. If an image fetch fails (CORS, auth, or blocked), the HTML will fall back to the original remote URL.
- Mozilla Readability powers the extraction, so quality can vary by site.
