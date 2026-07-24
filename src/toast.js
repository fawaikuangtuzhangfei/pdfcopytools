// 右下角 1 秒淡出的轻提示，不打断阅读。纯 JS + 内联样式，避免污染 viewer 样式。

let toastEl = null;
let hideTimer = null;

function ensureEl() {
  if (toastEl && document.body.contains(toastEl)) return toastEl;
  toastEl = document.createElement('div');
  Object.assign(toastEl.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    zIndex: '2147483647',
    padding: '8px 14px',
    borderRadius: '10px',
    background: 'rgba(30, 30, 32, 0.92)',
    color: '#fff',
    font: '13px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    opacity: '0',
    transform: 'translateY(6px)',
    transition: 'opacity .18s ease, transform .18s ease',
    pointerEvents: 'none',
  });
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showCopyToast(message) {
  if (!document.body) return;
  const el = ensureEl();
  el.textContent = '';
  const check = document.createElement('span');
  check.textContent = '✓';
  check.style.color = '#4ade80';
  check.style.fontWeight = '700';
  el.appendChild(check);
  el.appendChild(document.createTextNode(message));

  // 触发淡入
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
  }, 1000);
}
