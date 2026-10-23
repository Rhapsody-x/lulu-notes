// ================================================================
//  panel.js - 主面板控制逻辑（桌面版）
//  原生窗口在「悬浮球」与「面板」两种尺寸之间切换：
//     悬浮球  64×64（底部） / 36×36（右侧贴边）
//     主面板  360×(工作区高度 80%，最大 800)
//  打开/关闭时先切换透明窗口，再以悬浮球为原点做缩放淡入 / 收缩动画。
//  面板位置会被记忆，并在打开时自动限制在当前显示器工作区内。
// ================================================================

const BUBBLE_SIZE = 64;

// 侧边贴边模式（方案 A）：可视页签 36×30 贴在屏幕右边缘；
// 原生窗口额外留出「居中光晕」阴影所需的绘制空间：左侧 6px、上下各 2px → 窗口 42×34。
// 需要满足：SIDE_SHADOW_LEFT ≥ |offsetX| + blur + hover 位移 = 0 + 2 + 4 = 6；SIDE_SHADOW_Y ≥ blur = 2。
// （数值与 styles.js 中 .side-dock 的 box-shadow / top 保持一致）
const SIDE_TAB_WIDTH = 36;
const SIDE_TAB_HEIGHT = 30;
const SIDE_SHADOW_LEFT = 6;
const SIDE_SHADOW_Y = 2;
const SIDE_WINDOW_WIDTH = SIDE_TAB_WIDTH + SIDE_SHADOW_LEFT;
const SIDE_WINDOW_HEIGHT = SIDE_TAB_HEIGHT + SIDE_SHADOW_Y * 2;

const PANEL_WIDTH = 360;

// 方案A：原生窗口比面板四周各多留一圈透明边距，专门给 CSS box-shadow 绘制，
// 避免阴影被窗口边界裁掉后留下“硬边矩形”的观感。
// 阴影最大外扩 = blur 2px（两层均无偏移），因此 2px 留白即可（原 10px，进一步收紧死区）。
// 注意：该值必须与 styles.js 中 :host 的 --panel-edge 保持一致。
const PANEL_SHADOW_PADDING = 2;
const PANEL_WINDOW_WIDTH = PANEL_WIDTH + PANEL_SHADOW_PADDING * 2;

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

// 面板模式下原生窗口的高度 = 面板高度 + 上下阴影留白
function panelWindowHeight() {
  return WIN.panelHeight + PANEL_SHADOW_PADDING * 2;
}

// x / y 为原生窗口左上角坐标（窗口 = 面板 + 四周阴影留白）
function clampPanelWindowPosition(x, y) {
  const area = WIN.workArea;
  const maxX = area.left + area.width - PANEL_WINDOW_WIDTH;
  const maxY = area.top + area.height - panelWindowHeight();
  return {
    x: clampNumber(x, area.left, maxX),
    y: clampNumber(y, area.top, maxY)
  };
}

// --- 侧边贴边模式的坐标换算 ---
// 原生窗口左上角与页签左上角存在固定偏移（留白用于绘制阴影），
// 位置记忆统一使用「页签」坐标，避免留白尺寸变化后旧数据整体漂移。
function clampSideTabY(y) {
  const area = WIN.workArea;
  return clampNumber(y, area.top, area.top + area.height - SIDE_TAB_HEIGHT);
}

function sideWindowPosFromTabY(tabY) {
  const area = WIN.workArea;
  return {
    x: area.left + area.width - SIDE_WINDOW_WIDTH,
    y: tabY - SIDE_SHADOW_Y
  };
}

function sideTabRectFromWindow(windowRect) {
  const area = WIN.workArea;
  return {
    x: area.left + area.width - SIDE_TAB_WIDTH,
    y: windowRect.y + SIDE_SHADOW_Y,
    width: SIDE_TAB_WIDTH,
    height: SIDE_TAB_HEIGHT
  };
}

// 当前悬浮球的可视矩形（底部模式 = 水豚窗口，贴边模式 = 半胶囊页签）
function bubbleVisualRect() {
  if (WIN.mode === 'bubble' && WIN.bubbleMode === 'side') {
    return sideTabRectFromWindow(WIN.current);
  }
  return {
    x: WIN.current.x,
    y: WIN.current.y,
    width: WIN.current.width,
    height: WIN.current.height
  };
}

