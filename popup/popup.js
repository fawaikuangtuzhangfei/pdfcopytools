const enabledEl = document.getElementById('enabled');
const stateText = document.getElementById('stateText');

function render(on) {
  enabledEl.checked = on;
  stateText.textContent = on ? '已启用' : '已关闭';
}

async function init() {
  const { enabled = true } = await chrome.storage.sync.get({ enabled: true });
  render(enabled);
  enabledEl.addEventListener('change', () => {
    chrome.storage.sync.set({ enabled: enabledEl.checked });
    render(enabledEl.checked);
  });
  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
