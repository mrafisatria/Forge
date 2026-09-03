import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

// Keep every exported icon in sync with the existing Forge vector logo.
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('public/favicon.svg', root));
const render = (size) => sharp(source, { density: 768 }).resize(size, size).png().toBuffer();
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(render));
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2); // ICO image type.
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
for (let index = 0; index < sizes.length; index++) {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(frames[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += frames[index].length;
}

await Promise.all([
  writeFile(new URL('app/favicon.ico', root), Buffer.concat([directory, ...frames])),
  writeFile(new URL('app/apple-icon.png', root), await render(180)),
  writeFile(new URL('public/forge-logo.png', root), await render(512)),
]);
console.log('Generated Forge favicon, Apple icon, and project avatar from public/favicon.svg.');
