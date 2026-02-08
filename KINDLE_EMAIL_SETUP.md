# Tabs to EPUB & Kindle: Kindle Email Delivery Setup

## Problem

You want the extension to send generated output files (EPUB and/or PDFs) directly to your Kindle import email.

The extension can authenticate a Google user with `chrome.identity`, but it **cannot** create Google OAuth app credentials by itself.  
It needs a pre-created OAuth `client_id` in `manifest.json` before Gmail API login/send can work.

## Current state in this repo

- A stable extension key is already set in `manifest.json`.
- Expected extension ID: `kiagfpdlfniijbekdoahibjhgnbefkjg`
- Gmail scope is configured: `https://www.googleapis.com/auth/gmail.send`
- Placeholder OAuth client ID still needs to be replaced:
  - `manifest.json` -> `oauth2.client_id`

## Solution overview

1. Create Google OAuth credentials for this extension ID.
2. Put the generated OAuth `client_id` into `manifest.json`.
3. Rebuild/reload extension.
4. Configure Amazon Kindle Personal Document settings.
5. Set Kindle email in popup, enable `Email to Kindle`, then save tabs.

## Step-by-step

1. Confirm extension ID in Chrome
   - URL: `chrome://extensions`
   - Confirm unpacked extension ID is `kiagfpdlfniijbekdoahibjhgnbefkjg`.

2. Create/select Google Cloud project
   - URL: `https://console.cloud.google.com/projectcreate`

3. Enable Gmail API
   - URL: `https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com`

4. Configure OAuth consent screen
   - Branding URL: `https://console.cloud.google.com/auth/branding`
   - Audience URL: `https://console.cloud.google.com/auth/audience`
   - Scopes URL: `https://console.cloud.google.com/auth/scopes`
   - Add scope: `https://www.googleapis.com/auth/gmail.send`
   - For personal testing, add your own Gmail account as a test user (if needed).

5. Create OAuth client for Chrome Extension
   - URL: `https://console.cloud.google.com/auth/clients`
   - App type: `Chrome Extension`
   - Item ID / Extension ID: `kiagfpdlfniijbekdoahibjhgnbefkjg`
   - Copy generated client ID (`...apps.googleusercontent.com`)

6. Update local manifest
   - File: `manifest.json`
   - Set `oauth2.client_id` to your generated client ID.

7. Rebuild and reload extension
   - Command: `npm run build`
   - Reload in: `chrome://extensions`

8. Configure Amazon Kindle document delivery (amazon.com URLs)
   - Devices & Content: `https://www.amazon.com/hz/mycd/myx`
   - Personal Document Settings deep link: `https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc`
   - Help: add approved sender list: `https://www.amazon.com/gp/help/customer/display.html?nodeId=GX9XLEVV8G4DB28H`
   - Help: email limits/details: `https://www.amazon.com/gp/help/customer/display.html?nodeId=G7NECT4B4ZWHQ8WV`
   - Help: Send to Kindle overview: `https://www.amazon.com/gp/help/customer/display.html?nodeId=G5WYD9SAF7PGXRNA`
   - Web upload page: `https://www.amazon.com/sendtokindle`

9. Extension runtime setup
   - Open popup.
   - Click `Set Kindle email address`.
   - Enable `Email to Kindle`.
   - Click `Save tab(s) to EPUB` or `Save tab(s) to EPUB and close`.
   - Approve Google OAuth prompt on first use.

## Troubleshooting

- Error: `Kindle email is not set`
  - Set it in popup via `Set Kindle email address`.

- Error: Gmail auth/token issues
  - Confirm `manifest.json` has your real OAuth client ID.
  - Confirm extension ID in Google OAuth client matches `kiagfpdlfniijbekdoahibjhgnbefkjg`.
  - Reload extension after manifest changes.

- Email accepted by Gmail but not delivered to Kindle
  - Make sure sender Gmail is on Amazon approved senders list.
  - Confirm Kindle address is correct (`@kindle.com` or region variant shown in your account).
  - Check attachment size limits in Amazon help.

- Some files are not emailed and are renamed with `TOO LARGE FOR EMAIL `
  - This means the file exceeded Gmail API size limits after encoding.
  - The file is still saved locally and shown in popup warning/alert.

## Why the stable manifest key matters

Without a stable `manifest.key`, unpacked extension IDs can change.  
If the ID changes, the OAuth credential bound to the old ID stops matching, and Gmail auth fails.
