// ================================================================
//  messaging.js - 启动引导与消息同步（须在其他模块之后加载）
//  负责：首次载入便签列表、清理过期回收站条目、storage 变化跨标签
//       同步、工具栏图标 togglePanel 消息响应。
// ================================================================
// 启动：加载便签列表并清理已过期的回收站条目
loadNotes();
cleanupExpiredNotes();

// 多标签页数据/状态同步监听
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  // 1. 实时同步面板的 展开 / 最小化 状态
  if (changes.panelOpen) {
    const shouldBeOpen = changes.panelOpen.newValue;
    const isCurrentlyOpen = !mainPanel.classList.contains('closed');
    if (shouldBeOpen !== isCurrentlyOpen) {
      if (shouldBeOpen) {
        showPanel();
      } else {
        hidePanel();
      }
    }
  }

  // 2. 本地触发的便签数据更新，过滤掉避免重复渲染影响输入光标
  if (isLocalChange) {
    isLocalChange = false;
    return;
  }
  if (changes.notes) loadNotes();
  if (changes.deletedNotes) renderTrash();
});

// 监听工具栏图标消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'togglePanel') {
    // 清除右键隐藏状态，确保元素可显示
    toggleBubble.style.display = '';

    if (mainPanel.classList.contains('closed')) {
      showPanel();
    } else {
      hidePanel();
    }
    sendResponse({ success: true });
  }
  return true;
});
