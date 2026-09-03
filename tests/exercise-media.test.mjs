import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Compile the client component in memory to check its accessible HTML without a browser.
const bundle = buildSync({
  entryPoints: ['components/exercise-media-button.tsx'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
});
const componentModule = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
  module: componentModule, exports: componentModule.exports,
  require: createRequire(import.meta.url), process: { env: {} },
});
const { ExerciseMediaButton, ExerciseMediaDialog } = componentModule.exports;
const props = { url: 'https://example.com/exercise.jpg', path: 'owner/library/exercise.jpg', name: 'Bench Press' };

test('exercise image exposes a keyboard-accessible popup trigger', () => {
  const html = renderToStaticMarkup(createElement(ExerciseMediaButton, props));
  assert.match(html, /<button[^>]+type="button"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-label="Perbesar gambar Bench Press"/);
  assert.match(html, /<img[^>]+alt="Bench Press"/);
  assert.doesNotMatch(html, /<dialog/);
});

test('exercise without media has no empty popup trigger', () => {
  const html = renderToStaticMarkup(createElement(ExerciseMediaButton, { ...props, url: null, path: null }));
  assert.doesNotMatch(html, /<button|<dialog/);
});

test('image popup has an accessible title, close button and full image', () => {
  const html = renderToStaticMarkup(createElement(ExerciseMediaDialog, { ...props, onClose() {} }));
  assert.match(html, /<dialog[^>]+aria-labelledby="[^"]+"/);
  assert.match(html, /<h2[^>]*>Bench Press<\/h2>/);
  assert.match(html, /aria-label="Tutup gambar atau video"/);
  assert.match(html, /<img[^>]+src="https:\/\/example.com\/exercise.jpg"/);
});

test('exercise videos use the same popup with inline playback controls', () => {
  const videoProps = { ...props, url: 'https://example.com/exercise.mp4', path: 'owner/library/exercise.mp4' };
  const trigger = renderToStaticMarkup(createElement(ExerciseMediaButton, videoProps));
  assert.match(trigger, /aria-label="Perbesar video Bench Press"/);
  const html = renderToStaticMarkup(createElement(ExerciseMediaDialog, { ...videoProps, onClose() {} }));
  assert.match(html, /<video[^>]+controls=""/);
  assert.match(html, /playsInline=""/);
  assert.doesNotMatch(html, /<img/);
});
