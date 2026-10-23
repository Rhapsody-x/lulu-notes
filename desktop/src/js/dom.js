// ================================================================
//  dom.js - Shadow DOM 构建层（依赖前置文件：styles.js）
//  负责：宿主节点、isLocalChange 全局标记、样式注入、HTML 骨架、
//       全部 DOM 元素引用、悬浮球 PNG/SVG 图标（含降级）创建挂载。
// ================================================================
const host = document.createElement('div');
host.id = 'floating-notes-extension-root';
host.style.position = 'fixed';
host.style.zIndex = '2147483647';
host.style.top = '0';
host.style.left = '0';
host.style.width = '100%';
host.style.height = '100%';
document.body.appendChild(host);
const shadow = host.attachShadow({ mode: 'open' });

// 全局状态：标记本地修改，避免 storage 监听重复渲染
let isLocalChange = false;

// 样式注入：完整样式表见 styles.js
const style = document.createElement('style');
style.textContent = APP_STYLES;
shadow.appendChild(style);

const wrapper = document.createElement('div');
wrapper.innerHTML = `
  <!-- 悬浮吸附标签 (底部吸附，动态挂载图片，避免 Race Condition) -->
  <div id="toggle-bubble" title="左键打开 | 拖拽调整位置 | 右键切换贴边模式"></div>

  <!-- 主界面 -->
  <div id="main-panel" class="closed">
    <!-- 头部：拖拽区域 -->
    <div class="header">
      <div class="header-left">
        <button id="search-btn" title="搜索便签">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
        <input type="text" id="search-input" placeholder="搜索便签内容..." autocomplete="off">
      </div>

      <div class="header-actions">
        <button id="add-btn" title="新建">+</button>
        <button id="menu-btn" title="更多选项">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
        </button>
        <div class="dropdown-menu" id="main-menu">
          <button class="dropdown-item" id="export-json">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> 备份数据 (JSON)
          </button>
          <button class="dropdown-item" id="export-word">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> 导出为 Word (.doc)
          </button>
          <button class="dropdown-item" id="export-excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg> 导出为 Excel (.xls)
          </button>
          <button class="dropdown-item" id="import-json">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg> 恢复数据 (JSON)
          </button>
        </div>
        <button class="btn-minimize" id="btn-minimize" title="最小化">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        </button>
      </div>
    </div>

    <div id="notes-container"></div>
    <div id="inner-backdrop"></div>

    <div id="trash-zone">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      回收站
    </div>

    <!-- 回收站抽屉 -->
    <div id="trash-drawer">
      <div class="trash-header">
        <h3>回收站 (7天)</h3>
        <div class="trash-header-btns">
          <!-- 将“清空”换成垃圾桶清空 SVG 图标，并加上 title 提示 -->
          <button id="btn-clear-trash" class="mini-btn btn-delete" title="清空回收站">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
          <button id="btn-close-trash" class="btn-close-trash">×</button>
        </div>
      </div>
      <div class="trash-list" id="trash-list"></div>
    </div>

    <!-- 自定义选择 Word 导出抽屉 -->
    <div id="export-drawer">
      <div class="export-header">
        <div class="export-header-title">
          <h3>选择导出便签</h3>
          <span class="export-subtitle">导出格式: Word (.doc)</span>
        </div>
        <button id="btn-close-export" class="btn-close-export">×</button>
      </div>
      <div class="export-list" id="export-list"></div>
      <div class="export-footer">
        <label class="select-all-label">
          <input type="checkbox" id="chk-select-all" class="custom-chk" checked>
          <span>全选</span>
        </label>
        <button id="btn-do-export">确认导出</button>
      </div>
    </div>
  </div>

  <!-- 富文本调色悬浮菜单 -->
  <div id="color-tooltip">
    <div class="color-dot" data-color="#1A237E" style="background: #1A237E;" title="默认深蓝"></div>
    <div class="color-dot" data-color="#E53935" style="background: #E53935;" title="红色"></div>
    <div class="color-dot" data-color="#FB8C00" style="background: #FB8C00;" title="橙色"></div>
    <div class="color-dot" data-color="#43A047" style="background: #43A047;" title="绿色"></div>
    <div class="color-dot" data-color="#1E88E5" style="background: #1E88E5;" title="蓝色"></div>
    <div class="color-dot" data-color="#8E24AA" style="background: #8E24AA;" title="紫色"></div>
  </div>
`;
shadow.appendChild(wrapper);

