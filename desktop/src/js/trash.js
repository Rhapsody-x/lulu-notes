// ================================================================
//  trash.js - 回收站模块（桌面版）
//  负责：回收站抽屉开关/清空、拖拽入回收站、还原、彻底删除、
//       过期(7天)自动清理。数据存于 localStorage。
// ================================================================
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
  isLocalChange = true;
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
    isLocalChange = true;
    Store.set({ deletedNotes: deleted });
  }
}

const TRASH_RESTORE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
const TRASH_DELETE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

function renderTrash() {
  const data = Store.get(['deletedNotes']);
  const list = Array.isArray(data.deletedNotes) ? data.deletedNotes.slice() : [];
  trashList.innerHTML = list.length ? '' : '<div class="empty-tip">回收站是空的</div>';

  list.sort((a, b) => b.deletedAt - a.deletedAt).forEach(n => {
    const el = document.createElement('div');
    el.className = 'trash-item';
    const elapsedDays = Math.floor((Date.now() - n.deletedAt) / 86400000);
    const days = 7 - elapsedDays;

    el.innerHTML = `
      <div class="trash-content">${n.content || '无内容'}</div>
      <div class="trash-meta">
        <span>剩余${days > 0 ? days : 0}天</span>
        <div style="display: flex; gap: 6px;">
          <button class="mini-btn btn-restore" title="还原">${TRASH_RESTORE_ICON}</button>
          <button class="mini-btn btn-delete" title="彻底删除">${TRASH_DELETE_ICON}</button>
        </div>
      </div>
    `;

    el.querySelector('.btn-restore').addEventListener('click', () => {
      saveNotes(); // 先保存当前编辑，再恢复，避免覆盖未落盘内容
      const current = Store.get(['notes', 'deletedNotes']);
      const mainNotes = Array.isArray(current.notes) ? current.notes : [];
      const deletedNotes = Array.isArray(current.deletedNotes) ? current.deletedNotes : [];
      const restored = Object.assign({}, n);
      delete restored.deletedAt;
      if (!mainNotes.some(item => item.id === restored.id)) {
        mainNotes.push(restored);
      }
      isLocalChange = true;
      Store.set({
        notes: mainNotes,
        deletedNotes: deletedNotes.filter(item => item.id !== n.id)
      });
      renderTrash();
      loadNotes();
    });

    el.querySelector('.btn-delete').addEventListener('click', () => {
      const current = Store.get(['deletedNotes']);
      const deletedNotes = Array.isArray(current.deletedNotes) ? current.deletedNotes : [];
      isLocalChange = true;
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
  const fresh = deleted.filter(n => !n.deletedAt || (now - n.deletedAt < SEVEN_DAYS_MS));
  if (fresh.length !== deleted.length) {
    isLocalChange = true;
    Store.set({ deletedNotes: fresh });
  }
}
