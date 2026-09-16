// Pembaca GPS dari EXIF file JPEG, ditulis sendiri (tanpa library luar) supaya
// tetap berfungsi 100% offline sebagai bagian dari app shell yang di-cache.
// Hanya membaca tag yang dibutuhkan: GPSLatitude/Longitude(Ref) dan waktu foto.

function readExifSegment(view, tiffStart, littleEndian) {
  const tags = {};
  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
  let gpsIfdOffset = null;
  let exifIfdOffset = null;

  function readIfd(offset) {
    const entries = view.getUint16(offset, littleEndian);
    const result = {};
    for (let i = 0; i < entries; i++) {
      const entryOffset = offset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const count = view.getUint32(entryOffset + 4, littleEndian);
      const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 9: 4, 10: 8 };
      const size = (typeSizes[type] || 1) * count;
      const valueOffset = size > 4 ? tiffStart + view.getUint32(entryOffset + 8, littleEndian) : entryOffset + 8;
      result[tag] = { type, count, valueOffset };
    }
    return result;
  }

  const ifd0 = readIfd(tiffStart + ifdOffset);
  if (ifd0[0x8825]) gpsIfdOffset = tiffStart + view.getUint32(ifd0[0x8825].valueOffset, littleEndian);
  if (ifd0[0x8769]) exifIfdOffset = tiffStart + view.getUint32(ifd0[0x8769].valueOffset, littleEndian);

  function readRational(offset) {
    const num = view.getUint32(offset, littleEndian);
    const den = view.getUint32(offset + 4, littleEndian);
    return den === 0 ? 0 : num / den;
  }

  function readString(entry) {
    let str = "";
    for (let i = 0; i < entry.count - 1; i++) str += String.fromCharCode(view.getUint8(entry.valueOffset + i));
    return str;
  }

  if (gpsIfdOffset) {
    const gpsIfd = readIfd(gpsIfdOffset);
    const dms = (entry) => [readRational(entry.valueOffset), readRational(entry.valueOffset + 8), readRational(entry.valueOffset + 16)];
    if (gpsIfd[1]) tags.latRef = readString(gpsIfd[1]);
    if (gpsIfd[2]) tags.lat = dms(gpsIfd[2]);
    if (gpsIfd[3]) tags.lonRef = readString(gpsIfd[3]);
    if (gpsIfd[4]) tags.lon = dms(gpsIfd[4]);
  }

  if (exifIfdOffset) {
    const exifIfd = readIfd(exifIfdOffset);
    if (exifIfd[0x9003]) tags.dateTimeOriginal = readString(exifIfd[0x9003]).trim();
  }

  return tags;
}

function dmsToDecimal([d, m, s], ref) {
  let dec = d + m / 60 + s / 3600;
  if (ref === "S" || ref === "W") dec = -dec;
  return dec;
}

// Mengembalikan { latitude, longitude, dateTimeOriginal } atau null kalau
// file bukan JPEG dengan EXIF GPS.
export async function readGpsFromJpeg(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      const segLength = view.getUint16(offset + 2);
      const exifHeader = offset + 4;
      if (view.getUint32(exifHeader) !== 0x45786966) { offset += 2 + segLength; continue; }
      const tiffStart = exifHeader + 6;
      const endian = view.getUint16(tiffStart);
      const littleEndian = endian === 0x4949;
      const tags = readExifSegment(view, tiffStart, littleEndian);
      if (tags.lat && tags.lon) {
        return {
          latitude: dmsToDecimal(tags.lat, tags.latRef),
          longitude: dmsToDecimal(tags.lon, tags.lonRef),
          dateTimeOriginal: tags.dateTimeOriginal || null,
        };
      }
      return null;
    } else if ((marker & 0xff00) !== 0xff00) {
      break;
    } else {
      const segLength = view.getUint16(offset + 2);
      offset += 2 + segLength;
    }
  }
  return null;
}
