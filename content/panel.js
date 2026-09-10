// ================================================================
//  panel.js - 主面板控制逻辑
//  负责：showPanel/hidePanel、启动时位置与显隐恢复、
//       头部拖拽(视口边界限制)、面板对齐气泡、最小化按钮、菜单开合。
// ================================================================
// --- 控制面板打开 / 最小化 (带数据同步) ---
function showPanel() {
  alignPanelToBubble();
  mainPanel.classList.remove('closed');
  toggleBubble.classList.add('hidden');
  chrome.storage.local.set({ panelOpen: true });
}

function hidePanel() {
  saveNotes();
  mainPanel.classList.add('closed');
  toggleBubble.classList.remove('hidden');
  chrome.storage.local.set({ panelOpen: false });
}

// --- 初始化位置及模式恢复 (底部悬浮球 / 右侧贴边 双模式) ---
chrome.storage.local.get(['bubblePos', 'panelOpen', 'bubbleMode'], (res) => {
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
    if (res.bubblePos && res.bubblePos.left && res.bubblePos.left !== 'auto') {
      toggleBubble.style.left = res.bubblePos.left;
    } else {
      toggleBubble.style.left = `${(window.innerWidth / 2) - 25}px`;
    }
  }

  // 同步面板初始展开/最小化状态（默认最小化）
  if (res.panelOpen === true) {
    alignPanelToBubble();
    mainPanel.classList.remove('closed');
    toggleBubble.classList.add('hidden');
  } else {
    mainPanel.classList.add('closed');
    toggleBubble.classList.remove('hidden');
  }
});

// --- 逻辑 B: 主界面拖拽（增加视口边界限制） ---
let isPanelDragging = false;
let panelStartX, panelStartY, panelInitialLeft, panelInitialTop;

header.addEventListener('mousedown', (e) => {
  if (e.target.closest('button') || e.target.closest('.dropdown-menu')) return;
  if (e.button !== 0) return;
  isPanelDragging = true;
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

  let newLeft = panelInitialLeft + dx;
  let newTop = panelInitialTop + dy;

  // 边界限制：不超出视口
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
}

// 面板位置对齐至气泡：底部模式=气泡上方居中；侧边贴边模式=气泡左侧垂直居中
function alignPanelToBubble() {
  const bubbleRect = toggleBubble.getBoundingClientRect();
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const panelWidth = 360;
  const panelHeight = Math.min(800, screenHeight * 0.8);

  const isSideMode = toggleBubble.classList.contains('side-dock');

  let targetLeft, targetTop;

  if (isSideMode) {
    // 侧边贴边模式：面板展现在按钮左侧，垂直居中
    targetLeft = bubbleRect.left - panelWidth - 12;
    targetTop = bubbleRect.top + (bubbleRect.height / 2) - (panelHeight / 2);
  } else {
    // 底部模式：面板展现在按钮上方，水平居中 (留出 12px 精致间距)
    targetLeft = bubbleRect.left + (bubbleRect.width / 2) - (panelWidth / 2);
    targetTop = bubbleRect.top - panelHeight - 12;
  }

  // 视口边界限位修正
  targetLeft = Math.max(16, Math.min(targetLeft, screenWidth - panelWidth - 16));
  targetTop = Math.max(16, Math.min(targetTop, screenHeight - panelHeight - 16));

  mainPanel.style.top = `${targetTop}px`;
  mainPanel.style.left = `${targetLeft}px`;
  mainPanel.style.right = 'auto';
  mainPanel.style.bottom = 'auto';
  mainPanel.style.transformOrigin = isSideMode ? 'right center' : 'bottom center'; // 配合展开动效
  mainPanel.style.transform = '';
}

// 最小化按钮
minBtn.addEventListener('click', () => {
  hidePanel();
});

// --- 更多菜单展开 / 收起 ---
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); mainMenu.classList.toggle('show'); });
mainPanel.addEventListener('click', () => mainMenu.classList.remove('show'));
