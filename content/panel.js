// ================================================================
//  panel.js - 主面板控制逻辑
//  负责：showPanel/hidePanel、启动时位置与显隐恢复、
//       面板拖拽记忆、面板对齐气泡、最小化按钮、菜单开合。
// ================================================================

// 标记用户是否曾手动移动过面板
let hasUserMovedPanel = false;

// --- 控制面板打开 / 最小化 ---
function showPanel() {
  if (!hasUserMovedPanel) {
    // 如果用户从未手动拖动过面板，默认吸附在悬浮球旁边
    alignPanelToBubble();
  } else {
    // 如果用户手动移动过，保持移动后的位置，并确保不超出当前屏幕
    ensurePanelInViewport();
  }
  mainPanel.classList.remove('closed');
  toggleBubble.classList.add('hidden');
  chrome.storage.local.set({ panelOpen: true });
}

function hidePanel() {
  saveNotes();
  mainPanel.classList.add('closed'); // 平滑向右滑出消失
  toggleBubble.classList.remove('hidden');
  chrome.storage.local.set({ panelOpen: false });
}

// 确保面板在视口内可见（防止窗口缩小时跑出屏幕外）
function ensurePanelInViewport() {
  const maxLeft = window.innerWidth - mainPanel.offsetWidth;
  const maxTop = window.innerHeight - mainPanel.offsetHeight;
  let currentLeft = parseFloat(mainPanel.style.left) || 16;
  let currentTop = parseFloat(mainPanel.style.top) || 16;

  currentLeft = Math.max(16, Math.min(currentLeft, maxLeft - 16));
  currentTop = Math.max(16, Math.min(currentTop, maxTop - 16));

  mainPanel.style.left = `${currentLeft}px`;
  mainPanel.style.top = `${currentTop}px`;
  mainPanel.style.right = 'auto';
  mainPanel.style.bottom = 'auto';
}

// --- 初始化位置及面板显隐状态 ---
chrome.storage.local.get(['bubblePos', 'panelOpen', 'bubbleMode', 'panelPos'], (res) => {
  // 1. 恢复悬浮球/贴边页签模式与位置
  const isSide = res.bubbleMode === 'side';
  if (isSide) {
    toggleBubble.classList.add('side-dock');
    toggleBubble.style.right = '0';
    toggleBubble.style.left = 'auto';
    toggleBubble.style.bottom = 'auto';
    toggleBubble.style.top = (res.bubblePos && res.bubblePos.top) ? res.bubblePos.top : `${(window.innerHeight / 2) - 50}px`;
  } else {
    toggleBubble.classList.remove('side-dock');
    toggleBubble.style.bottom = '0';
    toggleBubble.style.right = 'auto';
    toggleBubble.style.top = 'auto';
    if (res.bubblePos && res.bubblePos.left) {
      toggleBubble.style.left = res.bubblePos.left;
    } else {
      toggleBubble.style.left = `${(window.innerWidth / 2) - 25}px`;
    }
  }

  // 2. 恢复用户拖拽过的面板坐标
  if (res.panelPos && res.panelPos.left && res.panelPos.top) {
    hasUserMovedPanel = true;
    mainPanel.style.left = res.panelPos.left;
    mainPanel.style.top = res.panelPos.top;
    mainPanel.style.right = 'auto';
    mainPanel.style.bottom = 'auto';
    ensurePanelInViewport();
  }

  // 3. 初始展开/收起状态
  if (res.panelOpen === true) {
    if (!hasUserMovedPanel) alignPanelToBubble();
    mainPanel.classList.remove('closed');
    toggleBubble.classList.add('hidden');
  } else {
    mainPanel.classList.add('closed');
    toggleBubble.classList.remove('hidden');
  }
});

// --- 主界面拖拽（支持移动记忆与持久化） ---
let isPanelDragging = false;
let panelHasMoved = false;
let panelStartX, panelStartY, panelInitialLeft, panelInitialTop;

header.addEventListener('mousedown', (e) => {
  if (e.target.closest('button') || e.target.closest('.dropdown-menu')) return;
  if (e.button !== 0) return;
  isPanelDragging = true;
  panelHasMoved = false;
  panelStartX = e.clientX;
  panelStartY = e.clientY;

  const rect = mainPanel.getBoundingClientRect();
  panelInitialLeft = rect.left;
  panelInitialTop = rect.top;

  mainPanel.style.transform = 'none';
  mainPanel.style.right = 'auto';
  mainPanel.style.bottom = 'auto';

  window.addEventListener('mousemove', onPanelMove);
  window.addEventListener('mouseup', onPanelUp);
});

function onPanelMove(e) {
  if (!isPanelDragging) return;
  const dx = e.clientX - panelStartX;
  const dy = e.clientY - panelStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
    panelHasMoved = true;
  }

  let newLeft = panelInitialLeft + dx;
  let newTop = panelInitialTop + dy;

  // 视口边界限制
  const maxLeft = window.innerWidth - mainPanel.offsetWidth;
  const maxTop = window.innerHeight - mainPanel.offsetHeight;
  newLeft = Math.max(0, Math.min(newLeft, maxLeft));
  newTop = Math.max(0, Math.min(newTop, maxTop));

  mainPanel.style.left = `${newLeft}px`;
  mainPanel.style.top = `${newTop}px`;
}

function onPanelUp() {
  if (!isPanelDragging) return;
  isPanelDragging = false;
  window.removeEventListener('mousemove', onPanelMove);
  window.removeEventListener('mouseup', onPanelUp);

  mainPanel.style.transform = ''; // 👈 清除拖拽时的行内 transform，交还给 CSS 的滑入/滑出动画接管

  // 👈 用户拖动后，持久化保存位置
  if (panelHasMoved) {
    hasUserMovedPanel = true;
    chrome.storage.local.set({
      panelPos: {
        left: mainPanel.style.left,
        top: mainPanel.style.top
      }
    });
  }
}

// 自动对齐到悬浮球上方/侧边
function alignPanelToBubble() {
  const bubbleRect = toggleBubble.getBoundingClientRect();
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const panelWidth = 360;
  const panelHeight = Math.min(800, screenHeight * 0.8);

  const isSideMode = toggleBubble.classList.contains('side-dock');
  let targetLeft, targetTop;

  if (isSideMode) {
    targetLeft = bubbleRect.left - panelWidth - 12;
    targetTop = bubbleRect.top + (bubbleRect.height / 2) - (panelHeight / 2);
  } else {
    targetLeft = bubbleRect.left + (bubbleRect.width / 2) - (panelWidth / 2);
    targetTop = bubbleRect.top - panelHeight - 12;
  }

  targetLeft = Math.max(16, Math.min(targetLeft, screenWidth - panelWidth - 16));
  targetTop = Math.max(16, Math.min(targetTop, screenHeight - panelHeight - 16));

  mainPanel.style.top = `${targetTop}px`;
  mainPanel.style.left = `${targetLeft}px`;
  mainPanel.style.right = 'auto';
  mainPanel.style.bottom = 'auto';
  mainPanel.style.transformOrigin = isSideMode ? 'right center' : 'bottom center';
  mainPanel.style.transform = '';
}

// 最小化按钮
minBtn.addEventListener('click', () => {
  hidePanel();
});

// 菜单展开/收起
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); mainMenu.classList.toggle('show'); });
mainPanel.addEventListener('click', () => mainMenu.classList.remove('show'));