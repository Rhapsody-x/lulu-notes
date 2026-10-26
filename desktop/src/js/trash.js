// ================================================================
//  trash.js - 回收站模块（桌面版）
//  负责：回收站抽屉开关/清空、拖拽入回收站、还原、彻底删除、
//       过期(7天)自动清理。数据存于 localStorage。
// ================================================================
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// --- 图片文件的生命周期 ---
// 便签被彻底删除（手动删除 / 清空回收站 / 7 天过期）时，一并删掉它引用的图片文件，
// 否则磁盘上会不断堆积无人引用的孤儿文件。
function collectImageNames(notes) {
  const names = [];
  (notes || []).forEach(note => {
    imageNamesFromHtml(note && note.content).forEach(name => {
      if (names.indexOf(name) === -1) names.push(name);
    });
  });
  return names;
}

function purgeImagesOf(notes) {
  const names = collectImageNames(notes);
  if (!names.length) return;
  invoke('delete_images', { names }).catch(err => {
    console.error('删除图片文件失败:', err);
  });
}

function openTrash() {
  cleanupExpiredNotes();
  renderTrash();
  trashDrawer.classList.add('open');
  innerBackdrop.classList.add('active');
}
function closeTrash() {
  trashDrawer.classList.remove('open');
  innerBackdrop.classList.remove('active');
}

trashZone.addEventListener('click', openTrash);
closeTrashBtn.addEventListener('click', closeTrash);

clearTrashBtn.addEventListener('click', () => {
  const current = Store.get(['deletedNotes']);
  const removed = Array.isArray(current.deletedNotes) ? current.deletedNotes : [];
  purgeImagesOf(removed);
  Store.set({ deletedNotes: [] });
  renderTrash();
});

trashZone.addEventListener('dragover', e => {
  e.preventDefault();
  trashZone.classList.add('drag-over');
});
trashZone.addEventListener('dragleave', () => trashZone.classList.remove('drag-over'));
trashZone.addEventListener('drop', e => {
  e.preventDefault();
  trashZone.classList.remove('drag-over');
  const draggable = shadow.querySelector('.dragging');
  if (draggable) {
    moveToTrash(parseInt(draggable.dataset.id));
    draggable.remove();
    saveNotes();
  }
});

function findNoteCard(id) {
  return Array.from(notesContainer.querySelectorAll('.note-card'))
    .find(card => parseInt(card.dataset.id) === id);
}

function moveToTrash(id) {
  const card = findNoteCard(id);
  const data = Store.get(['notes', 'deletedNotes']);
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const deleted = (Array.isArray(data.deletedNotes) ? data.deletedNotes : [])
    .filter(n => n.id !== id);

  // 优先使用卡片当前的编辑内容，避免未落盘的修改丢失
  let target = null;
  if (card) {
    const editArea = card.querySelector('.note-textarea');
    target = {
      id: parseInt(card.dataset.id),
      content: editArea ? editArea.innerHTML : '',
      timestamp: card.dataset.timestamp,
      isPinned: card.dataset.pinned === 'true'
    };
  } else {
    target = notes.find(n => n.id === id);
  }

  if (target) {
    target.deletedAt = Date.now();
    deleted.push(target);
    Store.set({ deletedNotes: deleted });
  }
}

const TRASH_RESTORE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
const TRASH_DELETE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

function renderTrash() {
  const data = Store.get(['deletedNotes']);
  const list = Array.isArray(data.deletedNotes) ? data.deletedNotes.slice() : [];
  trashList.innerHTML = list.length ? '' : '<div class="empty-tip">回收站是空的</div>';

  list.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).forEach(n => {
    const el = document.createElement('div');
    el.className = 'trash-item';

    // 缺失 deletedAt 的历史数据按"刚删除"处理，避免出现"剩余 NaN 天"
    const deletedAt = Number.isFinite(n.deletedAt) ? n.deletedAt : Date.now();
    const elapsedDays = Math.floor((Date.now() - deletedAt) / 86400000);
    const days = Math.max(0, 7 - elapsedDays);

    // 预览统一取纯文本：避免把便签里的 HTML 结构（含导入备份中的未知标签）
    // 直接注入到回收站列表中。
    const preview = document.createElement('div');
    preview.className = 'trash-content';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = n.content || '';
    preview.textContent = tempDiv.innerText || tempDiv.textContent || '无内容';

    const meta = document.createElement('div');
    meta.className = 'trash-meta';

    const remain = document.createElement('span');
    remain.textContent = `剩余${days}天`;

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'mini-btn btn-restore';
    restoreBtn.title = '还原';
    restoreBtn.innerHTML = TRASH_RESTORE_ICON;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'mini-btn btn-delete';
    deleteBtn.title = '彻底删除';
    deleteBtn.innerHTML = TRASH_DELETE_ICON;

    btnGroup.appendChild(restoreBtn);
    btnGroup.appendChild(deleteBtn);
    meta.appendChild(remain);
    meta.appendChild(btnGroup);
    el.appendChild(preview);
    el.appendChild(meta);

    restoreBtn.addEventListener('click', () => {
      saveNotes(); // 先保存当前编辑，再恢复，避免覆盖未落盘内容
      const current = Store.get(['notes', 'deletedNotes']);
      const mainNotes = Array.isArray(current.notes) ? current.notes : [];
      const deletedNotes = Array.isArray(current.deletedNotes) ? current.deletedNotes : [];
      const restored = Object.assign({}, n);
      delete restored.deletedAt;
      if (!mainNotes.some(item => item.id === restored.id)) {
        mainNotes.push(restored);
      }
      Store.set({
        notes: mainNotes,
        deletedNotes: deletedNotes.filter(item => item.id !== n.id)
      });
      renderTrash();
      loadNotes();
    });

    deleteBtn.addEventListener('click', () => {
      const current = Store.get(['deletedNotes']);
      const deletedNotes = Array.isArray(current.deletedNotes) ? current.deletedNotes : [];
      purgeImagesOf([n]);
      Store.set({ deletedNotes: deletedNotes.filter(item => item.id !== n.id) });
      renderTrash();
    });

    trashList.appendChild(el);
  });
}

function cleanupExpiredNotes() {
  const data = Store.get(['deletedNotes']);
  const deleted = Array.isArray(data.deletedNotes) ? data.deletedNotes : [];
  const now = Date.now();
  // 无 deletedAt 的历史数据保留，不做猜测性清理。
  const expired = deleted.filter(n => n.deletedAt && now - n.deletedAt >= SEVEN_DAYS_MS);
  const fresh = deleted.filter(n => !n.deletedAt || now - n.deletedAt < SEVEN_DAYS_MS);
  if (fresh.length !== deleted.length) {
    purgeImagesOf(expired);
    Store.set({ deletedNotes: fresh });
  }
}
