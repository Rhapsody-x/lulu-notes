// ================================================================
//  panel.js - 主面板控制逻辑（桌面版）
//  原生窗口在「悬浮球」与「面板」两种尺寸之间切换：
//     悬浮球  64×64（底部） / 36×36（右侧贴边）
//     主面板  360×(工作区高度 80%，最大 800)
//  打开/关闭时先切换透明窗口，再以悬浮球为原点做缩放淡入 / 收缩动画。
//  面板位置会被记忆，并在打开时自动限制在当前显示器工作区内。
// ================================================================

const BUBBLE_SIZE = 64;
const SIDE_SIZE = 36;
const PANEL_WIDTH = 360;

const WIN = {
  ready: false,
  mode: 'bubble',          // 'bubble' | 'panel'
  bubbleMode: 'bottom',    // 'bottom' | 'side'
  workArea: { left: 0, top: 0, width: 1280, height: 720 },
  panelHeight: 640,
  current: { x: 100, y: 100, width: BUBBLE_SIZE, height: BUBBLE_SIZE }
};

let hasUserMovedPanel = false;
let panelDragState = null;

// --- 面板开合动画 ---
// 原生窗口的尺寸无法逐帧平滑改变，因此先把透明窗口切换到目标尺寸，
// 再让面板内容以悬浮球为原点做缩放 + 淡入；关闭时反向收缩，最后才缩回悬浮球窗口。
const PANEL_OPEN_ANIM_MS = 280;
const PANEL_CLOSE_ANIM_MS = 190;
let panelAnimation = null;
let panelTransitioning = false;

function clampNumber(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// 计算面板相对悬浮球的缩放原点，让面板看起来是从悬浮球里展开的。
function panelOriginTowardsBubble(panelX, panelY, panelWidth, panelHeight, bubble) {
  const bubbleCenterX = bubble.x + bubble.width / 2;
  const bubbleCenterY = bubble.y + bubble.height / 2;
  const originX = clampNumber(((bubbleCenterX - panelX) / panelWidth) * 100, 0, 100);
  const originY = clampNumber(((bubbleCenterY - panelY) / panelHeight) * 100, 0, 100);
  return `${originX.toFixed(2)}% ${originY.toFixed(2)}%`;
}

function stopPanelAnimation() {
  if (!panelAnimation) return;
  const running = panelAnimation;
  panelAnimation = null;
  try { running.cancel(); } catch (_) {}
  mainPanel.style.transformOrigin = '';
}

function animatePanelOpen(origin) {
  stopPanelAnimation();
  if (prefersReducedMotion() || typeof mainPanel.animate !== 'function') return;

  mainPanel.style.transformOrigin = origin;
  const animation = mainPanel.animate(
    [
      { opacity: 0, transform: 'scale(0.78)' },
      { opacity: 1, transform: 'scale(1)' }
    ],
    {
      duration: PANEL_OPEN_ANIM_MS,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      fill: 'both'
    }
  );
  panelAnimation = animation;
  animation.finished
    .catch(() => {})
    .then(() => {
      if (panelAnimation !== animation) return;
      panelAnimation = null;
      animation.cancel();
      mainPanel.style.transformOrigin = '';
    });
}

async function animatePanelClose(origin) {
  stopPanelAnimation();
  if (prefersReducedMotion() || typeof mainPanel.animate !== 'function') return;

  mainPanel.style.transformOrigin = origin;
  const animation = mainPanel.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.78)' }
    ],
    {
      duration: PANEL_CLOSE_ANIM_MS,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'both'
    }
  );
  panelAnimation = animation;
  try {
    await animation.finished;
  } catch (_) {}
  if (panelAnimation === animation) {
    panelAnimation = null;
    animation.cancel();
    mainPanel.style.transformOrigin = '';
  }
}

function getWorkArea() {
  return WIN.workArea;
}

function panelHeightForWorkArea() {
  const height = Math.floor(WIN.workArea.height * 0.8);
  return Math.max(240, Math.min(800, height));
}

function clampPanelPosition(x, y) {
  const area = WIN.workArea;
  const maxX = area.left + area.width - PANEL_WIDTH;
  const maxY = area.top + area.height - WIN.panelHeight;
  return {
    x: clampNumber(x, area.left, maxX),
    y: clampNumber(y, area.top, maxY)
  };
}

function defaultBubblePosition(mode) {
  const area = WIN.workArea;
  if (mode === 'side') {
    return {
      x: area.left + area.width - SIDE_SIZE,
      y: area.top + Math.round((area.height - SIDE_SIZE) / 2)
    };
  }
  return {
    x: area.left + Math.round((area.width - BUBBLE_SIZE) / 2),
    y: area.top + area.height - BUBBLE_SIZE
  };
}

