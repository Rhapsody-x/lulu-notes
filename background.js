// background.js - 工具栏图标控制面板显隐
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (err) {
    // 部分特殊页面（如 chrome://、扩展管理页）无法注入，静默失败
    console.log('当前页面无法使用悬浮便签');
  }
});