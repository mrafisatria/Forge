import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);

test('favicon contains valid 16, 32, and 48 pixel PNG frames', async () => {
  const ico = await readFile(new URL('app/favicon.ico', root));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  let expectedOffset = 54;
  for (const [index, size] of [16, 32, 48].entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry], size);
    assert.equal(ico[entry + 1], size);
    assert.equal(ico.readUInt16LE(entry + 4), 1);
    assert.equal(ico.readUInt16LE(entry + 6), 32);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.equal(offset, expectedOffset);
    const metadata = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    expectedOffset += length;
  }
  assert.equal(expectedOffset, ico.length);
});

test('Apple icon and Vercel avatar have the expected square dimensions', async () => {
  for (const [path, size] of [['app/apple-icon.png', 180], ['public/forge-logo.png', 512]]) {
    const metadata = await sharp(await readFile(new URL(path, root))).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
  }
});
