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

// --- 图片粘贴 / 拖入（桌面版没有扩展的图片上传入口，这里补齐） ---
function insertImageIntoNote(file, editable) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
  const insert = (src) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = file.name || '图片';

    const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
    const hasCaret = selection && selection.rangeCount > 0 &&
      editable.contains(selection.anchorNode);
    if (hasCaret) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      editable.appendChild(img);
    }
    saveNotes();
  };

  const reader = new FileReader();
  reader.onload = () => {
    const source = String(reader.result || '');
    // 小图直接内嵌；大图压缩，避免 localStorage 很快超出配额。
    if (source.length <= 1_200_000) {
      insert(source);
      return;
    }
    const image = new Image();
    image.onload = () => {
      const maxSide = 1280;
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        insert(source);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      insert(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => insert(source);
    image.src = source;
  };
  reader.readAsDataURL(file);
}

notesContainer.addEventListener('paste', (e) => {
  const editable = e.target.closest('.note-textarea');
  if (!editable || !e.clipboardData) return;
  const files = Array.from(e.clipboardData.files || [])
    .filter(file => file.type && file.type.indexOf('image/') === 0);
  if (!files.length) return;
  e.preventDefault();
  files.forEach(file => insertImageIntoNote(file, editable));
});

notesContainer.addEventListener('drop', (e) => {
  const editable = e.target.closest('.note-textarea');
  if (!editable || !e.dataTransfer) return;
  const files = Array.from(e.dataTransfer.files || [])
    .filter(file => file.type && file.type.indexOf('image/') === 0);
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  files.forEach(file => insertImageIntoNote(file, editable));
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
