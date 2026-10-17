// ==UserScript==
// @name         Reddit Gallery Originals
// @namespace    https://github.com/508-dev/bigredditgallery
// @version      0.2.0
// @description  Fit original Reddit gallery images to the screen on classic and modern Reddit.
// @match        https://www.reddit.com/r/*/comments/*
// @match        https://reddit.com/r/*/comments/*
// @match        https://old.reddit.com/r/*/comments/*
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
  const upgradedImages = new Set();

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
    const previous = upgraded.get(img);
    if (previous?.original === preview) {
      previous.suppress();
      previous.fit();
      return;
    }
    previous?.restore();
    const original = preview && originalUrl(preview);
    if (!original || failed.get(img) === preview) return;

    const responsive = {
      srcset: img.getAttribute('srcset'),
      sizes: img.getAttribute('sizes'),
      sources: new Map(),
    };
    const styles = new Map();
    let ready = false;

    function setStyle(element, property, value) {
      if (!styles.has(element)) styles.set(element, new Map());
      const saved = styles.get(element);
      if (!saved.has(property)) saved.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
      // Avoid generating a MutationObserver loop from our own layout updates.
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') {
        element.style.setProperty(property, value, 'important');
      }
    }

    function fit() {
      if (!ready || !img.naturalWidth || !img.naturalHeight) return;
      const slide = img.closest('.gallery-preview');
      if (slide) setStyle(slide, 'max-width', 'none');
      const left = Math.max(0, img.getBoundingClientRect().left);
      const scale = Math.min(1,
        Math.max(1, innerWidth - left - 24) / img.naturalWidth,
        Math.max(1, innerHeight - 80) / img.naturalHeight);
      setStyle(img, 'width', `${Math.floor(img.naturalWidth * scale)}px`);
      setStyle(img, 'height', 'auto');
      setStyle(img, 'max-width', '100%');
      setStyle(img, 'max-height', `${Math.max(1, innerHeight - 80)}px`);
      setStyle(img, 'object-fit', 'contain');
    }

    function rememberResponsiveSources() {
      if (img.hasAttribute('srcset')) responsive.srcset = img.getAttribute('srcset');
      if (img.hasAttribute('sizes')) responsive.sizes = img.getAttribute('sizes');
      for (const source of img.closest('picture')?.querySelectorAll('source') || []) {
        if (source.hasAttribute('srcset')) responsive.sources.set(source, source.getAttribute('srcset'));
      }
    }

    function suppress() {
      rememberResponsiveSources();
      for (const source of responsive.sources.keys()) {
        if (source.hasAttribute('srcset')) source.removeAttribute('srcset');
      }
      if (img.hasAttribute('srcset')) img.removeAttribute('srcset');
      if (img.hasAttribute('sizes')) img.removeAttribute('sizes');
    }

    function detach() {
      img.removeEventListener('load', loaded);
      img.removeEventListener('error', failedLoad);
      upgraded.delete(img);
      upgradedImages.delete(img);
    }

    function restore(markFailed = false) {
      rememberResponsiveSources();
      const stillOriginal = img.getAttribute('src') === original;
      detach();
      for (const [element, properties] of styles) {
        for (const [property, saved] of properties) {
          if (saved.value) element.style.setProperty(property, saved.value, saved.priority);
          else element.style.removeProperty(property);
        }
      }
      if (stillOriginal) {
        if (markFailed) failed.set(img, preview);
        img.setAttribute('src', preview);
      }
      if (responsive.srcset === null) img.removeAttribute('srcset');
      else img.setAttribute('srcset', responsive.srcset);
      if (responsive.sizes === null) img.removeAttribute('sizes');
      else img.setAttribute('sizes', responsive.sizes);
      for (const [source, value] of responsive.sources) {
        source.setAttribute('srcset', value);
      }
    }

    function loaded() {
      img.removeEventListener('error', failedLoad);
      ready = true;
      fit();
    }

    function failedLoad() {
      restore(true);
    }

    img.addEventListener('load', loaded, { once: true });
    img.addEventListener('error', failedLoad, { once: true });
    upgraded.set(img, { original, restore, suppress, fit });
    upgradedImages.add(img);
    suppress();
    img.setAttribute('src', original);
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
    if (!postId) return null;
    // Classic Reddit uses a different post ID and switches slides without ?i=.
    const classicPost = document.getElementById(`thing_t3_${postId}`);
    if (classicPost) {
      return Array.from(classicPost.querySelectorAll('.gallery-preview img.preview'))
        .find(img => visibleArea(img) > 0) || null;
    }
    if (!inIndividualSlide()) return null;
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
      const img = activeImage();
      for (const previous of [...upgradedImages]) {
        if (previous !== img) upgraded.get(previous)?.restore();
      }
      if (img && visibleArea(img) > 0) upgrade(img);
    });
  }

  const gallerySelector = '.media-gallery, gallery-carousel, shreddit-gallery-carousel, shreddit-gallery, [role="dialog"]';
  new MutationObserver(records => {
    if (records.some(record =>
      !['class', 'style'].includes(record.attributeName) || record.target.closest?.(gallerySelector)
    )) scan();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'sizes', 'class', 'style'],
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
