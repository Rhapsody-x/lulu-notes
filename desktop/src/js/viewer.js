// ================================================================
//  viewer.js - 图片预览窗口
//  职责：向主进程取当前应显示的图片 → 渲染 → 拖拽移动 / 双击切换
//        原始尺寸 / Esc 或 × 关闭。
//  窗口本身由 Rust 侧创建并设定尺寸，这里不负责计算大小。
// ================================================================
const Tauri = window.__TAURI__ || {};
const invoke = (command, args = {}) => {
  if (!Tauri.core || typeof Tauri.core.invoke !== 'function') {
    return Promise.reject(new Error('Tauri API 不可用'));
  }
  return Tauri.core.invoke(command, args);
};

const stage = document.getElementById('stage');
const image = document.getElementById('view-image');
const closeBtn = document.getElementById('btn-close');
const hint = document.getElementById('hint');

let currentPayload = null;
let drag = null;
let moveScheduled = false;
let pendingMove = null;

function toAssetUrl(absolutePath) {
  const normalized = String(absolutePath || '').replace(/\\/g, '/');
  if (Tauri.core && typeof Tauri.core.convertFileSrc === 'function') {
    try {
      return Tauri.core.convertFileSrc(normalized);
    } catch (err) {
      console.error('资源地址转换失败:', err);
    }
  }
  return normalized;
}

function resetViewMode() {
  image.classList.remove('actual-size');
  stage.classList.remove('scrollable');
  image.removeAttribute('data-fallback');
}

async function loadCurrentImage() {
  let payload;
  try {
    payload = await invoke('viewer_current_image');
  } catch (err) {
    console.error('读取预览图片失败:', err);
    return;
  }
  if (!payload || !payload.path) return;

  currentPayload = payload;
  const src = toAssetUrl(payload.path);
  if (image.getAttribute('src') === src) return;

  resetViewMode();
  image.setAttribute('src', src);
  document.title = payload.name || '图片预览';
}

// 资源协议不可用时退回 base64，保证任何环境下都能看到图。
image.addEventListener('error', async () => {
  if (!currentPayload || !currentPayload.name) return;
  if (image.dataset.fallback === '1') return;
  image.dataset.fallback = '1';
  try {
    const map = await invoke('read_images', { names: [currentPayload.name] });
    if (map && map[currentPayload.name]) image.src = map[currentPayload.name];
  } catch (err) {
    console.error('读取图片数据失败:', err);
  }
});

// --- 拖拽移动窗口（复用主进程的 move_window） ---
stage.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  if (e.target === closeBtn) return;
  e.preventDefault();

  let metrics;
  try {
    metrics = await invoke('window_metrics');
  } catch (err) {
    return;
  }
  if (!metrics) return;

  drag = {
    screenX: e.screenX,
    screenY: e.screenY,
    originX: metrics.x,
    originY: metrics.y
  };
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', endDrag);
});

function onDragMove(e) {
  if (!drag) return;
  if (e.buttons === 0) {
    endDrag();
    return;
  }

  pendingMove = {
    x: drag.originX + (e.screenX - drag.screenX),
    y: drag.originY + (e.screenY - drag.screenY)
  };

  if (moveScheduled) return;
  moveScheduled = true;
  requestAnimationFrame(() => {
    moveScheduled = false;
    const target = pendingMove;
    pendingMove = null;
    if (!target) return;
    invoke('move_window', target).catch(() => {});
  });
}

function endDrag() {
  drag = null;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', endDrag);
}

// --- 双击切换 原始尺寸 / 适应窗口 ---
stage.addEventListener('dblclick', () => {
  const actual = image.classList.toggle('actual-size');
  stage.classList.toggle('scrollable', actual);
});

// --- 关闭 ---
function closeViewer() {
  invoke('close_viewer').catch(() => {});
}

closeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  closeViewer();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeViewer();
  } else if (e.key === '0') {
    stage.dispatchEvent(new MouseEvent('dblclick'));
  }
});

// --- 提示条：进入后短暂显示 ---
function showHint() {
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 2600);
}

// 主进程复用窗口时会广播该事件
if (Tauri.event && typeof Tauri.event.listen === 'function') {
  Tauri.event.listen('viewer-image', () => {
    loadCurrentImage();
    showHint();
  });
}

loadCurrentImage().then(showHint);
