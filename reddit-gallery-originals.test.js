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

function harness(search = '?i=0', src = preview, extras = []) {
  const primary = makeImage(src);
  let mutation;
  const frames = [];
  const documentListeners = new Map();
  const location = { href: `https://www.reddit.com/r/test/comments/abc/post/${search}`, pathname: '/r/test/comments/abc/post/', search };
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
    getElementById: id => id === 't3_abc' ? { querySelectorAll: () => [primary.img, ...extras.map(extra => extra.img)] } : null,
    querySelectorAll: () => [],
    addEventListener: (event, fn) => documentListeners.set(event, fn),
  };
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe() {}
  }
  vm.runInNewContext(script, { URL, URLSearchParams, WeakMap, MutationObserver, location, history, document, queueMicrotask, requestAnimationFrame: fn => frames.push(fn), addEventListener() {}, innerWidth: 1000, innerHeight: 800 });
  return {
    ...primary,
    location,
    history,
    documentListeners,
    mutate: (records = [{ type: 'childList', target: document.documentElement }]) => mutation(records),
    frame: () => frames.shift()?.(),
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

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
  page.history.replaceState({}, '', '/r/test/comments/abc/post/');
  await flush();
  assert.equal(page.img.getAttribute('src'), changed);
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
