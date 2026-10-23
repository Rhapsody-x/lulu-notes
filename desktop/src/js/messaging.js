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

async function bootDesktopApp() {
  try {
    await windowReady;
    loadNotes();
    cleanupExpiredNotes();

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
