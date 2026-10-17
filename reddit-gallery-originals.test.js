const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync('reddit-gallery-originals.user.js', 'utf8');
const preview = 'https://preview.redd.it/example.png?width=640&auto=webp';
const original = 'https://i.redd.it/example.png';

function makeImage(src = preview, rect = { left: 0, top: 0, right: 600, bottom: 600 }) {
  const attributes = new Map([['src', src], ['srcset', `${src} 1x`]]);
  const listeners = new Map();
  const img = {
    style: makeStyle(),
    naturalWidth: 1600,
    naturalHeight: 900,
    complete: false,
    closest: () => null,
    getBoundingClientRect: () => rect,
    getAttribute: key => attributes.get(key) ?? null,
    hasAttribute: key => attributes.has(key),
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event, fn) => {
      if (listeners.get(event) === fn) listeners.delete(event);
    },
  };
  return { img, attributes, listeners };
}

function makeStyle(initial = {}) {
  const values = new Map(Object.entries(initial));
  const priorities = new Map();
  return {
    getPropertyValue: key => values.get(key) || '',
    getPropertyPriority: key => priorities.get(key) || '',
    setProperty(key, value, priority = '') { values.set(key, value); priorities.set(key, priority); },
    removeProperty(key) { values.delete(key); priorities.delete(key); },
  };
}

function harness(search = '?i=0', src = preview, extras = [], { legacy = false, hostname = 'www.reddit.com' } = {}) {
  const primary = makeImage(src);
  const gallery = { style: makeStyle({ 'max-width': '849px' }) };
  const post = { querySelectorAll: selector => legacy && !selector.includes('.gallery-preview') ? [] : [primary.img, ...extras.map(extra => extra.img)] };
  if (legacy) primary.img.closest = selector => selector.includes('.gallery-preview') ? gallery : null;
  let mutation;
  const frames = [];
  const documentListeners = new Map();
  const location = { href: `https://${hostname}/r/test/comments/abc/post/${search}`, pathname: '/r/test/comments/abc/post/', search };
  function updateLocation(url) {
    const next = new URL(url, location.href);
    location.href = next.href;
    location.pathname = next.pathname;
    location.search = next.search;
  }
  const history = {
    calls: [],
    pushState(...args) {
      this.calls.push(['pushState', ...args]);
      updateLocation(args[2]);
      return 'push result';
    },
    replaceState(...args) {
      this.calls.push(['replaceState', ...args]);
      updateLocation(args[2]);
      return 'replace result';
    },
  };
  const document = {
    documentElement: {},
    getElementById: id => id === (legacy ? 'thing_t3_abc' : 't3_abc') ? post : null,
    querySelectorAll: () => [],
    addEventListener: (event, fn) => documentListeners.set(event, fn),
  };
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe() {}
  }
  const windowListeners = new Map();
  const context = { URL, URLSearchParams, WeakMap, MutationObserver, location, history, document, queueMicrotask, requestAnimationFrame: fn => frames.push(fn), addEventListener: (event, fn) => windowListeners.set(event, fn), innerWidth: 1000, innerHeight: 800 };
  vm.runInNewContext(script, context);
  return {
    ...primary,
    location,
    history,
    documentListeners,
    gallery,
    context,
    windowListeners,
    mutate: (records = [{ type: 'childList', target: document.documentElement }]) => mutation(records),
    frame: () => frames.shift()?.(),
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const hostname of ['www.reddit.com', 'old.reddit.com']) {
  test(`upgrades classic Reddit slides without ?i= on ${hostname}`, async () => {
    const page = harness('', preview, [], { legacy: true, hostname });
    await flush();
    assert.equal(page.img.getAttribute('src'), original);
  });
}

test('matches old.reddit.com in userscript metadata', () => {
  assert.match(script, /\/\/ @match\s+https:\/\/old\.reddit\.com\/r\/\*\/comments\/\*/);
});

test('fits a loaded original to the viewport and removes the classic slide width cap', async () => {
  const page = harness('', preview, [], { legacy: true });
  await flush();
  page.img.complete = true;
  page.listeners.get('load')?.();
  assert.equal(page.img.style.getPropertyValue('width'), '976px');
  assert.equal(page.img.style.getPropertyValue('height'), 'auto');
  assert.equal(page.gallery.style.getPropertyValue('max-width'), 'none');
});