const toggleBubble = shadow.getElementById('toggle-bubble');
const mainPanel = shadow.getElementById('main-panel');
const header = shadow.querySelector('.header');
const notesContainer = shadow.getElementById('notes-container');
const addBtn = shadow.getElementById('add-btn');
const minBtn = shadow.getElementById('btn-minimize');
const menuBtn = shadow.getElementById('menu-btn');
const mainMenu = shadow.getElementById('main-menu');
const exportJsonBtn = shadow.getElementById('export-json');
const importJsonBtn = shadow.getElementById('import-json');
const exportWordBtn = shadow.getElementById('export-word');
const exportExcelBtn = shadow.getElementById('export-excel'); // 👈 新增这行
const trashZone = shadow.getElementById('trash-zone');
const trashDrawer = shadow.getElementById('trash-drawer');
const trashList = shadow.getElementById('trash-list');
const closeTrashBtn = shadow.getElementById('btn-close-trash');
const clearTrashBtn = shadow.getElementById('btn-clear-trash');
const innerBackdrop = shadow.getElementById('inner-backdrop');
const colorTooltip = shadow.getElementById('color-tooltip');
const exportDrawer = shadow.getElementById('export-drawer');
const exportList = shadow.getElementById('export-list');
const closeExportBtn = shadow.getElementById('btn-close-export');
const doExportBtn = shadow.getElementById('btn-do-export');
const chkSelectAll = shadow.getElementById('chk-select-all');
const searchBtn = shadow.getElementById('search-btn');
const searchInput = shadow.getElementById('search-input');

// --- 动态程序化加载图标 (彻底剥离白色拱形背板，实现完美的边缘贴底) ---
const bubbleImg = document.createElement('img');
bubbleImg.id = 'bubble-icon-img';
bubbleImg.style.width = '46px'; /* 桌面版悬浮窗为 64×64，图标固定 46px 更稳定 */
bubbleImg.style.height = 'auto';
bubbleImg.style.pointerEvents = 'none';
bubbleImg.style.display = 'inline-block';
bubbleImg.style.objectFit = 'contain';
// 增加精准的 PNG 轮廓投影发光滤镜（半硬边：2px 微模糊）
bubbleImg.style.filter = 'drop-shadow(0 2px 2px rgba(0, 0, 0, 0.15))';

const bubbleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
bubbleSvg.id = 'bubble-icon-svg';
bubbleSvg.setAttribute('viewBox', '0 0 24 24');
bubbleSvg.setAttribute('width', '100%'); /* SVG 同步改为 100% 支撑 */
bubbleSvg.setAttribute('height', '100%');
bubbleSvg.setAttribute('fill', 'none');
bubbleSvg.setAttribute('stroke', '#1976D2');
bubbleSvg.setAttribute('stroke-width', '2.5');
bubbleSvg.setAttribute('stroke-linecap', 'round');
bubbleSvg.setAttribute('stroke-linejoin', 'round');
bubbleSvg.style.display = 'none';
bubbleSvg.style.pointerEvents = 'none';
bubbleSvg.style.margin = 'auto';
bubbleSvg.style.filter = 'drop-shadow(0 2px 2px rgba(0, 0, 0, 0.15))';
bubbleSvg.innerHTML = `
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
  <polyline points="14 2 14 8 20 8"></polyline>
  <line x1="16" y1="13" x2="8" y2="13"></line>
  <line x1="16" y1="17" x2="8" y2="17"></line>
  <line x1="10" y1="9" x2="8" y2="9"></line>
`;

// 必须在对 src 赋值前注册 error 监听，防止失败后事件遗漏
bubbleImg.addEventListener('error', () => {
  bubbleImg.style.display = 'none';
  bubbleSvg.style.display = 'inline-block';
});

// 再进行路径赋值并挂载到主页面上
bubbleImg.src = 'assets/LLB.png';

// --- 动态创建侧边贴边模式下的 < 箭头图标（右键切换 side-dock 后显示） ---
const sideChevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
sideChevron.setAttribute('class', 'side-chevron');
sideChevron.setAttribute('viewBox', '0 0 24 24');
sideChevron.setAttribute('width', '16');
sideChevron.setAttribute('height', '16');
sideChevron.setAttribute('fill', 'none');
sideChevron.setAttribute('stroke', '#ffffff');
sideChevron.setAttribute('stroke-width', '4');
sideChevron.setAttribute('stroke-linecap', 'round');
sideChevron.setAttribute('stroke-linejoin', 'round');
sideChevron.style.display = 'none';
sideChevron.style.pointerEvents = 'none'; /* 避免箭头本身拦截鼠标事件 */
sideChevron.innerHTML = '<polyline points="15 18 9 12 15 6"></polyline>';

if (toggleBubble) {
  toggleBubble.appendChild(bubbleImg);
  toggleBubble.appendChild(bubbleSvg);
  toggleBubble.appendChild(sideChevron); // 👈 挂载侧边箭头（底部模式下默认隐藏）
}

