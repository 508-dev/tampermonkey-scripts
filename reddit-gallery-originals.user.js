// ==UserScript==
// @name         Reddit Gallery Originals
// @namespace    https://github.com/508-dev/bigredditgallery
// @version      0.1.0
// @description  Show original Reddit images in individual gallery slides.
// @match        https://www.reddit.com/r/*/comments/*
// @match        https://reddit.com/r/*/comments/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const failed = new WeakMap();

  function originalUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.hostname !== 'preview.redd.it' || !url.pathname.match(/\.(?:jpe?g|png|webp|gif|avif)$/i)) {
        return null;
      }
      return `https://i.redd.it${url.pathname}`;
    } catch {
      return null;
    }
  }

  function inIndividualSlide() {
    return /^\/r\/[^/]+\/comments\/[^/]+/.test(location.pathname) &&
      /^\d+$/.test(new URLSearchParams(location.search).get('i') || '');
  }

  function upgrade(img) {
    if (img.closest('shreddit-comment')) return;

    const preview = img.getAttribute('src');
    const original = preview && originalUrl(preview);
    if (!original || failed.get(img) === preview) return;

    const sources = Array.from(img.closest('picture')?.querySelectorAll('source') || []);
    const saved = sources.map(source => [source, source.getAttribute('srcset')]);
    const srcset = img.getAttribute('srcset');
    const sizes = img.getAttribute('sizes');

    function restore() {
      failed.set(img, preview);
      img.setAttribute('src', preview);
      if (srcset === null) img.removeAttribute('srcset');
      else img.setAttribute('srcset', srcset);
      if (sizes === null) img.removeAttribute('sizes');
      else img.setAttribute('sizes', sizes);
      for (const [source, value] of saved) {
        if (value === null) source.removeAttribute('srcset');
        else source.setAttribute('srcset', value);
      }
    }

    function loaded() {
      img.removeEventListener('error', failedLoad);
    }

    function failedLoad() {
      img.removeEventListener('load', loaded);
      restore();
    }

    img.addEventListener('load', loaded, { once: true });
    img.addEventListener('error', failedLoad, { once: true });
    for (const [source] of saved) source.removeAttribute('srcset');
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.setAttribute('src', original);
  }

  let queued = false;
  function scan() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!inIndividualSlide()) return;
      document.querySelectorAll('shreddit-post img[src*="preview.redd.it"], gallery-carousel img[src*="preview.redd.it"], shreddit-gallery img[src*="preview.redd.it"], [role="dialog"] img[src*="preview.redd.it"]').forEach(upgrade);
    });
  }

  new MutationObserver(scan).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });
  addEventListener('popstate', scan);
  scan();
})();