function clampBubblePosition(mode, pos) {
  const area = WIN.workArea;
  if (mode === 'side') {
    const fallback = defaultBubblePosition('side');
    const y = pos && Number.isFinite(pos.y) ? pos.y : fallback.y;
    return {
      x: area.left + area.width - SIDE_SIZE,
      y: clampNumber(y, area.top, area.top + area.height - SIDE_SIZE)
    };
  }
  const fallback = defaultBubblePosition('bottom');
  const x = pos && Number.isFinite(pos.x) ? pos.x : fallback.x;
  return {
    x: clampNumber(x, area.left, area.left + area.width - BUBBLE_SIZE),
    y: area.top + area.height - BUBBLE_SIZE
  };
}

function bubbleSize(mode) {
  return mode === 'side'
    ? { width: SIDE_SIZE, height: SIDE_SIZE }
    : { width: BUBBLE_SIZE, height: BUBBLE_SIZE };
}

async function refreshMetrics() {
  try {
    const metrics = await invoke('window_metrics');
    if (metrics && metrics.workArea && metrics.workArea.width > 0) {
      WIN.workArea = metrics.workArea;
    }
    if (metrics && Number.isFinite(metrics.x) && Number.isFinite(metrics.y)) {
      WIN.current = {
        x: metrics.x,
        y: metrics.y,
        width: metrics.width || WIN.current.width,
        height: metrics.height || WIN.current.height
      };
    }
  } catch (err) {
    console.error('读取窗口信息失败:', err);
  }
  return WIN.workArea;
}


let moveScheduled = false;
let pendingMove = null;

// 拖动时按帧合并窗口移动请求，避免 IPC 过于频繁。
function scheduleWindowMove(x, y) {
  pendingMove = { x, y };
  WIN.current.x = x;
  WIN.current.y = y;
  if (moveScheduled) return;
  moveScheduled = true;
  requestAnimationFrame(() => {
    moveScheduled = false;
    const target = pendingMove;
    pendingMove = null;
    if (!target) return;
    invoke('move_window', { x: target.x, y: target.y }).catch(err => {
      console.error('移动窗口失败:', err);
    });
  });
}

async function applyWindowGeometry(mode, width, height, x, y) {
  document.body.classList.add('mode-switching');
  try {
    await invoke('configure_window', { width, height, x, y });
  } catch (err) {
    console.error('调整窗口失败:', err);
  }
  WIN.mode = mode;
  WIN.current = { x, y, width, height };
  document.body.classList.toggle('panel-mode', mode === 'panel');
  document.body.classList.toggle('bubble-mode', mode === 'bubble');
  await nextFrame();
  await nextFrame();
  document.body.classList.remove('mode-switching');
}

// --- 控制面板打开 / 最小化 ---
async function showPanel() {
  if (!WIN.ready || panelTransitioning) return;

  if (WIN.mode === 'panel') {
    mainPanel.classList.remove('closed');
    toggleBubble.classList.add('hidden');
    await invoke('show_window').catch(() => {});
    return;
  }

  panelTransitioning = true;
  try {
    await refreshMetrics();
    WIN.panelHeight = panelHeightForWorkArea();

    const restore = Store.get(['panelOpen', 'panelPos']);
    let target;
    if (restore.panelPos && Number.isFinite(restore.panelPos.x) && Number.isFinite(restore.panelPos.y)) {
      hasUserMovedPanel = true;
      target = clampPanelPosition(restore.panelPos.x, restore.panelPos.y);
    } else {
      target = alignPanelToBubble();
    }

    // 在窗口尺寸切换前记录悬浮球位置，作为面板展开动画的原点。
    const origin = panelOriginTowardsBubble(
      target.x, target.y, PANEL_WIDTH, WIN.panelHeight, WIN.current
    );

    await applyWindowGeometry('panel', PANEL_WIDTH, WIN.panelHeight, target.x, target.y);
    Store.set({ panelOpen: true });
    if (typeof closeExport === 'function') closeExport();
    if (typeof closeTrash === 'function') closeTrash();

    // 先让窗口可见（此时面板仍是 closed），再播放展开动画，
    // 避免窗口从托盘恢复时动画在隐藏状态下提前播完。
    await invoke('show_window').catch(() => {});
    mainPanel.classList.remove('closed');
    toggleBubble.classList.add('hidden');
    animatePanelOpen(origin);
  } finally {
    panelTransitioning = false;
  }
}

