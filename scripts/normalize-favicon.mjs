/**
 * Favicons should be square. Wide images get letterboxed in the tab;
 * browsers often show black bars. This script centers the artwork on a
 * square canvas with a matching deep-blue background and outputs true PNG.
 */
import sharp from 'sharp';
import { unlinkSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const inputPath = join(root, 'public', 'favicon.png');
const tmpPath = join(root, 'public', '_favicon_tmp.png');

const SIZE = 512;
/** Letterbox / flatten background (deep blue, close to typical icon sky) */
const BG = { r: 14, g: 52, b: 112 };

await sharp(inputPath)
  .rotate()
  .resize(SIZE, SIZE, {
    fit: 'contain',
    background: BG,
    position: 'centre',
  })
  .flatten({ background: BG })
  .png({ compressionLevel: 9 })
  .toFile(tmpPath);

unlinkSync(inputPath);
renameSync(tmpPath, inputPath);

const meta = await sharp(inputPath).metadata();
console.log(`Wrote square favicon ${meta.width}x${meta.height} (${meta.format}).`);
