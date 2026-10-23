// ================================================================
//  bubble.js - 悬浮球 / 侧边吸附页签交互（桌面版）
//  桌面版中悬浮球就是原生窗口本身：
//    1. 底部模式：仅允许 X 轴左右拖动原生窗口
//    2. 右侧贴边模式：仅允许 Y 轴上下拖动原生窗口
//    3. 右键切换模式；左键打开面板
// ================================================================
let bubbleDragState = null;
let bubbleHasMoved = false;

toggleBubble.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !WIN.ready) return;
  bubbleHasMoved = false;
  bubbleDragState = {
    screenX: e.screenX,
    screenY: e.screenY,
    startX: WIN.current.x,
    startY: WIN.current.y,
    moved: false
  };
  e.preventDefault();
  window.addEventListener('mousemove', onBubbleMove);
  window.addEventListener('mouseup', onBubbleUp);
});

function onBubbleMove(e) {
  if (!bubbleDragState) return;
  if (e.buttons === 0) {
    onBubbleUp();
    return;
  }

  const isSideMode = WIN.bubbleMode === 'side';
  const area = WIN.workArea;

  if (isSideMode) {
    // --- 侧边贴边模式：仅允许 Y 轴上下拖拽 ---
    const dy = e.screenY - bubbleDragState.screenY;
    if (Math.abs(dy) > 3) {
      bubbleDragState.moved = true;
      bubbleHasMoved = true;
    }
    const newY = clampNumber(
      bubbleDragState.startY + dy,
      area.top,
      area.top + area.height - SIDE_SIZE
    );
    scheduleWindowMove(area.left + area.width - SIDE_SIZE, newY);
  } else {
    // --- 底部模式：仅允许 X 轴左右拖拽 ---
    const dx = e.screenX - bubbleDragState.screenX;
    if (Math.abs(dx) > 3) {
      bubbleDragState.moved = true;
      bubbleHasMoved = true;
    }
    const newX = clampNumber(
      bubbleDragState.startX + dx,
      area.left,
      area.left + area.width - BUBBLE_SIZE
    );
    scheduleWindowMove(newX, area.top + area.height - BUBBLE_SIZE);
  }
}

async function onBubbleUp() {
  if (!bubbleDragState) return;
  const moved = bubbleDragState.moved;
  bubbleDragState = null;
  window.removeEventListener('mousemove', onBubbleMove);
  window.removeEventListener('mouseup', onBubbleUp);

  if (!moved) return;

  await refreshMetrics();
  const mode = WIN.bubbleMode;
  const area = WIN.workArea;
  let pos;
  if (mode === 'side') {
    pos = {
      x: area.left + area.width - SIDE_SIZE,
      y: clampNumber(WIN.current.y, area.top, area.top + area.height - SIDE_SIZE)
    };
  } else {
    pos = {
      x: clampNumber(WIN.current.x, area.left, area.left + area.width - BUBBLE_SIZE),
      y: area.top + area.height - BUBBLE_SIZE
    };
  }
  Store.set({
    bubbleMode: mode,
    bubblePos: pos
  });
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
  e.stopPropagation();
  toggleBubbleMode();
});

async function toggleBubbleMode(forceMode) {
  if (!WIN.ready || WIN.mode !== 'bubble') return;

  const isSide = forceMode !== undefined
    ? forceMode === 'side'
    : WIN.bubbleMode !== 'side';
  const previous = WIN.current;
  const area = WIN.workArea;
  let size;
  let pos;

  if (isSide) {
    size = { width: SIDE_SIZE, height: SIDE_SIZE };
    pos = {
      x: area.left + area.width - SIDE_SIZE,
      y: clampNumber(
        previous.y + previous.height / 2 - SIDE_SIZE / 2,
        area.top,
        area.top + area.height - SIDE_SIZE
      )
    };
  } else {
    size = { width: BUBBLE_SIZE, height: BUBBLE_SIZE };
    pos = {
      x: clampNumber(
        previous.x + previous.width / 2 - BUBBLE_SIZE / 2,
        area.left,
        area.left + area.width - BUBBLE_SIZE
      ),
      y: area.top + area.height - BUBBLE_SIZE
    };
  }

  WIN.bubbleMode = isSide ? 'side' : 'bottom';
  if (isSide) {
    toggleBubble.classList.add('side-dock');
  } else {
    toggleBubble.classList.remove('side-dock');
  }

  await applyWindowGeometry('bubble', size.width, size.height, pos.x, pos.y);
  Store.set({
    bubbleMode: WIN.bubbleMode,
    bubblePos: { x: pos.x, y: pos.y }
  });
}
