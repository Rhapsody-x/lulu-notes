// ================================================================
//  bubble.js - 悬浮球 / 侧边吸附页签交互
//  支持：
//  1. 底部模式：X 轴左右平移拖拽
//  2. 右侧贴边模式 (100px*100px)：Y 轴上下平移拖拽
//  3. 右键切换模式：底部悬浮球 ↔ 右侧贴边页签
// ================================================================
let isBubbleDragging = false;
let bubbleHasMoved = false;
let bubbleStartX, bubbleStartY, bubbleInitialLeft, bubbleInitialTop;

toggleBubble.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isBubbleDragging = true;
  bubbleHasMoved = false;
  bubbleStartX = e.clientX;
  bubbleStartY = e.clientY;

  const rect = toggleBubble.getBoundingClientRect();
  bubbleInitialLeft = rect.left;
  bubbleInitialTop = rect.top;

  window.addEventListener('mousemove', onBubbleMove);
  window.addEventListener('mouseup', onBubbleUp);
});

function onBubbleMove(e) {
  if (!isBubbleDragging) return;

  const isSideMode = toggleBubble.classList.contains('side-dock');

  if (isSideMode) {
    // --- 侧边贴边模式：仅允许 Y 轴上下拖拽 ---
    const dy = e.clientY - bubbleStartY;
    if (Math.abs(dy) > 3) bubbleHasMoved = true;

    let newTop = bubbleInitialTop + dy;
    const maxTop = window.innerHeight - toggleBubble.offsetHeight;
    newTop = Math.max(0, Math.min(newTop, maxTop));

    toggleBubble.style.top = `${newTop}px`;
    toggleBubble.style.right = '0px';
    toggleBubble.style.left = 'auto';
    toggleBubble.style.bottom = 'auto';
  } else {
    // --- 底部模式：仅允许 X 轴左右拖拽 ---
    const dx = e.clientX - bubbleStartX;
    if (Math.abs(dx) > 3) bubbleHasMoved = true;

    let newLeft = bubbleInitialLeft + dx;
    const maxLeft = window.innerWidth - toggleBubble.offsetWidth;
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));

    toggleBubble.style.left = `${newLeft}px`;
    toggleBubble.style.right = 'auto';
    toggleBubble.style.top = 'auto';
    toggleBubble.style.bottom = '0';
  }
}

function onBubbleUp() {
  if (!isBubbleDragging) return;
  isBubbleDragging = false;
  window.removeEventListener('mousemove', onBubbleMove);
  window.removeEventListener('mouseup', onBubbleUp);

  if (bubbleHasMoved) {
    const isSideMode = toggleBubble.classList.contains('side-dock');
    chrome.storage.local.set({
      bubbleMode: isSideMode ? 'side' : 'bottom',
      bubblePos: {
        left: toggleBubble.style.left,
        top: toggleBubble.style.top
      }
    });
  }
}

// 点击打开面板
toggleBubble.addEventListener('click', () => {
  if (!bubbleHasMoved) {
    showPanel();
  }
});

// 右键点击：切换 底部悬浮球 ↔ 右侧贴边模式
toggleBubble.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  toggleBubbleMode();
});

function toggleBubbleMode(forceMode) {
  const isSide = forceMode !== undefined ? forceMode === 'side' : !toggleBubble.classList.contains('side-dock');

  if (isSide) {
    toggleBubble.classList.add('side-dock');
    if (!toggleBubble.style.top || toggleBubble.style.top === 'auto') {
      toggleBubble.style.top = `${(window.innerHeight / 2) - 50}px`;
    }
    toggleBubble.style.right = '0';
    toggleBubble.style.left = 'auto';
    toggleBubble.style.bottom = 'auto';
  } else {
    toggleBubble.classList.remove('side-dock');
    toggleBubble.style.bottom = '0';
    toggleBubble.style.right = 'auto';
    toggleBubble.style.top = 'auto';
    if (!toggleBubble.style.left || toggleBubble.style.left === 'auto') {
      toggleBubble.style.left = `${(window.innerWidth / 2) - 25}px`;
    }
  }

  chrome.storage.local.set({
    bubbleMode: isSide ? 'side' : 'bottom',
    bubblePos: {
      left: toggleBubble.style.left,
      top: toggleBubble.style.top
    }
  });
}
