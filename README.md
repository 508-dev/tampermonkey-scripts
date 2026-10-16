# Tampermonkey Scripts

## Reddit Gallery Originals

A Tampermonkey userscript that replaces Reddit preview images with their original `i.redd.it` files in the individual gallery slide view (`?i=0`, `?i=1`, etc.). It also handles slides loaded after navigation. If an original cannot load, the preview is restored.

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Install [reddit-gallery-originals.user.js](https://raw.githubusercontent.com/508-dev/tampermonkey-scripts/main/reddit-gallery-originals.user.js) in Tampermonkey, or create a new userscript and paste in the [source](reddit-gallery-originals.user.js).
3. Open a Reddit gallery post, then select an individual slide. For example, open [this post](https://www.reddit.com/r/wallstreetbets/comments/1x7chad/16000000_on_amd_and_soxl_sold_it_all/) and select an image so the URL contains `?i=0`.

The userscript includes update and download URLs for the public `main` branch. Tampermonkey can check for updates after the script is merged there. The original `@namespace` remains unchanged so existing installations retain the same script identity.

No browser extension project or build step is needed. The script runs only on Reddit post pages and changes images only while an individual slide URL is active. Reddit can change its page markup; if the slide stops using a normal image element or the original CDN URL changes, the script will need an update.

Run the local checks with `node reddit-gallery-originals.test.js` and `node --check reddit-gallery-originals.user.js`.
