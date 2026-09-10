// ================================================================
//  trash.js - 回收站模块
//  负责：回收站抽屉开关/清空、拖拽入回收站、还原、彻底删除、
//       过期(7天)自动清理。
// ================================================================
// 回收站保留期限：7 天
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// --- 回收站 ---
function openTrash() {
  cleanupExpiredNotes(); // 打开时先清理过期便签
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
  chrome.storage.local.set({ deletedNotes: [] }, renderTrash);
});

trashZone.addEventListener('dragover', e => { e.preventDefault(); trashZone.classList.add('drag-over'); });
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

function moveToTrash(id) {
  chrome.storage.local.get(['notes', 'deletedNotes'], res => {
    const notes = res.notes || [];
    const deleted = res.deletedNotes || [];
    const target = notes.find(n => n.id === id);
    if (target) {
      target.deletedAt = Date.now();
      deleted.push(target);
      isLocalChange = true;
      chrome.storage.local.set({ deletedNotes: deleted });
    }
  });
}

function renderTrash() {
  chrome.storage.local.get(['deletedNotes'], res => {
    const list = res.deletedNotes || [];
    trashList.innerHTML = list.length ? '' : '<div class="empty-tip">回收站是空的</div>';
    list.sort((a,b) => b.deletedAt - a.deletedAt).forEach(n => {
      const el = document.createElement('div');
      el.className = 'trash-item';
      const days = 7 - Math.floor((Date.now() - n.deletedAt)/86400000);
      // 准备还原图标 (撤销/重置 SVG) 和彻底删除图标 (垃圾桶 SVG)
      const restoreIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>`;
      const deleteIcon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

      el.innerHTML = `
        <div class="trash-content">${n.content || '无内容'}</div>
        <div class="trash-meta">
          <span>剩余${days>0?days:0}天</span>
          <div style="display: flex; gap: 6px;">
            <button class="mini-btn btn-restore" title="还原">${restoreIcon}</button>
            <button class="mini-btn btn-delete" title="彻底删除">${deleteIcon}</button>
          </div>
        </div>
      `;
      el.querySelector('.btn-restore').addEventListener('click', () => {
        chrome.storage.local.get(['notes'], r => {
          const mainNotes = r.notes || [];
          delete n.deletedAt;
          mainNotes.push(n);
          isLocalChange = true;
          chrome.storage.local.set({
            notes: mainNotes,
            deletedNotes: list.filter(x => x.id !== n.id)
          }, () => { renderTrash(); loadNotes(); });
        });
      });
      el.querySelector('.btn-delete').addEventListener('click', () => {
        isLocalChange = true;
        chrome.storage.local.set({
          deletedNotes: list.filter(x => x.id !== n.id)
        }, renderTrash);
      });
      trashList.appendChild(el);
    });
  });
}

function cleanupExpiredNotes() {
  chrome.storage.local.get(['deletedNotes'], res => {
    const deleted = res.deletedNotes || [];
    const now = Date.now();
    const fresh = deleted.filter(n => !n.deletedAt || (now - n.deletedAt < SEVEN_DAYS_MS));
    if(fresh.length !== deleted.length) {
      isLocalChange = true;
      chrome.storage.local.set({ deletedNotes: fresh });
    }
  });
}
