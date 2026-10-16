// ==UserScript==
// @name         Reddit Gallery Originals
// @namespace    https://github.com/508-dev/bigredditgallery
// @version      0.1.1
// @description  Show original Reddit images in individual gallery slides.
// @match        https://www.reddit.com/r/*/comments/*
// @match        https://reddit.com/r/*/comments/*
// @homepageURL  https://github.com/508-dev/tampermonkey-scripts
// @updateURL    https://raw.githubusercontent.com/508-dev/tampermonkey-scripts/main/reddit-gallery-originals.user.js
// @downloadURL  https://raw.githubusercontent.com/508-dev/tampermonkey-scripts/main/reddit-gallery-originals.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const failed = new WeakMap();
  const upgraded = new WeakMap();

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
    if (upgraded.get(img) === preview) {
      suppressResponsiveSources(img);
      return;
    }
    const original = preview && originalUrl(preview);
    if (!original || failed.get(img) === preview) return;

    const sources = Array.from(img.closest('picture')?.querySelectorAll('source') || []);
    const saved = sources.map(source => [source, source.getAttribute('srcset')]);
    const srcset = img.getAttribute('srcset');
    const sizes = img.getAttribute('sizes');

    function restore() {
      upgraded.delete(img);
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
    upgraded.set(img, original);
    suppressResponsiveSources(img);
    img.removeAttribute('sizes');
    img.setAttribute('src', original);
  }

  function suppressResponsiveSources(img) {
    for (const source of img.closest('picture')?.querySelectorAll('source') || []) {
      if (source.hasAttribute('srcset')) source.removeAttribute('srcset');
    }
    if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
  }

  function visibleArea(img) {
    if (img.checkVisibility && !img.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return 0;
    const rect = img.getBoundingClientRect();
    const frame = img.closest('gallery-carousel, shreddit-gallery-carousel, shreddit-gallery, [role="dialog"]')?.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, frame?.right ?? innerWidth, innerWidth) - Math.max(rect.left, frame?.left ?? 0, 0));
    const height = Math.max(0, Math.min(rect.bottom, frame?.bottom ?? innerHeight, innerHeight) - Math.max(rect.top, frame?.top ?? 0, 0));
    return width * height;
  }

  function activeImage() {
    const postId = location.pathname.match(/^\/r\/[^/]+\/comments\/([^/]+)/)?.[1];
    const post = document.getElementById(`t3_${postId}`);
    const dialogImages = Array.from(document.querySelectorAll('[role="dialog"] img[src*="redd.it"]'));
    const images = dialogImages.some(img => visibleArea(img) > 0)
      ? dialogImages
      : Array.from(post?.querySelectorAll('img[src*="redd.it"]') || []);

    return images.reduce((best, img) => !best || visibleArea(img) > visibleArea(best) ? img : best, null);
  }

  let queued = false;
  function scan() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!inIndividualSlide()) return;
      const img = activeImage();
      if (img && visibleArea(img) > 0) upgrade(img);
    });
  }

  const gallerySelector = 'gallery-carousel, shreddit-gallery-carousel, shreddit-gallery, [role="dialog"]';
  new MutationObserver(records => {
    if (records.some(record =>
      !['class', 'style'].includes(record.attributeName) || record.target.closest?.(gallerySelector)
    )) scan();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'class', 'style'],
  });

  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = Reflect.apply(original, this, args);
      scan();
      requestAnimationFrame(scan);
      return result;
    };
  }

  addEventListener('popstate', scan);
  addEventListener('scroll', scan, { passive: true });
  document.addEventListener('scroll', scan, { capture: true, passive: true });
  addEventListener('resize', scan);
  scan();
})();