test('caps a tall image by viewport height and recalculates on resize', async () => {
  const page = harness();
  await flush();
  page.img.naturalWidth = 1200;
  page.img.naturalHeight = 2400;
  page.img.complete = true;
  page.listeners.get('load')();
  assert.equal(page.img.style.getPropertyValue('width'), '360px');
  page.context.innerHeight = 600;
  page.windowListeners.get('resize')();
  await flush();
  assert.equal(page.img.style.getPropertyValue('width'), '260px');
});

test('never enlarges an image beyond its original dimensions', async () => {
  const page = harness();
  await flush();
  page.img.naturalWidth = 300;
  page.img.naturalHeight = 200;
  page.img.complete = true;
  page.listeners.get('load')();
  assert.equal(page.img.style.getPropertyValue('width'), '300px');
});

test('returning to the classic grid restores image styles and original slide width cap', async () => {
  const page = harness('', preview, [], { legacy: true });
  await flush();
  page.img.complete = true;
  page.listeners.get('load')?.();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(page.gallery.style.getPropertyValue('max-width'), 'none');
  page.img.checkVisibility = () => false;
  page.mutate([{ attributeName: 'style', target: { closest: () => page.gallery } }]);
  await flush();
  assert.equal(page.img.getAttribute('src'), preview);
  assert.equal(page.img.style.getPropertyValue('width'), '');
  assert.equal(page.gallery.style.getPropertyValue('max-width'), '849px');
});

test('classic Next/Previous works without URL changes and restores hidden slides', async () => {
  const nextPreview = 'https://preview.redd.it/next.png?width=640';
  const next = makeImage(nextPreview);
  next.img.checkVisibility = () => false;
  const page = harness('', preview, [next], { legacy: true, hostname: 'old.reddit.com' });
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(next.img.getAttribute('src'), nextPreview);

  page.img.checkVisibility = () => false;
  next.img.checkVisibility = () => true;
  page.mutate([{ attributeName: 'style', target: { closest: () => page.gallery } }]);
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
  assert.equal(page.img.getAttribute('src'), preview);

  page.img.checkVisibility = () => true;
  next.img.checkVisibility = () => false;
  page.mutate([{ attributeName: 'style', target: { closest: () => page.gallery } }]);
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(next.img.getAttribute('src'), nextPreview);
  assert.equal(page.location.search, '');
});

test('does not resize using the preview dimensions before the original loads', async () => {
  const page = harness();
  await flush();
  assert.equal(page.img.style.getPropertyValue('width'), '');
  page.mutate();
  await flush();
  assert.equal(page.img.style.getPropertyValue('width'), '');
});

test('upgrades an individual slide to the original file', async () => {
  const page = harness();
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(page.img.getAttribute('srcset'), null);
  page.listeners.get('load')();
  assert.equal(page.listeners.has('error'), false);
});

test('does not change a post outside the individual slide view', async () => {
  const page = harness('');
  await flush();
  assert.equal(page.img.getAttribute('src'), preview);
});

test('restores the preview after an original fails', async () => {
  const page = harness();
  await flush();
  page.listeners.get('error')();
  assert.equal(page.img.getAttribute('src'), preview);
  assert.equal(page.img.getAttribute('srcset'), `${preview} 1x`);
  page.mutate();
  await flush();
  assert.equal(page.img.getAttribute('src'), preview);
});

test('upgrades a newly selected slide', async () => {
  const page = harness('');
  await flush();
  page.location.search = '?i=1';
  page.mutate();
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
});

test('ignores unrelated image hosts', async () => {
  const page = harness('?i=0', 'https://example.com/example.png');
  await flush();
  assert.equal(page.img.getAttribute('src'), 'https://example.com/example.png');
});

test('upgrades only the visible slide in the current post', async () => {
  const hidden = makeImage('https://preview.redd.it/hidden.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
  const page = harness('?i=0', preview, [hidden]);
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(hidden.img.getAttribute('src'), 'https://preview.redd.it/hidden.png?width=640');
});

test('upgrades the next slide after navigation makes it visible', async () => {
  const next = makeImage('https://preview.redd.it/next.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
  const page = harness('?i=0', preview, [next]);
  await flush();
  page.img.getBoundingClientRect = () => ({ left: -1200, top: 0, right: -600, bottom: 600 });
  next.img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 600 });
  page.location.search = '?i=1';
  page.mutate();
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
});

