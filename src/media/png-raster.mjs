import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePngRgba(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('PNG bytes are invalid');
  }

  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new TypeError('PNG contains a truncated chunk');
    const data = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0) throw new TypeError('Unsupported PNG compression/filter method');
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || idat.length === 0) {
    throw new TypeError('Only non-interlaced 8-bit PNG images are supported for part authoring');
  }

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new TypeError(`Unsupported PNG color type ${colorType}`);
  if (colorType === 3 && !palette) throw new TypeError('Indexed PNG is missing its palette');

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const expected = height * (stride + 1);
  if (raw.length < expected) throw new TypeError('PNG pixel data is truncated');

  const scanlines = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const outStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + 1 + x];
      const left = x >= channels ? scanlines[outStart + x - channels] : 0;
      const up = y > 0 ? scanlines[outStart - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? scanlines[outStart - stride + x - channels] : 0;
      let decoded;
      if (filter === 0) decoded = value;
      else if (filter === 1) decoded = value + left;
      else if (filter === 2) decoded = value + up;
      else if (filter === 3) decoded = value + Math.floor((left + up) / 2);
      else if (filter === 4) decoded = value + paeth(left, up, upLeft);
      else throw new TypeError(`Unsupported PNG filter ${filter}`);
      scanlines[outStart + x] = decoded & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * channels;
    const dst = i * 4;
    if (colorType === 6) {
      rgba[dst] = scanlines[src];
      rgba[dst + 1] = scanlines[src + 1];
      rgba[dst + 2] = scanlines[src + 2];
      rgba[dst + 3] = scanlines[src + 3];
    } else if (colorType === 4) {
      rgba[dst] = scanlines[src];
      rgba[dst + 1] = scanlines[src];
      rgba[dst + 2] = scanlines[src];
      rgba[dst + 3] = scanlines[src + 1];
    } else if (colorType === 2) {
      rgba[dst] = scanlines[src];
      rgba[dst + 1] = scanlines[src + 1];
      rgba[dst + 2] = scanlines[src + 2];
      rgba[dst + 3] = 255;
    } else if (colorType === 0) {
      rgba[dst] = scanlines[src];
      rgba[dst + 1] = scanlines[src];
      rgba[dst + 2] = scanlines[src];
      rgba[dst + 3] = 255;
    } else {
      const index = scanlines[src];
      rgba[dst] = palette[index * 3] ?? 0;
      rgba[dst + 1] = palette[index * 3 + 1] ?? 0;
      rgba[dst + 2] = palette[index * 3 + 2] ?? 0;
      rgba[dst + 3] = transparency?.[index] ?? 255;
    }
  }

  return { width, height, rgba };
}

export function encodePngRgba({ width, height, rgba }) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new TypeError('PNG dimensions must be positive integers');
  }
  if (!Buffer.isBuffer(rgba) || rgba.length !== width * height * 4) {
    throw new TypeError('RGBA buffer length does not match PNG dimensions');
  }

  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    rows[rowStart] = 0;
    rgba.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows, { level: 9 })),
    pngChunk('IEND')
  ]);
}

export function alphaBounds({ width, height, rgba }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function maskBounds(width, height, alpha) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function maskAlphaFromRgba({ width, height, rgba }) {
  const alphaValues = Buffer.alloc(width * height);
  let hasNonOpaqueAlpha = false;
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3];
    if (a !== 255) hasNonOpaqueAlpha = true;
  }
  for (let i = 0; i < width * height; i += 1) {
    const base = i * 4;
    alphaValues[i] = hasNonOpaqueAlpha
      ? rgba[base + 3]
      : Math.max(rgba[base], rgba[base + 1], rgba[base + 2]);
  }
  return alphaValues;
}

export function encodeMaskPng(width, height, alpha) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < alpha.length; i += 1) {
    const base = i * 4;
    rgba[base] = 255;
    rgba[base + 1] = 255;
    rgba[base + 2] = 255;
    rgba[base + 3] = alpha[i];
  }
  return encodePngRgba({ width, height, rgba });
}

export function applyAlphaMask(source, alpha) {
  const rgba = Buffer.from(source.rgba);
  for (let i = 0; i < alpha.length; i += 1) {
    const base = i * 4;
    rgba[base + 3] = Math.round((source.rgba[base + 3] * alpha[i]) / 255);
  }
  return encodePngRgba({ width: source.width, height: source.height, rgba });
}
