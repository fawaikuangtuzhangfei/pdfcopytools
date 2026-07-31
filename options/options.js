const DEFAULTS = {
  enabled: true,
  latinSpace: true,
  dehyphenate: true,
  cjkLatinSpace: false,
  keepBullets: true,
  showToast: true,
  paragraphCopy: true,
  rawCopyModifier: 'alt',
};

const BOOLS = ['enabled', 'latinSpace', 'dehyphenate', 'cjkLatinSpace', 'keepBullets', 'showToast', 'paragraphCopy'];
const statusEl = document.getElementById('status');
let statusTimer = null;

function flashSaved() {
  statusEl.textContent = '已保存';
  statusEl.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => statusEl.classList.remove('show'), 1200);
}

async function init() {
  const s = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  for (const key of BOOLS) {
    const el = document.getElementById(key);
    el.checked = !!s[key];
    el.addEventListener('change', () => {
      chrome.storage.sync.set({ [key]: el.checked });
      flashSaved();
    });
  }
  const raw = document.getElementById('rawCopyModifier');
  raw.value = s.rawCopyModifier;
  raw.addEventListener('change', () => {
    chrome.storage.sync.set({ rawCopyModifier: raw.value });
    flashSaved();
  });

  if (new URLSearchParams(location.search).get('welcome') === '1') {
    document.getElementById('welcome').hidden = false;
  }
}

init();