async function hidePanel() {
  if (!WIN.ready || panelTransitioning || WIN.mode !== 'panel') return;

  panelTransitioning = true;
  try {
    if (typeof saveNotes === 'function') saveNotes();

    await refreshMetrics();
    const stored = Store.get(['bubbleMode', 'bubblePos']);
    const mode = stored.bubbleMode === 'side' ? 'side' : 'bottom';
    WIN.bubbleMode = mode;
    const size = bubbleSize(mode);
    const pos = clampBubblePosition(mode, stored.bubblePos);

    // 关闭时朝悬浮球目标位置收缩，收缩完再切回小窗口。
    const origin = panelOriginTowardsBubble(
      WIN.current.x,
      WIN.current.y,
      WIN.current.width,
      WIN.current.height,
      { x: pos.x, y: pos.y, width: size.width, height: size.height }
    );

    await animatePanelClose(origin);
    mainPanel.classList.add('closed');
    toggleBubble.classList.remove('hidden');

    await applyWindowGeometry('bubble', size.width, size.height, pos.x, pos.y);
    Store.set({ panelOpen: false });
  } finally {
    panelTransitioning = false;
  }
}

// 确保面板位置在当前工作区内
function ensurePanelInViewport() {
  WIN.panelHeight = panelHeightForWorkArea();
  const next = clampPanelPosition(WIN.current.x, WIN.current.y);
  scheduleWindowMove(next.x, next.y);
}

// 自动对齐到悬浮球上方/侧边
function alignPanelToBubble() {
  const area = WIN.workArea;
  const isSideMode = WIN.bubbleMode === 'side';
  const bubble = WIN.current;
  let targetLeft;
  let targetTop;

  if (isSideMode) {
    targetLeft = bubble.x - PANEL_WIDTH - 12;
    targetTop = bubble.y + (bubble.height / 2) - (WIN.panelHeight / 2);
  } else {
    targetLeft = bubble.x + (bubble.width / 2) - (PANEL_WIDTH / 2);
    targetTop = bubble.y - WIN.panelHeight - 12;
  }

  targetLeft = clampNumber(targetLeft, area.left, area.left + area.width - PANEL_WIDTH);
  targetTop = clampNumber(targetTop, area.top, area.top + area.height - WIN.panelHeight);
  return { x: targetLeft, y: targetTop };
}

// --- 面板拖动（直接移动原生窗口） ---
header.addEventListener('mousedown', (e) => {
  if (WIN.mode !== 'panel') return;
  if (e.button !== 0) return;
  if (e.target.closest('button') || e.target.closest('.dropdown-menu') || e.target.closest('input')) return;

  panelDragState = {
    screenX: e.screenX,
    screenY: e.screenY,
    startX: WIN.current.x,
    startY: WIN.current.y,
    moved: false
  };
  e.preventDefault();
  window.addEventListener('mousemove', onPanelMove);
  window.addEventListener('mouseup', onPanelUp);
});

function onPanelMove(e) {
  if (!panelDragState) return;
  if (e.buttons === 0) {
    onPanelUp();
    return;
  }
  const dx = e.screenX - panelDragState.screenX;
  const dy = e.screenY - panelDragState.screenY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panelDragState.moved = true;

  const area = WIN.workArea;
  const newX = clampNumber(
    panelDragState.startX + dx,
    area.left,
    area.left + area.width - PANEL_WIDTH
  );
  const newY = clampNumber(
    panelDragState.startY + dy,
    area.top,
    area.top + area.height - WIN.panelHeight
  );
  scheduleWindowMove(newX, newY);
}

async function onPanelUp() {
  if (!panelDragState) return;
  const moved = panelDragState.moved;
  panelDragState = null;
  window.removeEventListener('mousemove', onPanelMove);
  window.removeEventListener('mouseup', onPanelUp);

  if (moved) {
    hasUserMovedPanel = true;
    await refreshMetrics();
    Store.set({ panelPos: { x: WIN.current.x, y: WIN.current.y } });
  }
}

// --- 启动：恢复悬浮球位置与模式，显示窗口 ---
const windowReady = (async () => {
  await refreshMetrics();
  WIN.panelHeight = panelHeightForWorkArea();

  const stored = Store.get(['bubbleMode', 'bubblePos']);
  const mode = stored.bubbleMode === 'side' ? 'side' : 'bottom';
  WIN.bubbleMode = mode;
  if (mode === 'side') {
    toggleBubble.classList.add('side-dock');
  } else {
    toggleBubble.classList.remove('side-dock');
  }

  const size = bubbleSize(mode);
  const pos = clampBubblePosition(mode, stored.bubblePos);

  document.body.classList.add('bubble-mode');
  await invoke('configure_window', {
    width: size.width,
    height: size.height,
    x: pos.x,
    y: pos.y
  }).catch(err => console.error('初始化窗口失败:', err));
  WIN.mode = 'bubble';
  WIN.current = { x: pos.x, y: pos.y, width: size.width, height: size.height };
  mainPanel.classList.add('closed');
  toggleBubble.classList.remove('hidden');
  await invoke('show_window').catch(err => console.error('显示窗口失败:', err));
  WIN.ready = true;
  return true;
})();

// 最小化按钮
minBtn.addEventListener('click', () => {
  hidePanel();
});

// 菜单展开/收起
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); mainMenu.classList.toggle('show'); });
mainPanel.addEventListener('click', () => mainMenu.classList.remove('show'));



