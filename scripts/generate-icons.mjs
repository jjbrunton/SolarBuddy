import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

function createPNG(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const sunRadius = width * 0.16;
  const cornerRadius = width * 0.19;
  const bg = [26, 26, 26, 255];
  const sun = [255, 144, 43, 255];
  const green = [39, 194, 76, 255];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!isInRoundedRect(x, y, 0, 0, width, height, cornerRadius)) {
        pixels[i + 3] = 0;
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const rayAngle = ((angle / (Math.PI / 4)) % 1 + 1) % 1;
      const isRay = dist > sunRadius * 1.35 && dist < sunRadius * 1.75 && (rayAngle < 0.25 || rayAngle > 0.75);
      const isSun = dist < sunRadius;

      const bw = width * 0.12;
      const bh = width * 0.18;
      const bx = cx - bw / 2;
      const by = cy + width * 0.02;
      const isBattery = x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      const fillTop = by + bh * 0.4;
      const isFill = x >= bx + 3 && x <= bx + bw - 3 && y >= fillTop && y <= by + bh - 3;

      let color = bg;
      if (isFill) color = green;
      else if (isBattery) color = bg;
      else if (isSun || isRay) color = sun;

      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
    }
  }

  return encodePNG(width, height, pixels);
}

function isInRoundedRect(px, py, rx, ry, rw, rh, r) {
  if (px < rx + r && py < ry + r) return Math.hypot(px - rx - r, py - ry - r) <= r;
  if (px > rx + rw - r && py < ry + r) return Math.hypot(px - rx - rw + r, py - ry - r) <= r;
  if (px < rx + r && py > ry + rh - r) return Math.hypot(px - rx - r, py - ry - rh + r) <= r;
  if (px > rx + rw - r && py > ry + rh - r) return Math.hypot(px - rx - rw + r, py - ry - rh + r) <= r;
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crcBuf]);
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    pixels.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(rawData)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log('Generating icons...');
writeFileSync('public/icons/icon-192.png', createPNG(192, 192));
writeFileSync('public/icons/icon-512.png', createPNG(512, 512));
writeFileSync('public/icons/apple-touch-icon.png', createPNG(180, 180));
console.log('Done! Generated icon-192.png, icon-512.png, apple-touch-icon.png');
