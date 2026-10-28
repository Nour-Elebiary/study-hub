/**
 * Generates the PWA icons (public/icons/*.png) with zero dependencies —
 * Node's zlib is enough to write a valid PNG. Run: node scripts/generate-icons.mjs
 *
 * Design: a dark square (the app's primary color) with a white open-book
 * glyph drawn from two rectangles. Deliberately simple; a designer can
 * replace these files later without touching any code.
 *
 * Why a script instead of the `sharp` package: sharp pulls in a native
 * binary for a one-time asset generation (docs/FREE_TIER.md policy: keep
 * dependencies minimal). This script is run by hand when the design changes.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The app's --primary color (oklch(0.205 0 0) ≈ #171717) and white.
const BG = [23, 23, 23];
const FG = [255, 255, 255];

// --- minimal PNG encoder -----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // bytes 10-12: compression, filter, interlace = 0

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // signature
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- the drawing -------------------------------------------------------------

/**
 * Draws one icon. `maskable` keeps the glyph inside the central safe zone
 * (Android may crop a circular mask); `rounded` clips the background corners
 * like most launchers expect.
 */
function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);

  const put = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };

  const radius = size * 0.12;
  const insideRounded = (x, y) => {
    const cx = Math.min(x, size - 1 - x);
    const cy = Math.min(y, size - 1 - y);
    if (cx >= radius || cy >= radius) return true;
    const dx = radius - cx;
    const dy = radius - cy;
    return dx * dx + dy * dy <= radius * radius;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!maskable && !insideRounded(x, y)) {
        put(x, y, BG, 0); // transparent corner
      } else {
        put(x, y, BG);
      }
    }
  }

  // The open book: two white "pages" with a spine gap. The glyph lives in a
  // centered content box: 76% of the icon normally, 60% for maskable (the
  // safe zone is a circle of 80% diameter; 60% leaves margin).
  const box = maskable ? 0.6 : 0.76;
  const boxSize = size * box;
  const boxStart = (size - boxSize) / 2;
  const pageWidth = boxSize * 0.44;
  const pageHeight = boxSize * 0.62;
  const gap = boxSize * 0.12;
  const pageTop = boxStart + (boxSize - pageHeight) / 2;

  const fillRect = (x0, y0, w, h) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        if (maskable || insideRounded(x, y)) put(x, y, FG);
      }
    }
  };
  fillRect(boxStart, pageTop, pageWidth, pageHeight);
  fillRect(boxStart + pageWidth + gap, pageTop, pageWidth, pageHeight);

  return encodePng(size, size, px);
}

const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const outputs = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-192.png", 192, { maskable: true }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  // iOS ignores manifest icons and wants a square 180×180 PNG instead.
  ["apple-touch-icon.png", 180, { maskable: true }],
];

for (const [name, size, opts] of outputs) {
  writeFileSync(join(outDir, name), drawIcon(size, opts));
  console.log(`wrote public/icons/${name} (${size}×${size})`);
}
