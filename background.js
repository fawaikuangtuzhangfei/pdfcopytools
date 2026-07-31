// 后台 service worker：把 PDF 导航重定向到我们的 pdf.js 阅读器，并按开关启停。

const REDIRECT_RULE_ID = 1;

export const DEFAULT_SETTINGS = {
  enabled: true,        // 总开关：是否接管 PDF 并净化复制
  latinSpace: true,     // 拉丁词跨行补空格
  dehyphenate: true,    // 英文连字符换行拼回
  cjkLatinSpace: false, // 中英边界加空格
  keepBullets: true,    // 保留项目符号/编号
  showToast: true,      // 复制后轻提示
  paragraphCopy: true,  // hover 段落浮出「复制整段」按钮
  rawCopyModifier: 'alt', // 按住该键复制 = 原始复制（不净化）：'alt' | 'shift' | 'none'
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

function viewerUrl() {
  return chrome.runtime.getURL('viewer/web/viewer.html');
}

// 构造把 http(s) 的 *.pdf 导航重定向到 viewer.html?file=<原URL> 的动态规则。
// 注意：
//  1) DNR 工作在网络请求层，不拦截 file:// 本地导航——本地文件由下方 webNavigation 处理。
//  2) regexSubstitution 无法对 \0 做百分号编码；若原 URL 带 query/fragment（如签名链接的
//     ?sig=..&exp=..），直接拼进 ?file= 会让后面的 &/# 被 viewer 的 URLSearchParams 吃掉而丢参。
//     所以 DNR 只处理「无 query/fragment 的干净 .pdf」（原样拼接绝对安全）；带 ?/# 的交给
//     下方 webNavigation 用 encodeURIComponent 正确编码。
function buildRedirectRule() {
  return {
    id: REDIRECT_RULE_ID,
    priority: 1,
    action: {
      type: 'redirect',
      // \0 = 整个匹配到的原始 URL
      redirect: { regexSubstitution: `${viewerUrl()}?file=\\0` },
    },
    condition: {
      // 仅 http(s)、以 .pdf 结尾（忽略大小写）、且无 query/fragment、主框架导航
      regexFilter: '^https?://[^\\s?#]+\\.[pP][dD][fF]$',
      resourceTypes: ['main_frame'],
    },
  };
}

// 判断是否本地 PDF 文件导航
function isLocalPdf(url) {
  return /^file:\/\//i.test(url) && /\.pdf(?:[?#]|$)/i.test(url);
}

// 带 query/fragment 的 http(s) PDF：DNR 已跳过（避免丢参），改由 webNavigation 编码处理。
function isHttpPdfWithQuery(url) {
  return /^https?:\/\//i.test(url) && /\.pdf[?#]/i.test(url);
}

// 需要我们接管的 PDF 导航：file:// 全部，http(s) 仅带 query/fragment 的（干净的走 DNR）。
async function handlePdfNav(details) {
  if (details.frameId !== 0) return;            // 仅主框架
  const url = details.url;
  if (!isLocalPdf(url) && !isHttpPdfWithQuery(url)) return;
  const { enabled } = await getSettings();
  if (!enabled) return;
  // 原 URL 可能含空格、&、# 等 → 整体编码为一个 token 交给 pdf.js
  //（viewer 用 URLSearchParams 读取时会自动解码还原）
  const target = `${viewerUrl()}?file=${encodeURIComponent(url)}`;
  try {
    await chrome.tabs.update(details.tabId, { url: target });
  } catch {
    /* 标签页已关闭等情况忽略 */
  }
}

async function syncRules() {
  const { enabled } = await getSettings();
  const addRules = enabled ? [buildRedirectRule()] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [REDIRECT_RULE_ID],
    addRules,
  });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  // 落地默认设置（不覆盖用户已改的）
  const current = await chrome.storage.sync.get();
  const merged = { ...DEFAULT_SETTINGS, ...current };
  await chrome.storage.sync.set(merged);
  await syncRules();
  // 首装引导：打开设置/说明页（含 file:// 权限提示）
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(syncRules);

// PDF 导航重定向：file:// 全部由这里处理；http(s) 里「干净 .pdf」走 DNR，
// 「带 query/fragment 的」由这里编码处理（见 handlePdfNav / isHttpPdfWithQuery）。
chrome.webNavigation.onBeforeNavigate.addListener(handlePdfNav, {
  url: [
    { urlPrefix: 'file://' },
    { urlPrefix: 'http://' },
    { urlPrefix: 'https://' },
  ],
});

// 设置里改了总开关 → 立即启停规则
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) syncRules();
});
