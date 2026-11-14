// Draws the app icons (four game chips in a 2x2 grid on a dark tile) into public/icons.
// Generated at build time so the repo holds no binary images.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const OUT = new URL("../public/icons/", import.meta.url);

type RGB = [number, number, number];
const BG_TOP: RGB = [44, 48, 72];
const BG: RGB = [24, 26, 40];
const CHIP_SHADE = 0.72;
const WHITE: RGB = [255, 255, 255];

// Icon layout in unit coordinates (0..1), before the maskable safe-zone scale.
const R = 0.15;
const CHIPS: { x: number; y: number; c: RGB }[] = [
  { x: 0.33, y: 0.33, c: [255, 92, 77] },
  { x: 0.67, y: 0.33, c: [255, 210, 63] },
  { x: 0.33, y: 0.67, c: [59, 140, 255] },
  { x: 0.67, y: 0.67, c: [74, 196, 110] },
];

const smooth = (edge: number, d: number, aa: number) => Math.max(0, Math.min(1, (edge - d) / aa + 0.5));

function pixel(u: number, v: number, aa: number): RGB {
  // Dark tile, a little lighter at the top.
  const g = Math.min(1, Math.hypot(u - 0.5, v * 0.9) / 0.9);
  let c: RGB = [0, 1, 2].map((i) => BG_TOP[i]! * (1 - g) + BG[i]! * g) as RGB;
  const over = (col: RGB, a: number) => {
    c = c.map((x, i) => x * (1 - a) + col[i]! * a) as RGB;
  };

  for (const chip of CHIPS) {
    // Drop shadow, a darker rim, the chip face and a soft highlight.
    over([0, 0, 0], smooth(R, Math.hypot(u - chip.x, v - chip.y - 0.02), aa) * 0.35);
    const d = Math.hypot(u - chip.x, v - chip.y);
    over(chip.c.map((x) => x * CHIP_SHADE) as RGB, smooth(R, d, aa));
    over(chip.c, smooth(R * 0.78, d, aa));
    over(WHITE, smooth(R * 0.22, Math.hypot(u - chip.x + R * 0.36, v - chip.y + R * 0.36), aa) * 0.45);
  }
  return c;
}

function png(size: number, scale: number): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const aa = (1.2 * scale) / size;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // Shrink the art toward the middle for maskable icons.
      const u = 0.5 + ((x + 0.5) / size - 0.5) * scale;
      const v = 0.5 + ((y + 0.5) / size - 0.5) * scale;
      const [r, g, b] = pixel(u, v, aa);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(r);
      raw[o + 1] = Math.round(g);
      raw[o + 2] = Math.round(b);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="100%"><stop offset="0" stop-color="#2c3048"/><stop offset="1" stop-color="#181a28"/></radialGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#bg)"/>
  <circle cx="33" cy="35" r="15" fill="#000" opacity="0.35"/>
  <circle cx="33" cy="33" r="15" fill="#b84237"/>
  <circle cx="33" cy="33" r="11.7" fill="#ff5c4d"/>
  <circle cx="27.6" cy="27.6" r="3.3" fill="#fff" opacity="0.45"/>
  <circle cx="67" cy="35" r="15" fill="#000" opacity="0.35"/>
  <circle cx="67" cy="33" r="15" fill="#b8972d"/>
  <circle cx="67" cy="33" r="11.7" fill="#ffd23f"/>
  <circle cx="61.6" cy="27.6" r="3.3" fill="#fff" opacity="0.45"/>
  <circle cx="33" cy="69" r="15" fill="#000" opacity="0.35"/>
  <circle cx="33" cy="67" r="15" fill="#2a65b8"/>
  <circle cx="33" cy="67" r="11.7" fill="#3b8cff"/>
  <circle cx="27.6" cy="61.6" r="3.3" fill="#fff" opacity="0.45"/>
  <circle cx="67" cy="69" r="15" fill="#000" opacity="0.35"/>
  <circle cx="67" cy="67" r="15" fill="#358d4f"/>
  <circle cx="67" cy="67" r="11.7" fill="#4ac46e"/>
  <circle cx="61.6" cy="61.6" r="3.3" fill="#fff" opacity="0.45"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("icon.svg", OUT), svg);
writeFileSync(new URL("icon-192.png", OUT), png(192, 1));
writeFileSync(new URL("icon-512.png", OUT), png(512, 1));
writeFileSync(new URL("icon-maskable-512.png", OUT), png(512, 1.25));
writeFileSync(new URL("apple-touch-icon.png", OUT), png(180, 1.1));
