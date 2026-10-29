import { PNG } from 'pngjs';
import { decode as jpeg } from 'jpeg-js';
import { inflateSync } from 'node:zlib';
import { textureSize, validateNinePatch, type NinePatchSpec, type AtlasRegion } from '../../domain/src/textures';
export interface Raster { width: number; height: number; data: Buffer }
export function decodeTexture(bytes: Uint8Array): Raster {
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('图片超过 8MiB 编辑预算');
  const input = Buffer.from(bytes);
  if (input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (input.length < 33 || input.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG 文件头无效');
    textureSize(input.readUInt32BE(16), input.readUInt32BE(20));
    // pngjs bounds non-interlaced inflation itself. Bound Adam7 streams before
    // its interlaced decoder, which otherwise uses an unlimited inflateSync.
    if (input[28] === 1) {
      const idat: Buffer[] = []; let offset = 8;
      while (offset + 12 <= input.length) { const size = input.readUInt32BE(offset); if (size > input.length - offset - 12) throw new Error('PNG 数据块截断'); if (input.toString('ascii', offset + 4, offset + 8) === 'IDAT') idat.push(input.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
      const width = input.readUInt32BE(16), height = input.readUInt32BE(20);
      inflateSync(Buffer.concat(idat), { maxOutputLength: width * height * 8 + height * 7 + 1024 });
    }
    const png = PNG.sync.read(input, { checkCRC: true }); return { width: png.width, height: png.height, data: png.data };
  }
  if (input[0] !== 255 || input[1] !== 216) throw new Error('仅支持 PNG 或 JPEG');
  const image = jpeg(input, { maxResolutionInMP: 4.2, maxMemoryUsageInMB: 128, formatAsRGBA: true, tolerantDecoding: false }); textureSize(image.width, image.height); return image;
}
export function encodeTexture(raster: Raster): Buffer { textureSize(raster.width, raster.height); return PNG.sync.write(raster as PNG, { colorType: 6 }); }
export function readNinePatch(image: Raster): { image: Raster; spec: NinePatchSpec } {
  const { width: w, height: h, data } = image; if (w < 3 || h < 3) throw new Error('点九 PNG 至少为 3×3（含边框）');
  const black = (x: number, y: number) => { const i = (y * w + x) * 4, c = [...data.subarray(i, i + 4)]; if (c[3] !== 0 && !c.every(v => v === 255) && !(c[0] === 0 && c[1] === 0 && c[2] === 0 && c[3] === 255)) throw new Error('点九边框只允许纯黑、纯白或全透明'); return c[0] === 0 && c[1] === 0 && c[2] === 0 && c[3] === 255; };
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) if (black(x, y)) throw new Error('点九四角不能为黑色');
  const runs = (size: number, pixel: (i: number) => boolean): [number, number][] => { const list: [number, number][] = []; let start = -1; for (let i = 0; i <= size; i++) { if (i < size && pixel(i)) { if (start < 0) start = i; } else if (start >= 0) { list.push([start, i]); start = -1; } } return list; };
  const horizontal = runs(w - 2, i => black(i + 1, 0)), vertical = runs(h - 2, i => black(0, i + 1)), bottom = runs(w - 2, i => black(i + 1, h - 1)), right = runs(h - 2, i => black(w - 1, i + 1));
  if (bottom.length > 1 || right.length > 1 || !horizontal.length || !vertical.length) throw new Error('点九伸缩段缺失，或内容区不连续');
  const x = bottom[0] ?? [horizontal[0][0], horizontal.at(-1)![1]], y = right[0] ?? [vertical[0][0], vertical.at(-1)![1]];
  const spec: NinePatchSpec = { horizontal, vertical, content: [x[0], y[0], x[1], y[1]] }; validateNinePatch(spec, w - 2, h - 2);
  const result: Raster = { width: w - 2, height: h - 2, data: Buffer.alloc((w - 2) * (h - 2) * 4) };
  for (let row = 0; row < result.height; row++) data.copy(result.data, row * result.width * 4, ((row + 1) * w + 1) * 4, ((row + 1) * w + w - 1) * 4);
  return { image: result, spec };
}
export function writeNinePatch(image: Raster, spec: NinePatchSpec): Buffer {
  validateNinePatch(spec, image.width, image.height);
  const width = image.width + 2, height = image.height + 2; textureSize(width, height);
  const result: Raster = { width, height, data: Buffer.alloc(width * height * 4) };
  for (let row = 0; row < image.height; row++) image.data.copy(result.data, ((row + 1) * width + 1) * 4, row * image.width * 4, (row + 1) * image.width * 4);
  const mark = (x: number, y: number) => result.data.set([0, 0, 0, 255], (y * width + x) * 4);
  for (const [a, b] of spec.horizontal) for (let x = a; x < b; x++) mark(x + 1, 0);
  for (const [a, b] of spec.vertical) for (let y = a; y < b; y++) mark(0, y + 1);
  const [l, t, r, b] = spec.content; for (let x = l; x < r; x++) mark(x + 1, height - 1); for (let y = t; y < b; y++) mark(width - 1, y + 1);
  return encodeTexture(result);
}
export function packTextures(inputs: { name: string; bytes: Uint8Array }[], width: number, padding: number): { png: Buffer; regions: AtlasRegion[]; width: number; height: number } {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64 || !Number.isInteger(width) || width < 16 || width > 4096 || !Number.isInteger(padding) || padding < 0 || padding > 32) throw new Error('图集宽度、间距或图片数量无效');
  let pixels = 0; const images = inputs.map(i => { const image = decodeTexture(i.bytes); pixels += image.width * image.height; if (pixels > 8 * 1024 * 1024) throw new Error('合成源图片总像素超过 8M'); return { ...i, image }; });
  let x = padding, y = padding, row = 0; const regions: AtlasRegion[] = [];
  for (const { image, name } of images) { if (image.width + padding * 2 > width) throw new Error('图集宽度不足以放入源图片'); if (x + image.width + padding > width) { x = padding; y += row + padding; row = 0; } regions.push({ name, x, y, width: image.width, height: image.height }); x += image.width + padding; row = Math.max(row, image.height); }
  const height = y + row + padding; textureSize(width, height); const output: Raster = { width, height, data: Buffer.alloc(width * height * 4) };
  for (let i = 0; i < images.length; i++) { const image = images[i].image, r = regions[i]; for (let row = 0; row < image.height; row++) image.data.copy(output.data, ((r.y + row) * width + r.x) * 4, row * image.width * 4, (row + 1) * image.width * 4); }
  return { png: encodeTexture(output), regions, width, height };
}
