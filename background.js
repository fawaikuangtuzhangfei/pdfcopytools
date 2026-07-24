// 后台 service worker：把 PDF 导航重定向到我们的 pdf.js 阅读器，并按开关启停。

const REDIRECT_RULE_ID = 1;

export const DEFAULT_SETTINGS = {
  enabled: true,        // 总开关：是否接管 PDF 并净化复制
  latinSpace: true,     // 拉丁词跨行补空格
  dehyphenate: true,    // 英文连字符换行拼回
  cjkLatinSpace: false, // 中英边界加空格
  keepBullets: true,    // 保留项目符号/编号
  showToast: true,      // 复制后轻提示
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
// 注意：DNR 工作在网络请求层，不拦截 file:// 本地导航——本地文件由下方 webNavigation 处理。
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
      // 仅 http(s)、以 .pdf 结尾（忽略大小写）、主框架导航
      regexFilter: '^https?://[^\\s]+\\.[pP][dD][fF](?:[?#][^\\s]*)?$',
      resourceTypes: ['main_frame'],
    },
  };
}

// 判断是否本地 PDF 文件导航
function isLocalPdf(url) {
  return /^file:\/\//i.test(url) && /\.pdf(?:[?#]|$)/i.test(url);
}

// file:// 本地 PDF：webNavigation 抢在原生阅读器前，把标签页导到我们的阅读器。
// 需要用户在 chrome://extensions 打开「允许访问文件网址」，否则事件不会触发。
async function handleLocalPdfNav(details) {
  if (details.frameId !== 0) return;            // 仅主框架
  if (!isLocalPdf(details.url)) return;
  const { enabled } = await getSettings();
  if (!enabled) return;
  // file:// 路径可能含空格等特殊字符 → 编码后交给 pdf.js（其用 URLSearchParams 会自动解码）
  const target = `${viewerUrl()}?file=${encodeURIComponent(details.url)}`;
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

// 本地 PDF 重定向（http(s) 由 DNR 处理，这里只管 file://）
chrome.webNavigation.onBeforeNavigate.addListener(handleLocalPdfNav, {
  url: [{ urlPrefix: 'file://' }],
});

// 设置里改了总开关 → 立即启停规则
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) syncRules();
});
