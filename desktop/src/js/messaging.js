// ================================================================
//  messaging.js - 桌面版启动与托盘事件桥接
//  替代扩展的 background.js / messaging.js：
//    * 启动时加载便签并清理过期回收站
//    * 监听托盘菜单的 show-panel / new-note 事件
//    * 定时清理 7 天前的回收站内容
// ================================================================

async function handleTrayShowPanel() {
  await windowReady;
  await showPanel();
}

async function handleTrayNewNote() {
  await windowReady;
  await showPanel();
  // 等待窗口尺寸切换完成后再新建，确保输入框能正确聚焦
  setTimeout(() => {
    addNote();
  }, 220);
}

// 兜底回收：磁盘上存在、但没有任何便签（含回收站）引用的图片一律删除。
// 覆盖"用户在编辑器里手动删掉图片""异常退出"等无法精确追踪的场景。
async function gcOrphanImages() {
  try {
    const data = Store.get(['notes', 'deletedNotes']);
    // 安全护栏：存储读取异常时 notes 不是数组，此时 keep 会为空，
    // 若照常回收会把磁盘上的图片全部删掉，因此直接跳过。
    if (!Array.isArray(data.notes) && !Array.isArray(data.deletedNotes)) return;

    const keep = collectImageNames([
      ...(Array.isArray(data.notes) ? data.notes : []),
      ...(Array.isArray(data.deletedNotes) ? data.deletedNotes : [])
    ]);
    await invoke('gc_images', { keep });
  } catch (err) {
    console.error('回收孤儿图片失败:', err);
  }
}

async function bootDesktopApp() {
  try {
    await windowReady;
    await initImageBase();
    loadNotes();
    cleanupExpiredNotes();
    await gcOrphanImages();

    const eventApi = Tauri.event;
    if (eventApi && typeof eventApi.listen === 'function') {
      await eventApi.listen('show-panel', () => { handleTrayShowPanel(); });
      await eventApi.listen('new-note', () => { handleTrayNewNote(); });
    }

    // 每小时清理一次过期回收站内容
    setInterval(() => {
      cleanupExpiredNotes();
      if (typeof renderTrash === 'function' && trashDrawer.classList.contains('open')) {
        renderTrash();
      }
    }, 60 * 60 * 1000);
  } catch (err) {
    console.error('应用初始化失败:', err);
    showToast('应用初始化失败，请查看控制台日志');
  }
}

window.addEventListener('beforeunload', () => {
  if (typeof saveNotes === 'function') saveNotes();
});

bootDesktopApp();
