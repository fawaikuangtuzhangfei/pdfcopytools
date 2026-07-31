// 运行在 pdf.js 阅读器页内：拦截 copy 事件，用坐标重建段落后写回剪贴板。
import { reflow } from './reflow.js';
import { showCopyToast } from './toast.js';
import { initParagraphCopy } from './paragraph-copy.js';

const DEFAULT_SETTINGS = {
  enabled: true,
  latinSpace: true,
  dehyphenate: true,
  cjkLatinSpace: false,
  keepBullets: true,
  showToast: true,
  paragraphCopy: true,
  rawCopyModifier: 'alt',
};

let settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    /* storage 不可用时用默认值 */
  }
}
loadSettings();
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') loadSettings();
  });
} catch { /* ignore */ }

// 段落速复制：hover 段落浮出「复制整段」按钮。共用同一份 settings（读实时值）。
initParagraphCopy({ getSettings: () => settings });

// 跟踪修饰键状态，用于“原始复制”兜底
const held = { alt: false, shift: false };
function updateHeld(e) { held.alt = e.altKey; held.shift = e.shiftKey; }
addEventListener('keydown', updateHeld, true);
addEventListener('keyup', updateHeld, true);

function wantsRawCopy() {
  if (settings.rawCopyModifier === 'alt') return held.alt;
  if (settings.rawCopyModifier === 'shift') return held.shift;
  return false;
}

// 从选区收集坐标化文本项（视口坐标，y 向下）
function collectItems(sel) {
  const items = [];
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r);
    if (range.collapsed) continue;
    const rootNode = range.commonAncestorContainer;
    const root = rootNode.nodeType === Node.ELEMENT_NODE ? rootNode : rootNode.parentNode;
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.textContent || node.textContent.trim() === '') return NodeFilter.FILTER_REJECT;
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      let start = 0;
      let end = node.textContent.length;
      if (node === range.startContainer) start = range.startOffset;
      if (node === range.endContainer) end = range.endOffset;
      if (end <= start) continue;
      const str = node.textContent.slice(start, end);
      if (str.trim() === '') continue;
      const sub = document.createRange();
      sub.setStart(node, start);
      sub.setEnd(node, end);
      const rect = sub.getBoundingClientRect();
      sub.detach?.();
      if (rect.width === 0 && rect.height === 0) continue;
      items.push({ str, x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }
  }
  return items;
}

addEventListener('copy', (e) => {
  if (!settings.enabled) return;
  if (wantsRawCopy()) return; // 走浏览器默认复制

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

  const items = collectItems(sel);
  if (items.length < 2) return; // 单片段无需重排，交给默认行为

  const cleaned = reflow(items, {
    latinSpace: settings.latinSpace,
    dehyphenate: settings.dehyphenate,
    cjkLatinSpace: settings.cjkLatinSpace,
    keepBullets: settings.keepBullets,
  });
  if (!cleaned || !cleaned.trim()) return;

  if (e.clipboardData) {
    e.clipboardData.setData('text/plain', cleaned);
    e.preventDefault();
    // 关键：阻止事件继续传播。否则 pdf.js 文本层自带的 copy 处理器（冒泡阶段）会用
    // selection.toString()（含原始换行）再次覆盖 text/plain，把我们整理好的结果冲掉。
    // 我们在 window 捕获阶段最先执行，stopImmediatePropagation 可拦下后续所有处理器。
    e.stopImmediatePropagation();
    if (settings.showToast) showCopyToast('已整理换行');
  }
}, true);
