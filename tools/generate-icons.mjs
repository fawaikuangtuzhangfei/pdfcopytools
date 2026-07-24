// 零依赖生成扩展图标（品牌蓝圆角方块 + 白色剪刀）。用法：node tools/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });

const ACCENT = [47, 107, 255];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// 平滑覆盖率（抗锯齿）：目标距离 d 相对阈值 r，半像素过渡
function cover(d, r, aa = 0.9) { return Math.max(0, Math.min(1, (r - d) / aa + 0.5)); }

function draw(S) {
  const rgba = Buffer.alloc(S * S * 4);
  const rad = 0.22 * S;
  const strokeW = 0.055 * S;
  const p1 = [0.30 * S, 0.34 * S]; // 上手柄圆心
  const p2 = [0.30 * S, 0.66 * S]; // 下手柄圆心
  const ringR = 0.10 * S;
  const tip1 = [0.84 * S, 0.70 * S];
  const tip2 = [0.84 * S, 0.30 * S];

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      // 圆角方块 alpha
      const qx = Math.max(rad - cx, cx - (S - rad), 0);
      const qy = Math.max(rad - cy, cy - (S - rad), 0);
      const corner = Math.hypot(qx, qy);
      const bg = cover(corner, rad);
      if (bg <= 0) continue;

      let r = ACCENT[0], g = ACCENT[1], b = ACCENT[2];
      // 白色剪刀：两手柄圆环 + 两刀刃
      const ring1 = Math.abs(Math.hypot(cx - p1[0], cy - p1[1]) - ringR);
      const ring2 = Math.abs(Math.hypot(cx - p2[0], cy - p2[1]) - ringR);
      const blade1 = distSeg(cx, cy, p1[0], p1[1], tip1[0], tip1[1]);
      const blade2 = distSeg(cx, cy, p2[0], p2[1], tip2[0], tip2[1]);
      const wk = Math.max(
        cover(ring1, strokeW / 2), cover(ring2, strokeW / 2),
        cover(blade1, strokeW / 2), cover(blade2, strokeW / 2),
      );
      if (wk > 0) { r = r + (WHITE[0] - r) * wk; g = g + (WHITE[1] - g) * wk; b = b + (WHITE[2] - b) * wk; }

      const i = (y * S + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = Math.round(bg * 255);
    }
  }
  return encodePNG(S, S, rgba);
}

for (const S of [16, 48, 128]) {
  writeFileSync(join(OUT, `icon${S}.png`), draw(S));
  console.log(`icons/icon${S}.png`);
}
