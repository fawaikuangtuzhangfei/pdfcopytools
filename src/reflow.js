// 段落重建核心（纯函数，无 DOM 依赖，可单测）
//
// 输入 items：按任意顺序的坐标化文本项数组，每项 { str, x, y, width, height, fontName? }
//   - x    : 左缘（x 向右增大）
//   - y    : 垂直位置，【向下增大】（屏幕坐标系；调用方负责把 PDF 坐标翻正）
//   - width: 该项宽度
//   - height: 字高（≈字号），用于推导各种阈值
// 输出：还原了段落/换行的干净文本字符串。
//
// 设计思路：PDF 没有“段落”概念，只有字的坐标。我们先按 y 聚成视觉行，
// 再用“行首缩进 / 上一行是否排满 / 行间距 / 项目符号”几组几何信号判断
// 相邻两行之间是“软折行（该合并）”还是“段落断（该换行）”。

const DEFAULTS = {
  latinSpace: true,      // 拉丁词跨行合并时补空格
  dehyphenate: true,     // 英文 "-\n" 拼回单词
  cjkLatinSpace: false,  // 中↔英边界是否加空格
  keepBullets: true,     // 保留项目符号/编号并另起一行
  paragraphSeparator: '\n',
};

const RE_CJK = /[⺀-鿿぀-ヿ가-힣豈-﫿＀-￯]/;
const RE_LATIN_WORD = /[A-Za-z0-9]/;
// 行首项目符号 / 编号
const RE_BULLET = /^\s*(?:[•‣·▪◦●○∙]|[-*]\s|\d{1,3}[.)、](?=\s|$)|[（(]\d+[)）]|[①-⑳]|[⒈-⒛])/;

function isCJK(ch) { return !!ch && RE_CJK.test(ch); }
function isLatinWord(ch) { return !!ch && RE_LATIN_WORD.test(ch); }
function lastNonSpace(s) { const m = s.match(/(\S)\s*$/); return m ? m[1] : ''; }
function firstNonSpace(s) { const m = s.match(/^\s*(\S)/); return m ? m[1] : ''; }

function median(nums) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// 决定两段文本在边界处如何拼接，返回需要插入的连接串（'' 或 ' '），
// 并可能要求删掉左侧末尾的连字符（dehyphenate）。
function joinDecision(leftChar, rightChar, opts) {
  if (!leftChar) return { sep: '', stripHyphen: false };
  if (!rightChar) return { sep: '', stripHyphen: false };
  // 英文连字符换行：去掉 '-' 直接拼
  if (opts.dehyphenate && leftChar === '-' && /[a-z]/.test(rightChar)) {
    return { sep: '', stripHyphen: true };
  }
  const lCJK = isCJK(leftChar), rCJK = isCJK(rightChar);
  if (lCJK || rCJK) {
    // 至少一侧是 CJK。中英边界加空格仅在“非 CJK 一侧是拉丁字母/数字（真正的英文词）”
    // 时生效；破折号 ——、引号“”、括号等标点不算，否则会出现“主动服务 ——”这类多余空格。
    if (opts.cjkLatinSpace && lCJK !== rCJK) {
      const otherChar = lCJK ? rightChar : leftChar;
      if (isLatinWord(otherChar)) return { sep: ' ', stripHyphen: false };
    }
    return { sep: '', stripHyphen: false };
  }
  // 两侧都不是 CJK：拉丁词之间补空格
  if (opts.latinSpace && isLatinWord(leftChar) && isLatinWord(rightChar)) {
    return { sep: ' ', stripHyphen: false };
  }
  return { sep: '', stripHyphen: false };
}

// 把已累积文本 acc 与新片段 frag 按边界规则拼接
function joinText(acc, frag, opts) {
  if (!acc) return frag;
  if (!frag) return acc;
  const { sep, stripHyphen } = joinDecision(lastNonSpace(acc), firstNonSpace(frag), opts);
  let left = acc;
  if (stripHyphen) left = left.replace(/-\s*$/, '');
  // 归一化边界空白：去掉左侧尾随空白与右侧前导空白，只插入由边界规则算出的 sep。
  // 否则 pdf.js 给某个 item 附带的尾随空格会残留（如“主动服务 ——”多出一个空格）。
  return left.replace(/\s+$/, '') + sep + frag.replace(/^\s+/, '');
}

// 将同一行内的多个 item 拼成整行文本（同样走边界规则，并额外处理词间水平间隙）
function buildLineText(items, H, opts) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = '';
  let prevRight = null;
  for (const it of sorted) {
    if (prevRight == null) { text = it.str; prevRight = it.x + it.width; continue; }
    const gap = it.x - prevRight;
    const lc = lastNonSpace(text), fc = firstNonSpace(it.str);
    // 行内不做去连字符：同一视觉行内的 '-' 基本都是真实连字符（如 co-operate）
    let { sep } = joinDecision(lc, fc, opts);
    // 明显水平间隙 + 两侧拉丁词 → pdf.js 把一个词拆成了两项，补空格
    if (sep === '' && gap > H * 0.25 && isLatinWord(lc) && isLatinWord(fc)) sep = ' ';
    // 同样归一化边界空白：strip 左侧尾随 + 右侧前导，只保留算出的 sep（避免残留/双空格）
    text = text.replace(/\s+$/, '') + sep + it.str.replace(/^\s+/, '');
    prevRight = it.x + it.width;
  }
  return text;
}