for (const method of ['pushState', 'replaceState']) {
  test(`${method} rescans an already-mounted slide without a DOM mutation`, async () => {
    const next = makeImage('https://preview.redd.it/next.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
    const page = harness('?i=0', preview, [next]);
    await flush();

    const result = page.history[method]({ slide: 1 }, '', '?i=1');
    page.img.getBoundingClientRect = () => ({ left: -1200, top: 0, right: -600, bottom: 600 });
    next.img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 600 });
    await flush();

    assert.equal(result, method === 'pushState' ? 'push result' : 'replace result');
    assert.equal(page.location.search, '?i=1');
    assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
    assert.equal(page.history.calls[0][0], method);
  });
}

test('the next animation frame catches a slide activated after the history scan', async () => {
  const next = makeImage('https://preview.redd.it/next.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
  const page = harness('?i=0', preview, [next]);
  await flush();
  page.history.pushState({}, '', '?i=1');
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://preview.redd.it/next.png?width=640');

  page.img.getBoundingClientRect = () => ({ left: -1200, top: 0, right: -600, bottom: 600 });
  next.img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 600 });
  page.frame();
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
});

test('carousel style changes trigger a rescan', async () => {
  const next = makeImage('https://preview.redd.it/next.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
  const page = harness('?i=0', preview, [next]);
  await flush();
  page.img.getBoundingClientRect = () => ({ left: -1200, top: 0, right: -600, bottom: 600 });
  next.img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 600 });
  page.mutate([{ type: 'attributes', attributeName: 'style', target: { closest: () => ({}) } }]);
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
});

test('internal carousel scrolling triggers a rescan', async () => {
  const next = makeImage('https://preview.redd.it/next.png?width=640', { left: 1200, top: 0, right: 1800, bottom: 600 });
  const page = harness('?i=0', preview, [next]);
  await flush();
  page.img.getBoundingClientRect = () => ({ left: -1200, top: 0, right: -600, bottom: 600 });
  next.img.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 600 });
  page.documentListeners.get('scroll')();
  await flush();
  assert.equal(next.img.getAttribute('src'), 'https://i.redd.it/next.png');
});

test('leaving slide mode restores the preview and allows a later upgrade', async () => {
  const page = harness();
  await flush();
  assert.equal(page.img.getAttribute('src'), original);

  page.history.pushState({}, '', '/r/test/comments/abc/post/');
  await flush();
  assert.equal(page.img.getAttribute('src'), preview);
  assert.equal(page.img.getAttribute('srcset'), `${preview} 1x`);
  assert.equal(page.listeners.has('error'), false);

  page.history.pushState({}, '', '?i=0');
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
});

test('leaving slide mode does not overwrite an image Reddit already changed', async () => {
  const page = harness();
  await flush();
  const changed = 'https://preview.redd.it/different.png?width=640';
  page.img.setAttribute('src', changed);
  page.img.setAttribute('srcset', `${changed} 2x`);
  page.img.setAttribute('sizes', '80vw');
  page.history.replaceState({}, '', '/r/test/comments/abc/post/');
  await flush();
  assert.equal(page.img.getAttribute('src'), changed);
  assert.equal(page.img.getAttribute('srcset'), `${changed} 2x`);
  assert.equal(page.img.getAttribute('sizes'), '80vw');
});

test('suppresses responsive preview sources added after an upgrade', async () => {
  const page = harness();
  await flush();
  page.img.setAttribute('srcset', `${preview} 2x`);
  page.img.setAttribute('sizes', '100vw');
  page.mutate();
  await flush();
  assert.equal(page.img.getAttribute('src'), original);
  assert.equal(page.img.getAttribute('srcset'), null);
  assert.equal(page.img.getAttribute('sizes'), null);

  page.history.pushState({}, '', '/r/test/comments/abc/post/');
  await flush();
  assert.equal(page.img.getAttribute('srcset'), `${preview} 2x`);
  assert.equal(page.img.getAttribute('sizes'), '100vw');
});

test('suppresses picture sources added after an upgrade', async () => {
  const page = harness();
  const source = makeImage(preview);
  const sources = [source.img];
  page.img.closest = selector => selector === 'picture' ? { querySelectorAll: () => sources } : null;
  await flush();
  source.img.setAttribute('srcset', `${preview} 2x`);
  const added = makeImage('https://preview.redd.it/added.png?width=640');
  sources.push(added.img);
  page.mutate();
  await flush();
  assert.equal(source.img.getAttribute('srcset'), null);
  assert.equal(added.img.getAttribute('srcset'), null);

  page.history.replaceState({}, '', '/r/test/comments/abc/post/');
  await flush();
  assert.equal(source.img.getAttribute('srcset'), `${preview} 2x`);
  assert.equal(added.img.getAttribute('srcset'), 'https://preview.redd.it/added.png?width=640 1x');
});
