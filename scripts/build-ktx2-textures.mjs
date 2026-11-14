// Transcodes the WebP texture sources in art/world-textures to the GPU-compressed
// KTX2 files the game bundles from src/assets/world-textures.
//
//   npm i --no-save ktx2-encoder sharp
//   node scripts/build-ktx2-textures.mjs
//
// Normal maps use UASTC, which keeps both channels precise. Colour, packed
// ORM and height maps use ETC1S, which is far smaller on disk.
import { readdirSync, writeFileSync } from 'node:fs';
import { encodeToKTX2 } from 'ktx2-encoder';
import sharp from 'sharp';

const folder = new URL('../art/world-textures/', import.meta.url);
const output = new URL('../src/assets/world-textures/', import.meta.url);
const imageDecoder = async buffer => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};
const quiet = console.log;
for (const file of readdirSync(folder).filter(name => name.endsWith('.webp')).sort()) {
  const name = file.replace('.webp', '');
  // Block compression needs dimensions in multiples of four.
  const meta = await sharp(new URL(file, folder).pathname).metadata();
  const width = Math.round(meta.width / 4) * 4, height = Math.round(meta.height / 4) * 4;
  const png = await sharp(new URL(file, folder).pathname).resize(width, height, { fit: 'fill' }).png().toBuffer();
  const normal = name.endsWith('-normal');
  console.log = () => {};
  const encoded = await encodeToKTX2(new Uint8Array(png), {
    generateMipmap: true, imageDecoder, isYFlip: true,
    isSetKTX2SRGBTransferFunc: name.endsWith('-albedo'), isPerceptual: name.endsWith('-albedo'),
    ...(normal
      ? { isUASTC: true, isNormalMap: true, needSupercompression: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 1.5 }
      : { isUASTC: false, qualityLevel: 220, compressionLevel: 2 }),
  });
  console.log = quiet;
  writeFileSync(new URL(name + '.ktx2', output), encoded);
  console.log(`${name}: ${width}x${height}, ${(encoded.length / 1024).toFixed(0)} KB`);
}
