// ================================================================
//  styles.js - 全部 UI 样式常量（天蓝色主题）
//  说明：样式集中管理并以 APP_STYLES 常量导出，由 dom.js 注入 Shadow DOM。
// ================================================================
const APP_STYLES = `
  :host { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; box-sizing: border-box; color: #333; }
  * { box-sizing: border-box; }

  /* --- 悬浮开关（外层自适应包裹，去除任何强行挤压） --- */
  #toggle-bubble {
    position: fixed; 
    bottom: -8px; /* 👈 根据您的图片留白，这里设为 -8px 可以让水豚完美贴底，可微调 */
    left: 50%;
    right: auto; /* ⚠️ 不能加 !important：否则 side-dock 模式下 JS 内联 right:0 会被压掉 */
    top: auto;   /* ⚠️ 不能加 !important：否则 side-dock 模式下 JS 内联 top（Y 轴拖拽）会被压掉 */
    width: auto;  /* 👈 宽设为 auto，让容器宽度自动适应水豚 */
    height: auto; /* 👈 高设为 auto，让容器高度自动适应水豚 */
    background: transparent; 
    border: none;            
    box-shadow: none;        
    cursor: grab; 
    display: flex; 
    align-items: flex-end;   
    justify-content: center; 
    z-index: 1000;
    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
    user-select: none;
  }
  #toggle-bubble:hover { 
    transform: scale(1.18); /* 悬浮时图标灵动变大 18% */
  }
  #toggle-bubble:active { 
    cursor: grabbing; 
    transform: scale(0.92);  /* 鼠标按住时轻微回缩 */
  }
  #toggle-bubble.hidden { display: none; }

  /* --- 水豚 PNG 图标样式表：在这里直接、方便地控制大小 --- */
  #bubble-icon-img {
    width: 46px;  /* 👈 在这里直接修改水豚的宽度（例如改为 50px ）。改完这一处，全身自动等比缩放！ */
    height: auto; /* 👈 永远设为 auto，确保比例极其完美，绝不扁塌，绝不裁剪 */
    display: inline-block;
    pointer-events: none;
    object-fit: contain;
    /* 半硬边：4px 偏移 + 2px 极小模糊（既不像 16px 那样糊成一团，也不是死硬的贴纸边） */
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.15));
  }

  /* --- 备用 SVG 矢量图标样式表 --- */
  #bubble-icon-svg {
    width: 32px;
    height: 32px;
    display: none;
    pointer-events: none;
    margin: auto;
    filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.15));
  }

  /* --- 主面板（天蓝色渐变） --- */
  #main-panel {
    position: fixed; top: 20px; right: 20px;
    width: 360px; height: 80vh; max-height: 800px;
    overflow: hidden;
    background: linear-gradient(135deg, #E3F2FD 0%, #90CAF9 100%);
    border: 1px solid rgba(255, 255, 255, 0.8);
    border-radius: 24px;
    /* 极轻光晕：层1 为 0 尺寸（不可见，仅保留双层结构），实际生效的是层2 的 2px 微模糊 + 6% 透明 */
    box-shadow: 0 0 0 rgba(0, 0, 0, 0.12), 0 0 2px rgba(0, 0, 0, 0.06);
    display: flex; flex-direction: column; padding: 0;

    /* 👈 初始正常位置（水平平移为主，不再做中心缩放） */
    transform: translateX(0);
    /* 👈 丝滑阻尼缓动：平移与透明度淡入淡出同时进行 */
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease, visibility 0.3s;
    opacity: 1; visibility: visible;
  }
  #main-panel.closed {
    opacity: 0;
    visibility: hidden;
    /* 👈 关闭/最小化：向右滑出 60px 并淡出；展开时反向向左滑入 */
    transform: translateX(60px) !important;
    pointer-events: none;
  }

  /* --- 头部 --- */
/* --- 左上角搜索交互样式 --- */
  .header-left {
    display: flex;
    align-items: center;
    position: relative;
    z-index: 5;
  }

  #search-btn {
    background: rgba(255, 255, 255, 0.6);
    color: #0D47A1;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.8);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
    transition: all 0.2s ease;
    backdrop-filter: blur(4px);
    flex-shrink: 0;
  }
  #search-btn:hover {
    background: #ffffff;
    transform: scale(1.1);
  }

  /* 伸缩搜索框 */
  #search-input {
    width: 0;
    opacity: 0;
    pointer-events: none;
    padding: 0;
    margin-left: 0;
    border: 1px solid rgba(255, 255, 255, 0.8);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(8px);
    font-size: 13px;
    color: #0D47A1;
    outline: none;
    transition: width 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, margin-left 0.3s ease, padding 0.3s ease;
  }
  #search-input::placeholder {
    color: #90CAF9;
    font-size: 12px;
  }

  /* 搜索框激活展开状态 */
  .header-left.searching #search-input {
    width: 165px;
    opacity: 1;
    pointer-events: auto;
    margin-left: 8px;
    padding: 6px 12px;
    box-shadow: 0 4px 12px rgba(13, 71, 161, 0.08);
  }
  .header-left.searching #search-btn {
    background: #ffffff;
    color: #1976D2;
  }

  /* 搜索不匹配的卡片隐藏 */
  .note-card.search-hidden {
    display: none !important;
  }

  .header { 
    padding: 16px 20px; 
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
    cursor: move;
    user-select: none;
  }
  .header h2 { margin: 0; font-size: 20px; font-weight: 700; color: #0D47A1; text-shadow: 0 1px 2px rgba(255,255,255,0.5); pointer-events: none; }
  .header-actions { display: flex; gap: 8px; align-items: center; position: relative; }
  .header-actions button { pointer-events: auto; cursor: pointer; } 

  #add-btn {
    background: rgba(255,255,255,0.6); color: #0D47A1; width: 32px; height: 32px; 
    border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.8);
    cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: all 0.2s; backdrop-filter: blur(4px);
  }
  #add-btn:hover { background: #fff; transform: scale(1.1); }

  .btn-minimize { background: transparent; border: none; cursor: pointer; color: #1565C0; padding: 4px; display: flex; align-items: center; }
  .btn-minimize:hover { color: #0D47A1; background: rgba(0,0,0,0.05); border-radius: 6px;}
  #menu-btn {
    background: transparent; border: none; cursor: pointer; color: #1565C0; width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;
  }
  #menu-btn:hover { background: rgba(0,0,0,0.05); color: #0D47A1; }
  
  .dropdown-menu {
    position: absolute; top: 110%; right: 0; background: white; border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15); border: 1px solid rgba(0,0,0,0.05);
    padding: 6px; min-width: 150px; z-index: 100; cursor: default;
    opacity: 0; visibility: hidden; transform: translateY(-10px);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .dropdown-menu.show { opacity: 1; visibility: visible; transform: translateY(0); }
  
  .dropdown-item {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px;
    border: none; background: transparent; text-align: left; font-size: 13px;
    color: #555; cursor: pointer; border-radius: 8px; transition: background 0.2s;
  }
  .dropdown-item:hover { background: #E3F2FD; color: #0D47A1; }
  .dropdown-item svg { width: 14px; height: 14px; color: #90CAF9; }

  /* --- 列表区域与隐藏式滚动条设计 --- */
  #notes-container { 
    flex: 1; 
    overflow-y: auto; 
    padding: 10px 20px 80px 20px; 
    position: relative; 
    
    /* Firefox 兼容性支持 */
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
    transition: scrollbar-color 0.3s ease;
  }
  #notes-container:hover {
    scrollbar-color: rgba(13, 71, 161, 0.25) transparent;
  }

  /* Webkit 内核浏览器优雅隐藏式滚动条 */
  #notes-container::-webkit-scrollbar,
  .trash-list::-webkit-scrollbar,
  .export-list::-webkit-scrollbar {
    width: 6px; 
  }
  #notes-container::-webkit-scrollbar-track,
  .trash-list::-webkit-scrollbar-track,
  .export-list::-webkit-scrollbar-track {
    background: transparent; 
  }
  #notes-container::-webkit-scrollbar-thumb,
  .trash-list::-webkit-scrollbar-thumb,
  .export-list::-webkit-scrollbar-thumb {
    background: transparent; 
    border-radius: 10px;
    transition: background-color 0.3s ease;
  }
  #notes-container:hover::-webkit-scrollbar-thumb,
  .trash-list:hover::-webkit-scrollbar-thumb,
  .export-list:hover::-webkit-scrollbar-thumb {
    background: rgba(13, 71, 161, 0.25); 
  }
  #notes-container::-webkit-scrollbar-thumb:hover,
  .trash-list::-webkit-scrollbar-thumb:hover,
  .export-list::-webkit-scrollbar-thumb:hover {
    background: rgba(13, 71, 161, 0.45) !important;
  }

  /* --- 便签卡片 --- */
  .note-card {
    position: relative; background: rgba(255, 255, 255, 0.55);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.8); border-radius: 20px; 
    padding: 20px; margin-bottom: 20px;
    transition: transform 0.2s, background 0.2s, box-shadow 0.2s; 
    box-shadow: 0 8px 32px -4px rgba(21, 101, 192, 0.08);
  }
  .note-card:hover { transform: translateY(-4px); background: rgba(255, 255, 255, 0.75); box-shadow: 0 12px 40px -4px rgba(21, 101, 192, 0.15); }
  .note-card.dragging { opacity: 0.6; border: 2px dashed #1976D2; transform: scale(0.95); cursor: move; background: rgba(255,255,255,0.3); }
  .note-card.pinned { border-color: #1976D2; background: rgba(255, 255, 255, 0.98); box-shadow: 0 4px 12px rgba(21, 101, 192, 0.12); z-index: 2; }

  /* 富文本编辑区域样式 */
  .note-textarea {
    width: 100%; border: none; background: transparent; outline: none;
    font-family: inherit; font-size: 15px; line-height: 1.7; color: #1A237E;
    min-height: 60px; height: auto; padding-right: 5px; padding-top: 24px; 
    white-space: pre-wrap; 
    word-break: break-word;
    cursor: text;
    -webkit-user-select: text;
    user-select: text;
  }
  #search-input {
    -webkit-user-select: text;
    user-select: text;
  }
  .note-textarea:empty:before {
    content: attr(placeholder);
    color: rgba(21, 101, 192, 0.35);
    cursor: text;
  }
  .note-textarea img {
    display: block; max-width: 100%; height: auto;
    margin: 6px 0; border-radius: 8px;
  }
  /* 可点击放大的图片：给出明确的放大光标与悬停反馈 */
  .note-textarea img.note-image {
    cursor: zoom-in;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }
  .note-textarea img.note-image:hover {
    transform: scale(1.015);
    box-shadow: 0 6px 18px -6px rgba(21, 101, 192, 0.45);
  }
  .note-card.collapsed .note-textarea {
    max-height: 80px; overflow-y: hidden !important; 
    mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
  }

  /* 富文本选择变色悬浮菜单 */
  #color-tooltip {
    position: fixed;
    background: #ffffff;
    border: 1px solid rgba(25, 118, 210, 0.12);
    border-radius: 18px;
    box-shadow: 0 8px 24px rgba(13, 71, 161, 0.15);
    padding: 6px 10px;
    display: none;
    gap: 8px;
    z-index: 2147483647;
    align-items: center;
    pointer-events: auto;
  }
  .color-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    cursor: pointer;
    border: 1px solid rgba(0, 0, 0, 0.08);
    transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }
  .color-dot:hover {
    transform: scale(1.25);
  }

  .icon-btn { background: transparent; border: none; cursor: pointer; color: #64B5F6; padding: 0; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 8px; transition: all 0.2s; }
  .icon-btn:hover { color: #0D47A1; background: rgba(21, 101, 192, 0.08); transform: scale(1.1); }
  .icon-btn svg { width: 16px; height: 16px; stroke-width: 2px; }

  .card-actions { position: absolute; top: 12px; right: 12px; display: flex; align-items: center; z-index: 10; }
  .btn-pin { position: absolute; top: 12px; left: 12px; z-index: 10; color: #90CAF9; transition: all 0.2s; opacity: 0.6; }
  .btn-pin:hover { color: #1976D2; opacity: 1; transform: scale(1.1); background: transparent; }
  .btn-pin.active { color: #1976D2; opacity: 1; }

  .note-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(21, 101, 192, 0.08); }
  .note-date { font-size: 11px; color: #1565C0; font-weight: 500; opacity: 0.7; }
  .btn-copy { margin-right: 8px; }
  .btn-copy:hover { color: #1976D2; background: rgba(25, 118, 210, 0.1); }
  .btn-copy.success { color: #2ecc71; pointer-events: none; }
  .delete-btn:hover { color: #e74c3c; background: rgba(231, 76, 60, 0.1); }

  @keyframes noteSlideIn { 0% { opacity: 0; transform: translateY(-30px); } 100% { opacity: 1; transform: translateY(0); } }
  @keyframes noteSlideOut { 0% { opacity: 1; max-height: 180px; margin-bottom: 16px; padding-top: 20px; padding-bottom: 20px; border-width: 1px; } 30% { opacity: 0; } 100% { opacity: 0; max-height: 0; margin-bottom: 0; padding-top: 0; padding-bottom: 0; border-width: 0; } }
  .note-card.anim-enter { animation: noteSlideIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
  .note-card.anim-leave { animation: noteSlideOut 0.25s linear forwards; overflow: hidden; pointer-events: none; transform-origin: top; }

  /* 回收站 UI */
  #trash-zone { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: 140px; height: 44px; background: rgba(255,255,255,0.8); backdrop-filter: blur(10px); border-radius: 22px; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); border: 1px solid rgba(255,255,255,1); color: #666; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; z-index: 5; }
  #trash-zone:hover { width: 150px; color: #333; box-shadow: 0 6px 20px rgba(0,0,0,0.12); }
  #trash-zone.drag-over { background: #ffebee; color: #e74c3c; border-color: #e74c3c; transform: translateX(-50%) scale(1.1); }

  #inner-backdrop { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.1); opacity: 0; pointer-events: none; transition: opacity 0.3s; z-index: 10; }
  #inner-backdrop.active { opacity: 1; pointer-events: auto; }

  #trash-drawer { position: absolute; bottom: 0; left: 0; right: 0; height: 90%; background: #ffffff; border-radius: 24px 24px 0 0; box-shadow: 0 -10px 30px rgba(0,0,0,0.05); transform: translateY(100%); transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); z-index: 20; display: flex; flex-direction: column; padding: 0; }
  #trash-drawer.open { transform: translateY(0); }

  .trash-header { padding: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f5f5f5; }
  .trash-header h3 { margin: 0; font-size: 16px; color: #333; }
  .trash-header-btns { display: flex; gap: 8px; }
  
  .trash-list { 
    flex: 1; 
    overflow-y: auto; 
    padding: 20px; 
    background: #fafafa;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
    transition: scrollbar-color 0.3s ease;
  }
  .trash-list:hover {
    scrollbar-color: rgba(13, 71, 161, 0.25) transparent;
  }
  
  .trash-item { background: #fff; padding: 12px; border-radius: 12px; margin-bottom: 10px; border: 1px solid #eee; border-left: 3px solid #ccc; transition: all 0.2s; }
  .trash-item:hover { border-left-color: #1976D2; box-shadow: 0 2px 8px rgba(25, 118, 210, 0.08); }
  .trash-content { font-size: 13px; color: #555; margin-bottom: 8px; line-height: 1.4; }
  .trash-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #bbb; }

  /* 将按钮改为 Flex 居中对齐图标的正方形/圆角小按钮 */
  .mini-btn { 
    border: none; 
    border-radius: 8px; 
    width: 28px; 
    height: 28px; 
    padding: 0; 
    display: inline-flex; 
    align-items: center; 
    justify-content: center; 
    cursor: pointer; 
    transition: all 0.2s; 
  }
  .btn-restore { background: #e8f8f5; color: #27ae60; } 
  .btn-restore:hover { background: #27ae60; color: white; transform: scale(1.08); }
  .btn-delete { background: #fdedec; color: #e74c3c; } 
  .btn-delete:hover { background: #e74c3c; color: white; transform: scale(1.08); }
  .btn-close-trash { background: #f5f5f5; color: #666; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 18px; border:none; cursor: pointer; }
  .empty-tip { text-align: center; color: #ccc; margin-top: 40px; font-size: 13px; }

  /* --- 自定义选择 Word 导出面板重新设计 --- */
  #export-drawer { 
    position: absolute; 
    bottom: 0; left: 0; right: 0; 
    height: 90%; 
    background: rgba(255, 255, 255, 0.97); 
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-radius: 28px 28px 0 0; 
    border-top: 1px solid rgba(255, 255, 255, 0.5);
    box-shadow: 0 -15px 40px rgba(13, 71, 161, 0.12); 
    transform: translateY(100%); 
    transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1); 
    z-index: 20; 
    display: flex; 
    flex-direction: column; 
    padding: 0; 
  }
  #export-drawer.open { transform: translateY(0); }

  .export-header { 
    padding: 20px; 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    border-bottom: 1px solid rgba(0, 0, 0, 0.05); 
  }
  .export-header-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .export-header h3 { 
    margin: 0; 
    font-size: 16px; 
    font-weight: 700;
    color: #0D47A1; 
  }
  .export-subtitle {
    font-size: 11px;
    color: #78909C;
    font-weight: 500;
  }

  /* 现代关闭按钮 */
  .btn-close-export { 
    background: rgba(0, 0, 0, 0.04); 
    color: #546E7A; 
    width: 28px; 
    height: 28px; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    border-radius: 50%; 
    font-size: 18px; 
    border: none; 
    cursor: pointer; 
    transition: all 0.2s ease;
  }
  .btn-close-export:hover { 
    background: rgba(229, 57, 53, 0.1); 
    color: #E53935; 
  }

  /* 底部固定操作栏 */
  .export-footer {
    padding: 16px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #ffffff;
    border-top: 1px solid rgba(0, 0, 0, 0.05);
    z-index: 22;
  }
  
  .select-all-label { 
    display: flex; 
    align-items: center; 
    gap: 8px; 
    font-size: 13px; 
    color: #0D47A1; 
    font-weight: 600; 
    cursor: pointer; 
    user-select: none; 
  }

  /* 自定义复选框美化样式 */
  .custom-chk {
    appearance: none;
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border: 2px solid #90CAF9;
    border-radius: 5px;
    outline: none;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    background: #ffffff;
    flex-shrink: 0;
  }
  .custom-chk:checked {
    background: #1976D2;
    border-color: #1976D2;
  }
  .custom-chk:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 5px;
    height: 9px;
    border: solid #ffffff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  /* 渐变确认导出按钮 */
  #btn-do-export {
    background: linear-gradient(135deg, #1565C0 0%, #1976D2 100%);
    color: #ffffff;
    border: none;
    padding: 8px 20px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(25, 118, 210, 0.2);
    transition: all 0.2s ease;
  }
  #btn-do-export:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 14px rgba(25, 118, 210, 0.35);
  }
  #btn-do-export:active {
    transform: translateY(0);
  }

  .export-list { 
    flex: 1; 
    overflow-y: auto; 
    padding: 20px; 
    background: #fafafa; 
  }
  
  .export-item { 
    background: #ffffff; 
    padding: 14px; 
    border-radius: 14px; 
    margin-bottom: 12px; 
    border: 1px solid rgba(0,0,0,0.03); 
    display: flex; 
    align-items: flex-start; 
    gap: 12px; 
    transition: all 0.2s ease; 
    cursor: pointer; 
  }
  .export-item:hover { 
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(13, 71, 161, 0.05); 
    border-color: rgba(25, 118, 210, 0.15);
  }
  .export-item-details { flex: 1; }
  .export-item-content { 
    font-size: 13px; 
    color: #37474F; 
    line-height: 1.5; 
    max-height: 60px; 
    overflow: hidden; 
    text-overflow: ellipsis; 
    display: -webkit-box; 
    -webkit-line-clamp: 3; 
    -webkit-box-orient: vertical; 
  }
  .export-item-meta { 
    font-size: 11px; 
    color: #90A4AE; 
    margin-top: 6px; 
    font-weight: 500;
  }

  /* --- 侧边贴边模式（100px * 100px 淡蓝半圆贴右） --- */
  #toggle-bubble.side-dock {
    width: 40px !important;
    height: 30px !important;
    margin-right: -10px !important;
    padding-right: 10px !important;
    padding-left: 0 !important;
    background: #a0cfff !important; /* 完美匹配截图淡蓝色 */
    border-radius: 100px 0 0 100px !important;
    right: 0 !important;
    left: auto !important;
    bottom: auto !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    /* 居中光晕：无偏移 + 2px 微模糊（贴死屏幕的那一侧会被窗口裁掉，但该边在屏幕外，不可见） */
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.12) !important;
    padding-left: 5px !important;
    transition: transform 0.35s cubic-bezier(0.65, 0, 0.35, 1), background 0.25s ease;
  }
  #toggle-bubble.side-dock:hover {
    transform: translateX(-4px) !important;
    background: #8ec2f5 !important;
  }
  #toggle-bubble.side-dock #bubble-icon-img,
  #toggle-bubble.side-dock #bubble-icon-svg {
    display: none !important;
  }
  #toggle-bubble.side-dock .side-chevron {
    display: block !important;
    pointer-events: none; /* 与主图标一致，避免干扰拖拽/点击 */
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
  }

  /* ================================================================
     桌面版适配：整个系统窗口会随「悬浮球 / 面板」切换尺寸，
     因此面板与悬浮球都改为填满当前窗口，不再依赖浏览器视口。
     ================================================================ */
  :host {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    /* 方案A：原生窗口四周的阴影留白（= 阴影最大外扩 2px），需与 panel.js 的 PANEL_SHADOW_PADDING 一致 */
    --panel-edge: 2px;
    /* 贴边页签「不透明度」= 1 - 透明度：静止时 30% 透明度（0.7），鼠标移入 0% 透明度（完全实心），移出自动淡回 */
    --tab-idle-opacity: 0.7;
    --tab-hover-opacity: 1;
  }

  /* --- 面板模式：面板内缩一圈，把窗口边界让给 box-shadow 绘制 --- */
  :host-context(body.panel-mode) #main-panel {
    position: fixed;
    inset: var(--panel-edge);
    width: calc(100% - (var(--panel-edge) * 2));
    height: calc(100% - (var(--panel-edge) * 2));
    max-height: none;
    border-radius: 24px;
    transform: none;
    /* 极轻光晕：与基础规则一致（层1 不可见，层2 为 2px 微模糊 + 6%） */
    box-shadow: 0 0 0 rgba(0, 0, 0, 0.12), 0 0 2px rgba(0, 0, 0, 0.06);
  }
  :host-context(body.panel-mode) #main-panel.closed {
    opacity: 0;
    visibility: hidden;
    transform: none !important;
  }
  :host-context(body.panel-mode) #toggle-bubble {
    display: none !important;
  }

  /* --- 悬浮球模式：只显示悬浮球 --- */
  :host-context(body.bubble-mode) #main-panel {
    display: none !important;
  }
  :host-context(body.bubble-mode) #toggle-bubble {
    position: fixed;
    inset: 0;
    width: auto;
    height: auto;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    background: transparent;
    align-items: flex-end;
    justify-content: center;
    transform-origin: bottom center;
  }
  :host-context(body.bubble-mode) #toggle-bubble:not(.side-dock) #bubble-icon-img {
    width: 46px;
    height: auto;
  }

  /* 侧边贴边：原生窗口 42×34，页签 36×30 贴右边缘，左侧 6px / 上下 2px 留白用于绘制阴影
     （数值需与 panel.js 的 SIDE_TAB_WIDTH / SIDE_TAB_HEIGHT / SIDE_SHADOW_LEFT / SIDE_SHADOW_Y 保持一致） */
  :host-context(body.bubble-mode) #toggle-bubble.side-dock {
    position: fixed;
    left: auto !important;
    /* 右缘故意溢出窗口 4px（窗口右边缘 = 屏幕右边缘，溢出部分被裁掉不可见）：
       这样 hover 左移 4px 后右缘正好回到屏幕边缘，不会与屏幕脱开 */
    right: -4px !important;
    top: 2px !important; /* = panel.js 的 SIDE_SHADOW_Y */
    bottom: auto !important;
    width: 40px !important; /* 40 = 可见 36px + 右侧 4px 溢出（给 hover 位移留量） */
    height: 30px !important;
    margin: 0 !important;
    /* 右侧 4px padding 抵消上面溢出的 4px 宽度，使箭头视觉位置与原来完全一致 */
    padding: 0 4px 0 5px !important;
    border-radius: 100px 0 0 100px !important;
    background: #a0cfff !important;
    /* 居中光晕：无偏移 + 2px 微模糊（hover 再左移 4px ⇒ 共需 6px，正好等于 6px 留白） */
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.12) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transform: none;
    /* 静止 30% 透明（不透明度 0.7）；鼠标移入变实心，移出自动淡回（见下方 :hover） */
    opacity: var(--tab-idle-opacity);
    /* 覆盖基础规则的过渡：透明度 0.25s，位移/底色沿用原有缓动 */
    transition: opacity 0.25s ease, transform 0.35s cubic-bezier(0.65, 0, 0.35, 1), background 0.25s ease;
  }
  :host-context(body.bubble-mode) #toggle-bubble.side-dock:hover {
    transform: translateX(-4px) !important;
    background: #8ec2f5 !important;
    opacity: var(--tab-hover-opacity);
  }
  :host-context(body.bubble-mode) #toggle-bubble.side-dock #bubble-icon-img,
  :host-context(body.bubble-mode) #toggle-bubble.side-dock #bubble-icon-svg {
    display: none !important;
  }
  :host-context(body.bubble-mode) #toggle-bubble.side-dock .side-chevron {
    display: block !important;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
  }

  /* 切换模式时短暂隐藏，避免旧内容在窗口缩放过程中闪动 */
  :host-context(body.mode-switching) #main-panel,
  :host-context(body.mode-switching) #toggle-bubble {
    opacity: 0 !important;
  }

  /* --- 轻提示（替代桌面端不可用的网页 alert） --- */
  .app-toast {
    position: fixed;
    left: 50%;
    bottom: 74px;
    transform: translate(-50%, 12px);
    max-width: 86%;
    padding: 10px 16px;
    border-radius: 12px;
    background: rgba(33, 51, 74, 0.94);
    color: #ffffff;
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    word-break: break-all;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 2147483000;
  }
  .app-toast.show {
    opacity: 1;
    transform: translate(-50%, 0);
  }
`;
