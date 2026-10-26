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

// --- 图片粘贴 / 拖入 ---
// 图片不再以 base64 写进 localStorage（配额只有数 MB，几张截图就会整体写入失败），
// 改为：超过 2560px 才压缩 → 交给 Rust 落到应用数据目录 → HTML 里只留相对引用。
const MAX_IMAGE_SIDE = 2560;
const JPEG_QUALITY = 0.9;
const INLINE_CHAR_LIMIT = 2_400_000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解码失败'));
    image.src = src;
  });
}

function extensionOfDataUrl(dataUrl, fallback) {
  const match = /^data:image\/([a-z0-9.+-]+)/i.exec(dataUrl || '');
  const ext = match ? match[1].toLowerCase() : '';
  if (ext === 'jpeg') return 'jpg';
  if (['png', 'jpg', 'webp', 'gif', 'bmp'].indexOf(ext) !== -1) return ext;
  const fb = String(fallback || '').toLowerCase().replace('.', '');
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].indexOf(fb) !== -1
    ? (fb === 'jpeg' ? 'jpg' : fb)
    : 'png';
}

/** 按需压缩：仅当边长超过 2560px 或体积过大时才重编码为 JPEG。 */
async function prepareImage(file) {
  const original = await readFileAsDataUrl(file);
  const fallbackExt = extensionOfDataUrl(original, (file.name || '').split('.').pop());

  let image = null;
  try {
    image = await loadImageElement(original);
  } catch (_) {
    // 解码失败仍按原样保存，交给 WebView 自己处理。
    return { dataUrl: original, ext: fallbackExt };
  }

  const tooLarge = original.length > INLINE_CHAR_LIMIT;
  const oversized = image.width > MAX_IMAGE_SIDE || image.height > MAX_IMAGE_SIDE;
  if (!tooLarge && !oversized) {
    return { dataUrl: original, ext: fallbackExt };
  }

  const ratio = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * ratio));
  canvas.height = Math.max(1, Math.round(image.height * ratio));

  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl: original, ext: fallbackExt };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const compressed = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  if (!oversized && compressed.length >= original.length) {
    return { dataUrl: original, ext: fallbackExt };
  }
  return { dataUrl: compressed, ext: 'jpg' };
}

/** 取当前选区（必须落在便签编辑区内），异步插入前先保存，避免焦点漂移丢失光标。 */
function captureCaret(editable) {
  const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editable.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

function insertNodeAtRange(node, editable, savedRange) {
  const selection = shadow.getSelection ? shadow.getSelection() : window.getSelection();
  if (!savedRange || !selection || !editable.contains(savedRange.commonAncestorContainer)) {
    editable.appendChild(node);
    return;
  }
  selection.removeAllRanges();
  selection.addRange(savedRange);
  savedRange.deleteContents();
  savedRange.insertNode(node);
  savedRange.setStartAfter(node);
  savedRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(savedRange);
}

async function insertImageIntoNote(file, editable, savedRange) {
  if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
  try {
    const prepared = await prepareImage(file);
    const name = await invoke('save_image', {
      data: prepared.dataUrl,
      extension: prepared.ext
    });

    const img = document.createElement('img');
    img.setAttribute('data-image', name);
    img.setAttribute('draggable', 'false');
    img.setAttribute('alt', file.name || '图片');
    img.classList.add('note-image');
    img.title = '点击放大查看';
    const src = imageSrc(name);
    if (src) img.setAttribute('src', src);

    insertNodeAtRange(img, editable, savedRange);
    saveNotes();
  } catch (err) {
    console.error('插入图片失败:', err);
    showToast(`图片保存失败：${err && err.message ? err.message : err}`);
  }
}

notesContainer.addEventListener('paste', async (e) => {
  const editable = e.target.closest('.note-textarea');
  if (!editable || !e.clipboardData) return;
  const files = Array.from(e.clipboardData.files || [])
    .filter(file => file.type && file.type.indexOf('image/') === 0);
  if (!files.length) return;
  e.preventDefault();
  const savedRange = captureCaret(editable);
  // 串行插入：多张图共用同一个选区对象，并发会互相覆盖插入位置
  for (const file of files) {
    await insertImageIntoNote(file, editable, savedRange);
  }
});

notesContainer.addEventListener('drop', async (e) => {
  const editable = e.target.closest('.note-textarea');
  if (!editable || !e.dataTransfer) return;
  const files = Array.from(e.dataTransfer.files || [])
    .filter(file => file.type && file.type.indexOf('image/') === 0);
  if (!files.length) return;
  e.preventDefault();
  e.stopPropagation();
  const savedRange = captureCaret(editable);
  for (const file of files) {
    await insertImageIntoNote(file, editable, savedRange);
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
