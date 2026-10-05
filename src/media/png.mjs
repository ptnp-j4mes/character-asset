const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 12 * 1024 * 1024;

export function decodePngDataUrl(value) {
  if (typeof value !== 'string') throw new TypeError('image_data_url must be a PNG data URL');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) throw new TypeError('image_data_url must be a base64 PNG data URL');

  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PNG_BYTES) {
    throw new TypeError(`PNG must be between 1 byte and ${MAX_PNG_BYTES} bytes`);
  }
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('image_data_url does not contain a valid PNG signature');
  }

  let offset = 8;
  let width;
  let height;
  let alpha = false;
  let sawIend = false;

  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const next = dataEnd + 4;
    if (next > bytes.length) throw new TypeError('PNG contains a truncated chunk');

    if (type === 'IHDR') {
      if (length !== 13) throw new TypeError('PNG IHDR chunk is invalid');
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      const colorType = bytes[dataStart + 9];
      alpha = colorType === 4 || colorType === 6;
    } else if (type === 'tRNS') {
      alpha = true;
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }
    offset = next;
  }

  if (!width || !height || !sawIend) throw new TypeError('PNG is missing required chunks');
  return { bytes, width, height, hasAlpha: alpha };
}
