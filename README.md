# Tabs to EPUB & Kindle

Chrome extension that saves one or more open tabs as a Kindle‑friendly EPUB (clean reading view, no interactive elements). Multiple tabs become chapters with a simple table of contents.

Kindle email delivery setup guide: `KINDLE_EMAIL_SETUP.md`

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

Right‑click inside a page (or right‑click the extension toolbar icon) and choose **Tabs to EPUB & Kindle**:

- **Save tab(s) to EPUB**: saves the highlighted tabs (or just the clicked tab).
- **Save tab(s) to EPUB and email to Kindle**: sends the EPUB via Gmail API, then also downloads it locally.
- **Save tab(s) to EPUB and close**: same, then closes the tabs.

The popup provides the same save actions plus an **Email to Kindle** checkbox. It also lets you configure the output folder and Kindle email address.

### Kindle email setup (Gmail)

Email delivery uses `chrome.identity` + Gmail API and requires your own OAuth client.

1. Create a Google OAuth client for a Chrome Extension in Google Cloud.
2. Set `manifest.json` `oauth2.client_id` to your client id.
3. Reload the unpacked extension after rebuild.
4. In the popup, click **Set Kindle email address** and enter your Kindle import email.
5. Add the Gmail sender address to Amazon's approved senders list for your Kindle account.

### Output folder behavior

The popup offers three output modes:

- **Choose Folder**: pick a specific directory via the OS folder picker. EPUBs are written directly (no Save As dialog). Note: Chrome blocks selecting top-level system directories like Downloads or Desktop — pick or create a sub-folder instead (e.g. `Downloads/EPUB`).
- **Use Downloads**: saves to Chrome's default download location silently (no dialog).
- **Clear**: resets to no preference, so each save shows a Save As dialog.

### File naming

Saved files use a timestamp plus the unique domains in the selected tabs, for example:

`2026-02-04T20_34_11 nytimes cnn wikipedia.epub`

## Notes

- Images referenced in the extracted content are downloaded and embedded into the EPUB when possible. If an image fetch fails (CORS, auth, or blocked), the HTML will fall back to the original remote URL.
- Mozilla Readability powers the extraction, so quality can vary by site.
