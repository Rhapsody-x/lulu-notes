// ================================================================
//  notes.js - 便签数据核心逻辑
//  负责：按钮图标库(ICONS)、新建/加载/渲染便签卡片、内容编辑、
//       置顶优先级排序、拖拽排序、DOM->storage 保存(saveNotes)。
// ================================================================
// 图标库
const ICONS = {
  chevronUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`,
  pinFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>`
};

// 新建按钮
addBtn.addEventListener('click', addNote);

// --- 列表排序 ---
notesContainer.addEventListener('dragover', e => {
  e.preventDefault();
  const afterElement = getDragAfterElement(notesContainer, e.clientY);
  const draggable = shadow.querySelector('.dragging');
  if (draggable) {
    if (afterElement == null) notesContainer.appendChild(draggable);
    else notesContainer.insertBefore(draggable, afterElement);
  }
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.note-card:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
    else return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- 核心业务 ---
function loadNotes() {
  chrome.storage.local.get(['notes'], (result) => {
    const notes = result.notes || [];
    notesContainer.innerHTML = '';
    notes.forEach(note => {
      createNoteElement(note.id, note.content, note.timestamp, false, true, note.isPinned || false);
    });
    reorderNotes(); // 加载后强制按置顶状态排序
  });
}

function addNote() {
  const noteObject = {
    id: Date.now(),
    content: "",
    timestamp: new Date().toLocaleString()
  };
  createNoteElement(noteObject.id, noteObject.content, noteObject.timestamp, true, false, false);
  saveNotes();
}

function createNoteElement(id, content, timestamp, isNew = false, shouldCollapse = false, isPinned = false) {
  const noteDiv = document.createElement('div');
  noteDiv.classList.add('note-card');
  noteDiv.dataset.id = id;
  noteDiv.dataset.pinned = isPinned;
  noteDiv.dataset.timestamp = timestamp; // 存储完整时间戳
  if (isPinned) noteDiv.classList.add('pinned');
  noteDiv.setAttribute('draggable', 'true');

  noteDiv.addEventListener('dragstart', () => noteDiv.classList.add('dragging'));
  noteDiv.addEventListener('dragend', () => {
    noteDiv.classList.remove('dragging');
    reorderNotes(); // 拖拽后重新按置顶优先级排序
    saveNotes();
  });

  if (shouldCollapse && content.length > 50) noteDiv.classList.add('collapsed');

  // 置顶按钮
  const pinBtn = document.createElement('button');
  pinBtn.className = 'icon-btn btn-pin';
  pinBtn.title = isPinned ? '取消固定' : '固定便签';
  pinBtn.innerHTML = isPinned ? ICONS.pinFilled : ICONS.pin;
  if(isPinned) pinBtn.classList.add('active');

  pinBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const currentPinned = noteDiv.dataset.pinned === 'true';
    const newPinned = !currentPinned;
    noteDiv.dataset.pinned = newPinned;
    if (newPinned) {
      noteDiv.classList.add('pinned');
      pinBtn.classList.add('active');
      pinBtn.innerHTML = ICONS.pinFilled;
    } else {
      noteDiv.classList.remove('pinned');
      pinBtn.classList.remove('active');
      pinBtn.innerHTML = ICONS.pin;
    }
    reorderNotes();
    saveNotes();
  });
  noteDiv.appendChild(pinBtn);

  // 升级为 contenteditable 富文本可编辑 div
  const textarea = document.createElement('div');
  textarea.classList.add('note-textarea');
  textarea.setAttribute('contenteditable', 'true');
  textarea.setAttribute('placeholder', '记点什么...');
  textarea.innerHTML = content;

  // 右上角操作
  const actionsDiv = document.createElement('div');
  actionsDiv.classList.add('card-actions');
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'icon-btn';
  toggleBtn.innerHTML = noteDiv.classList.contains('collapsed') ? ICONS.chevronDown : ICONS.chevronUp;
  toggleBtn.addEventListener('click', () => {
    const isC = noteDiv.classList.toggle('collapsed');
    toggleBtn.innerHTML = isC ? ICONS.chevronDown : ICONS.chevronUp;
  });
  actionsDiv.appendChild(toggleBtn);
  noteDiv.appendChild(actionsDiv);

  // 底部栏
  const footer = document.createElement('div');
  footer.className = 'note-footer';
  const dateSpan = document.createElement('span');
  dateSpan.className = 'note-date';
  dateSpan.innerText = timestamp.split(' ')[0]; // 仅显示日期

  const btnGroup = document.createElement('div');
  btnGroup.style.display = 'flex'; btnGroup.style.alignItems = 'center';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn btn-copy';
  copyBtn.innerHTML = ICONS.copy;
  copyBtn.addEventListener('click', () => {
    // 拷贝时过滤 HTML tags 导出干净的纯文本
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = textarea.innerHTML;
    const textToCopy = tempDiv.innerText || tempDiv.textContent || "";

    // 👈 兼容 HTTP / HTTPS 双环境：非安全上下文(内网 IP 的 http 页面)下 navigator.clipboard 为 undefined，降级用 execCommand
    const copyToClipboard = (text) => {
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
      } else {
        return new Promise((resolve, reject) => {
          const tempInput = document.createElement('textarea');
          tempInput.value = text;
          tempInput.style.position = 'fixed';
          tempInput.style.opacity = '0';
          tempInput.style.left = '-9999px';
          document.body.appendChild(tempInput);
          tempInput.select();
          const success = document.execCommand('copy');
          document.body.removeChild(tempInput);
          if (success) resolve();
          else reject(new Error('复制失败'));
        });
      }
    };

    copyToClipboard(textToCopy).then(() => {
      copyBtn.innerHTML = ICONS.check;
      copyBtn.classList.add('success');
      setTimeout(() => {
        copyBtn.innerHTML = ICONS.copy;
        copyBtn.classList.remove('success');
      }, 2000);
    }).catch(err => {
      console.error('复制出错:', err);
    });
  });

  const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn delete-btn';
    delBtn.innerHTML = ICONS.trash;
    delBtn.addEventListener('click', () => {
      noteDiv.classList.add('anim-leave');
      noteDiv.addEventListener('animationend', () => {
        moveToTrash(id);
        noteDiv.remove();
        saveNotes();
      }, { once: true });
    });

  btnGroup.appendChild(copyBtn);
  btnGroup.appendChild(delBtn);
  footer.appendChild(dateSpan);
  footer.appendChild(btnGroup);
  noteDiv.appendChild(textarea);
  noteDiv.appendChild(footer);

  textarea.addEventListener('focus', () => {
    if(noteDiv.classList.contains('collapsed')) {
      noteDiv.classList.remove('collapsed');
      toggleBtn.innerHTML = ICONS.chevronUp;
    }
  });

  // 输入监听
  textarea.addEventListener('input', () => {
    saveNotes();
  });

  if (isNew) {
    noteDiv.classList.add('anim-enter');
    noteDiv.addEventListener('animationend', () => noteDiv.classList.remove('anim-enter'), { once: true });
    notesContainer.prepend(noteDiv);
    reorderNotes();
    textarea.focus(); // 新建自动聚焦
  } else {
    notesContainer.appendChild(noteDiv);
  }
}

function reorderNotes() {
  const cards = Array.from(notesContainer.children);
  cards.sort((a, b) => {
    const aPinned = a.dataset.pinned === 'true';
    const bPinned = b.dataset.pinned === 'true';
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });
  cards.forEach(card => notesContainer.appendChild(card));
}

// 保存逻辑
function saveNotes() {
  const notes = [];
  shadow.querySelectorAll('.note-card').forEach(card => {
    const editArea = card.querySelector('.note-textarea');
    notes.push({
      id: parseInt(card.dataset.id),
      content: editArea ? editArea.innerHTML : "",
      timestamp: card.dataset.timestamp,
      isPinned: card.dataset.pinned === 'true'
    });
  });
  isLocalChange = true;
  chrome.storage.local.set({ notes: notes });
}
