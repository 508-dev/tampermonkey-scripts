const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync('reddit-gallery-originals.user.js', 'utf8');
const preview = 'https://preview.redd.it/example.png?width=640&auto=webp';
const original = 'https://i.redd.it/example.png';

function harness(search = '?i=0', src = preview) {
  const attributes = new Map([['src', src], ['srcset', `${preview} 1x`]]);
  const listeners = new Map();
  let mutation;
  const img = {
    closest: () => null,
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event, fn) => {
      if (listeners.get(event) === fn) listeners.delete(event);
    },
  };
  const location = { href: `https://www.reddit.com/r/test/comments/abc/post/${search}`, pathname: '/r/test/comments/abc/post/', search };
  const document = {
    documentElement: {},
    querySelectorAll: () => [img],
  };
  class MutationObserver {
    constructor(callback) { mutation = callback; }
    observe() {}
  }
  vm.runInNewContext(script, { URL, URLSearchParams, WeakMap, MutationObserver, location, document, queueMicrotask, addEventListener() {} });
  return { img, attributes, listeners, location, mutate: () => mutation() };
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
