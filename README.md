# Tampermonkey Scripts

## Reddit Gallery Originals

A Tampermonkey userscript that replaces Reddit gallery previews with their original `i.redd.it` files and fits them to the available screen space. Images keep their aspect ratio and never exceed their original dimensions. If an original cannot load, the preview is restored.

Supports classic Reddit on `old.reddit.com` and on `www.reddit.com` when your account uses the classic layout, plus modern Reddit's individual slide view (`?i=0`, `?i=1`, etc.). Next/Previous navigation and window resizing are handled automatically. Classic grid thumbnails are left alone.

### Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Install [reddit-gallery-originals.user.js](https://raw.githubusercontent.com/508-dev/tampermonkey-scripts/main/reddit-gallery-originals.user.js) in Tampermonkey, or create a new userscript and paste in the [source](reddit-gallery-originals.user.js).
3. Open a Reddit gallery post and select an individual slide. Try [classic Reddit](https://old.reddit.com/r/wallstreetbets/comments/1x7chad/16000000_on_amd_and_soxl_sold_it_all/) or [www.reddit.com](https://www.reddit.com/r/wallstreetbets/comments/1x7chad/16000000_on_amd_and_soxl_sold_it_all/). Modern Reddit uses `?i=0` in the URL; classic Reddit does not need it.

The userscript includes update and download URLs for the public `main` branch. Tampermonkey can check for updates after the script is merged there. The original `@namespace` remains unchanged so existing installations retain the same script identity.

No browser extension project or build step is needed. The script runs only on Reddit post pages and changes the visible gallery slide. Returning to the classic grid or leaving modern slide mode restores the preview and its layout. Reddit can change its page markup; if the slide stops using a normal image element or the original CDN URL changes, the script will need an update.

Run the local checks with `node reddit-gallery-originals.test.js` and `node --check reddit-gallery-originals.user.js`.
