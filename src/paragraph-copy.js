// 点段落即复制：鼠标悬停到某个段落时，浮出一枚「复制整段」小按钮，
// 点一下即把整段（经 reflow 重建、去折行后的干净文本）写入剪贴板。
//
// 命中原理：把当前页文字层的所有 span 收成坐标化文本项，交给
// segmentParagraphs() 切段，建立 span→段落 的映射；悬停哪个 span，
// 就知道它属于哪一段，取该段 text 即可。切段结果按文字层节点缓存。

import { segmentParagraphs } from './reflow.js';
import { showCopyToast } from './toast.js';

let getSettings = () => ({ enabled: true, paragraphCopy: true, showToast: true });

// 每个 .textLayer 节点缓存一次切段结果：{ paragraphs, map }
const cache = new WeakMap();
let chip = null;      // 「复制整段」按钮
let highlight = null; // 段落高亮底衬
let curLayer = null;
let curPara = -1;
let hideTimer = null;
let rafPending = false;
let ptrX = 0, ptrY = 0;

function reflowOpts() {
  const s = getSettings();
  return {
    latinSpace: s.latinSpace,
    dehyphenate: s.dehyphenate,
    cjkLatinSpace: s.cjkLatinSpace,
    keepBullets: s.keepBullets,
  };
}

// 收集某文字层的坐标化文本项（每项挂上其 DOM 节点，便于映射回段落）
function collectLayerItems(layer) {
  const items = [];
  for (const span of layer.querySelectorAll(':scope > span')) {
    const str = span.textContent;
    if (!str || str.trim() === '') continue;
    const r = span.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    items.push({ str, x: r.left, y: r.top, width: r.width, height: r.height, node: span });
  }
  return items;
}

function getSegmentation(layer) {
  const cached = cache.get(layer);
  if (cached) return cached;
  const items = collectLayerItems(layer);
  const paragraphs = segmentParagraphs(items, reflowOpts());
  const map = new Map();
  paragraphs.forEach((p, i) => {
    for (const it of p.items) if (it.node) map.set(it.node, i);
  });
  const seg = { paragraphs, map };
  cache.set(layer, seg);
  return seg;
}

function ensureUI() {
  if (chip && document.body.contains(chip)) return;
  highlight = document.createElement('div');
  Object.assign(highlight.style, {
    position: 'fixed', zIndex: '2147483646', pointerEvents: 'none',
    background: 'rgba(80, 140, 255, 0.12)',
    border: '1px solid rgba(80, 140, 255, 0.35)',
    borderRadius: '4px', display: 'none',
    transition: 'opacity .12s ease', opacity: '0',
  });
  chip = document.createElement('button');
  chip.type = 'button';
  chip.textContent = '⧉ 复制整段';
  Object.assign(chip.style, {
    position: 'fixed', zIndex: '2147483647',
    font: '12px/1 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    padding: '5px 9px', borderRadius: '7px', border: 'none', cursor: 'pointer',
    background: 'rgba(37, 99, 235, 0.95)', color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.22)',
    display: 'none', opacity: '0', transition: 'opacity .12s ease',
    userSelect: 'none', whiteSpace: 'nowrap',
  });
  // 用 mousedown 抢在默认行为前触发，避免点击时把已有选区清掉
  chip.addEventListener('mousedown', onChipDown, true);
  chip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  document.body.appendChild(highlight);
  document.body.appendChild(chip);
}

// 由段落成员节点的当前位置算出并集包围盒（视口坐标，随滚动实时正确）
function paraBBox(para) {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const it of para.items) {
    if (!it.node) continue;
    const rc = it.node.getBoundingClientRect();
    if (rc.width === 0 && rc.height === 0) continue;
    l = Math.min(l, rc.left); t = Math.min(t, rc.top);
    r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
  }
  if (l === Infinity) return null;
  return { left: l, top: t, right: r, bottom: b };
}

function showFor(para) {
  ensureUI();
  const box = paraBBox(para);
  if (!box) return;
  // 高亮底衬
  Object.assign(highlight.style, {
    left: `${box.left - 3}px`, top: `${box.top - 2}px`,
    width: `${box.right - box.left + 6}px`, height: `${box.bottom - box.top + 4}px`,
    display: 'block',
  });
  // 按钮：贴在段落左上方；靠近视口顶部时改放到段内右上，避免出界
  chip.style.display = 'block';
  const cw = chip.offsetWidth || 84, ch = chip.offsetHeight || 24;
  let left = box.left;
  let top = box.top - ch - 4;
  if (top < 4) top = box.top + 4;                                  // 顶部空间不够 → 放段落内
  left = Math.min(left, window.innerWidth - cw - 6);
  left = Math.max(6, left);
  chip.style.left = `${left}px`;
  chip.style.top = `${top}px`;
  requestAnimationFrame(() => { highlight.style.opacity = '1'; chip.style.opacity = '1'; });
}

function hideUI() {
  curLayer = null; curPara = -1;
  if (!chip) return;
  chip.style.opacity = '0'; highlight.style.opacity = '0';
  chip.style.display = 'none'; highlight.style.display = 'none';
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideUI, 260);
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

function onChipDown(e) {
  e.preventDefault();
  e.stopPropagation();
  const text = chip._text;
  if (!text) return;
  writeClipboard(text).then((ok) => {
    if (ok && getSettings().showToast !== false) showCopyToast('已复制整段');
  });
}

function processMove() {
  rafPending = false;
  const s = getSettings();
  if (!s.enabled || !s.paragraphCopy) { hideUI(); return; }

  const el = document.elementFromPoint(ptrX, ptrY);
  if (!el) { scheduleHide(); return; }
  if (chip && (el === chip || chip.contains(el))) return; // 悬停在按钮上，保持

  const layer = el.closest ? el.closest('.textLayer') : null;
  if (!layer || el === layer || el.tagName !== 'SPAN') { scheduleHide(); return; }

  let seg = getSegmentation(layer);
  let idx = seg.map.get(el);
  if (idx == null) {
    // 命中失败多半是缩放后 pdf.js 用新节点重渲染了同一文字层 → 缓存失效，重算一次
    cache.delete(layer);
    seg = getSegmentation(layer);
    idx = seg.map.get(el);
  }
  if (idx == null) { scheduleHide(); return; }

  clearTimeout(hideTimer);
  if (layer === curLayer && idx === curPara) return; // 还在同一段，不重复定位
  curLayer = layer; curPara = idx;
  const para = seg.paragraphs[idx];
  chip._text = para.text;
  showFor(para);
}

function onMove(e) {
  ptrX = e.clientX; ptrY = e.clientY;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(processMove);
}

export function initParagraphCopy(opts = {}) {
  if (typeof opts.getSettings === 'function') getSettings = opts.getSettings;
  addEventListener('mousemove', onMove, { passive: true });
  // 滚动/缩放会让缓存的位置与坐标失效：隐藏按钮，并清掉切段缓存下次重算
  addEventListener('scroll', () => { hideUI(); }, true);
  addEventListener('wheel', () => { hideUI(); }, { passive: true });
}
