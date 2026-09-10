// ================================================================
//  richtext.js - 富文本选择变色悬浮菜单
//  负责：文本选区监听/定位调色面板/隐藏处理、颜色点应用前景色。
// ================================================================
// 当前文本选区缓存（供点击色点时还原选区使用）
let currentSelectionRange = null;

function handleSelectionChange() {
  const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
  if (!selection || selection.isCollapsed) {
    colorTooltip.style.display = 'none';
    return;
  }

  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  let containerEl = commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentNode : commonAncestor;

  if (!containerEl || !containerEl.closest('.note-textarea')) {
    colorTooltip.style.display = 'none';
    return;
  }

  const rect = range.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    colorTooltip.style.display = 'none';
    return;
  }

  // 定位悬浮调色面板
  colorTooltip.style.display = 'flex';
  const tooltipWidth = 160;
  const tooltipHeight = 36;

  let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
  let top = rect.top - tooltipHeight - 8;

  left = Math.max(10, Math.min(left, window.innerWidth - tooltipWidth - 10));
  top = Math.max(10, top);

  colorTooltip.style.left = `${left}px`;
  colorTooltip.style.top = `${top}px`;

  currentSelectionRange = range.cloneRange();
}

// 绑定多维监听
document.addEventListener('selectionchange', handleSelectionChange);
notesContainer.addEventListener('mouseup', handleSelectionChange);
notesContainer.addEventListener('keyup', handleSelectionChange);

shadow.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#color-tooltip')) {
    colorTooltip.style.display = 'none';
  }
});

// 调色交互
colorTooltip.querySelectorAll('.color-dot').forEach(dot => {
  dot.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const color = dot.dataset.color;

    const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
    if (selection && currentSelectionRange) {
      selection.removeAllRanges();
      selection.addRange(currentSelectionRange);
    }

    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color);

    saveNotes();
  });
});