function defaultBubblePosition(mode) {
  const area = WIN.workArea;
  if (mode === 'side') {
    return sideWindowPosFromTabY(
      area.top + Math.round((area.height - SIDE_TAB_HEIGHT) / 2)
    );
  }
  return {
    x: area.left + Math.round((area.width - BUBBLE_SIZE) / 2),
    y: area.top + area.height - BUBBLE_SIZE
  };
}

function clampBubblePosition(mode, pos) {
  const area = WIN.workArea;
  if (mode === 'side') {
    const fallbackTabY = area.top + Math.round((area.height - SIDE_TAB_HEIGHT) / 2);
    const tabY = pos && Number.isFinite(pos.y) ? pos.y : fallbackTabY;
    return sideWindowPosFromTabY(clampSideTabY(tabY));
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
    ? { width: SIDE_WINDOW_WIDTH, height: SIDE_WINDOW_HEIGHT }
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
      // panelPos 记录的是面板本身左上角（与旧版本数据兼容），换算成窗口坐标。
      target = clampPanelWindowPosition(
        restore.panelPos.x - PANEL_SHADOW_PADDING,
        restore.panelPos.y - PANEL_SHADOW_PADDING
      );
    } else {
      target = alignPanelToBubble();
    }

    // 动画原点以面板内容（去掉阴影留白）为基准，悬浮球取可视矩形（贴边模式为页签）。
    const origin = panelOriginTowardsBubble(
      target.x + PANEL_SHADOW_PADDING,
      target.y + PANEL_SHADOW_PADDING,
      PANEL_WIDTH,
      WIN.panelHeight,
      bubbleVisualRect()
    );

    await applyWindowGeometry('panel', PANEL_WINDOW_WIDTH, panelWindowHeight(), target.x, target.y);
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
    // 贴边模式下收起目标是页签矩形（原生窗口左侧/上下还含阴影留白）。
    const bubbleTarget = mode === 'side'
      ? sideTabRectFromWindow({ x: pos.x, y: pos.y, width: size.width, height: size.height })
      : { x: pos.x, y: pos.y, width: size.width, height: size.height };

    // 原点按面板内容计算（窗口坐标需去掉四周阴影留白）。
    const origin = panelOriginTowardsBubble(
      WIN.current.x + PANEL_SHADOW_PADDING,
      WIN.current.y + PANEL_SHADOW_PADDING,
      WIN.current.width - PANEL_SHADOW_PADDING * 2,
      WIN.current.height - PANEL_SHADOW_PADDING * 2,
      bubbleTarget
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

// 确保面板位置在当前工作区内（坐标为原生窗口左上角）
function ensurePanelInViewport() {
  WIN.panelHeight = panelHeightForWorkArea();
  const next = clampPanelWindowPosition(WIN.current.x, WIN.current.y);
  scheduleWindowMove(next.x, next.y);
}

// 自动对齐到悬浮球上方/侧边（先按面板内容定位，再换算成窗口坐标）
function alignPanelToBubble() {
  const isSideMode = WIN.bubbleMode === 'side';
  const bubble = WIN.current;
  let panelLeft;
  let panelTop;

  if (isSideMode) {
    // 贴边模式的原生窗口比页签宽 20px、高 32px，先取页签矩形再对齐。
    const tab = sideTabRectFromWindow(bubble);
    panelLeft = tab.x - PANEL_WIDTH - 12;
    panelTop = tab.y + (tab.height / 2) - (WIN.panelHeight / 2);
  } else {
    panelLeft = bubble.x + (bubble.width / 2) - (PANEL_WIDTH / 2);
    panelTop = bubble.y - WIN.panelHeight - 12;
  }

  return clampPanelWindowPosition(
    panelLeft - PANEL_SHADOW_PADDING,
    panelTop - PANEL_SHADOW_PADDING
  );
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
    area.left + area.width - PANEL_WINDOW_WIDTH
  );
  const newY = clampNumber(
    panelDragState.startY + dy,
    area.top,
    area.top + area.height - panelWindowHeight()
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
    // panelPos 仍按面板内容左上角存储，兼容旧版本数据。
    Store.set({
      panelPos: {
        x: WIN.current.x + PANEL_SHADOW_PADDING,
        y: WIN.current.y + PANEL_SHADOW_PADDING
      }
    });
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