// 按 y 把 items 聚成视觉行
function groupLines(items, H) {
  const sorted = [...items].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const tol = H * 0.5;
  const lines = [];
  let cur = null;
  for (const it of sorted) {
    if (!cur || it.y - cur.y > tol) {
      cur = { y: it.y, items: [it] };
      lines.push(cur);
    } else {
      cur.items.push(it);
    }
  }
  return lines;
}

// 众数左缘：把 left 按 H/2 分桶，取最常见桶的中位左缘作为正文左边距
function bodyLeftOf(lines, H) {
  const bucket = Math.max(H * 0.5, 1);
  const counts = new Map();
  const byBucket = new Map();
  for (const ln of lines) {
    const key = Math.round(ln.left / bucket);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(ln.left);
  }
  let bestKey = null, bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  return median(byBucket.get(bestKey));
}

// 把坐标化文本项切成段落，返回 [{ text, items }]。
// items 为该段落包含的原始输入项（对象引用原样保留，调用方挂在项上的
// 额外字段如 node 也会被带出，便于把段落映射回 DOM）。
function buildParagraphs(valid, opts) {
  const H = median(valid.map((it) => it.height).filter((h) => h > 0)) || 12;

  // 1) 聚行 + 计算每行几何（保留每行的源文本项）
  const rawLines = groupLines(valid, H);
  const lines = rawLines.map((ln) => {
    const text = buildLineText(ln.items, H, opts);
    const left = Math.min(...ln.items.map((it) => it.x));
    const right = Math.max(...ln.items.map((it) => it.x + it.width));
    return { text, left, right, y: ln.y, items: ln.items };
  }).filter((ln) => ln.text.trim() !== '');
  if (!lines.length) return [];
  if (lines.length === 1) return [{ text: lines[0].text.trim(), items: lines[0].items }];

  // 2) 版面度量
  const bodyLeft = bodyLeftOf(lines, H);
  const bodyRight = Math.max(...lines.map((ln) => ln.right));
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  const posGaps = gaps.filter((g) => g > 0);
  // 用观测到的行距中位数作“正常行距”。不能用 H（pdf.js 报告的字高）去估计行距：
  // 它常远小于真实行距，会把均匀的正常行距误判成“段落大间距”，导致每行都被拆开。
  // 仅 2 行时无从判断“正常行距”，此时不以行距作为拆段依据（宁可合并——本工具的本职
  // 就是去除折行），拆段交给缩进/项目符号/上一行未排满等更可靠的信号。
  const normalGap = posGaps.length >= 2 ? median(posGaps) : Infinity;
  // 是否两端对齐排版：多数行都接近右边距 → 短行才有意义
  const fullLines = lines.filter((ln) => bodyRight - ln.right <= H * 1.5).length;
  const isJustified = fullLines / lines.length >= 0.6;

  // 3) 逐行判断“换段 vs 软折行”，拼装段落
  const paragraphs = [];
  let curText = lines[0].text;
  let curItems = [...lines[0].items];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const bullet = opts.keepBullets && RE_BULLET.test(line.text);
    const indented = line.left - bodyLeft > H * 0.8;      // 首行缩进
    const bigGap = (line.y - prev.y) > normalGap * 1.6;    // 行间距明显大于正常行距
    const prevShort = isJustified && (bodyRight - prev.right) > H * 3; // 上一行未排满

    const breakHere = bullet || indented || bigGap || prevShort;
    if (breakHere) {
      paragraphs.push({ text: curText.trim(), items: curItems });
      curText = line.text;
      curItems = [...line.items];
    } else {
      curText = joinText(curText, line.text, opts);
      curItems.push(...line.items);
    }
  }
  paragraphs.push({ text: curText.trim(), items: curItems });

  return paragraphs.filter((p) => p.text !== '');
}

function validItems(items) {
  return (items || []).filter((it) => it && typeof it.str === 'string' && it.str.trim() !== '');
}

export function reflow(items, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const valid = validItems(items);
  if (!valid.length) return '';
  return buildParagraphs(valid, opts).map((p) => p.text).join(opts.paragraphSeparator);
}

// 把整页/整块文本项切成段落，返回 [{ text, items }]。供“点段落即复制”按段落命中使用。
export function segmentParagraphs(items, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const valid = validItems(items);
  if (!valid.length) return [];
  return buildParagraphs(valid, opts);
}

// 供测试/复用的内部工具
export const _internal = { groupLines, buildLineText, joinDecision, bodyLeftOf, median };
