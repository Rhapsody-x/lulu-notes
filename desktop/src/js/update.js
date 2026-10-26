// ================================================================
//  update.js - 自动更新（后台下载 + 用户决定是否安装）
//
//  与阶段一的区别：不再自己请求 GitHub API，改为调用 Rust 侧的
//  updater 命令。版本比对、签名校验、安装全部在 Rust 完成。
//
//  行为：
//   * 启动后静默检查一次（24 小时节流）；发现新版本即后台下载，
//     面板未打开时完全不打扰。
//   * 下载完成后弹窗，由用户选择「立即安装 / 稍后 / 跳过此版本」。
//   * 「稍后」保留已下载的安装包，下次启动仍会提示安装。
//   * 托盘菜单「检查更新」可手动触发，会显示下载进度。
// ================================================================
const UPDATE_PAGE = 'https://github.com/Rhapsody-x/lulu-notes/releases/latest';
const UPDATE_AUTO_DELAY_MS = 6000;
const SKIPPED_VERSION_KEY = 'skippedUpdateVersion';
const LAST_AUTO_CHECK_KEY = 'lastAutoUpdateCheckAt';
/// 自动检查每天最多一次：GitHub 的 Release 资源虽不限流，
/// 但没必要每次启动都打一次网络请求。
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let updateBusy = false;
let updateModal = null;
let progressBox = null;
/// 面板收起时下载完成的提示，等用户下次打开面板再弹。
let deferredPending = null;
let resizeTimer = 0;

// ---------------- 基础工具 ----------------

function safeInvoke(command, args) {
  if (typeof invoke !== 'function') return Promise.reject(new Error('Tauri API 不可用'));
  return invoke(command, args);
}

function isSkipped(version) {
  const skipped = Store.get([SKIPPED_VERSION_KEY])[SKIPPED_VERSION_KEY];
  return String(skipped || '') === String(version || '');
}

/// 面板打开时窗口宽 362，收起成悬浮球时只有 64。
/// 用宽度判断可以避免依赖面板内部的 class 状态。
function panelVisible() {
  return window.innerWidth >= 200;
}

async function onUpdateEvent(name, handler) {
  const api = Tauri.event;
  if (!api || typeof api.listen !== 'function') {
    console.warn(`事件 API 不可用，跳过监听 ${name}`);
    return;
  }
  try {
    await api.listen(name, (event) => {
      try {
        handler(event.payload);
      } catch (err) {
        console.error(`处理 ${name} 失败:`, err);
      }
    });
  } catch (err) {
    console.error(`监听 ${name} 失败:`, err);
  }
}

// ---------------- 下载进度 ----------------

function showProgress(text, percent) {
  if (!panelVisible()) return;

  if (!progressBox || !progressBox.parentNode) {
    const box = document.createElement('div');
    box.className = 'update-progress';

    const label = document.createElement('div');
    label.className = 'update-progress-label';

    const bar = document.createElement('div');
    bar.className = 'update-progress-bar';
    const fill = document.createElement('div');
    fill.className = 'update-progress-fill';
    bar.appendChild(fill);

    box.appendChild(label);
    box.appendChild(bar);
    shadow.appendChild(box);

    progressBox = box;
    progressBox._label = label;
    progressBox._fill = fill;
  }

  progressBox.classList.add('show');
  const shown = Math.max(0, Math.min(100, Number(percent) || 0));
  progressBox._label.textContent = shown > 0 ? `${text} ${Math.round(shown)}%` : text;
  progressBox._fill.style.width = `${Math.max(2, shown)}%`;
}

function hideProgress() {
  if (progressBox) progressBox.classList.remove('show');
}

// ---------------- 弹窗 ----------------

function closeUpdateDialog() {
  if (updateModal && updateModal.parentNode) {
    updateModal.parentNode.removeChild(updateModal);
  }
  updateModal = null;
}

function buildUpdateDialog(config) {
  closeUpdateDialog();

  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';

  const card = document.createElement('div');
  card.className = 'update-card';

  const title = document.createElement('h3');
  title.className = 'update-title';
  title.textContent = config.title;
  card.appendChild(title);

  if (config.subtitle) {
    const subtitle = document.createElement('div');
    subtitle.className = 'update-subtitle';
    subtitle.textContent = config.subtitle;
    card.appendChild(subtitle);
  }

  if (config.notes) {
    const notes = document.createElement('div');
    notes.className = 'update-notes';
    const text = String(config.notes);
    notes.textContent = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    card.appendChild(notes);
  }

  const actions = document.createElement('div');
  actions.className = 'update-actions';
  (config.actions || []).forEach(action => {
    const btn = document.createElement('button');
    btn.className = `update-btn ${action.kind || 'ghost'}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => action.onClick());
    actions.appendChild(btn);
  });
  card.appendChild(actions);

  overlay.appendChild(card);
  shadow.appendChild(overlay);
  updateModal = overlay;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeUpdateDialog();
  });
}

/// 安装包已就绪：让用户决定装不装。
function showReadyDialog(pending, fromStartup) {
  if (!pending) return;

  // 面板收着的时候不硬弹，等下次打开面板再提示。
  if (!panelVisible()) {
    deferredPending = pending;
    return;
  }

  // 下载完成的命令返回值和 update-downloaded 事件都会走到这里，
  // 同一个版本只弹一次，避免弹窗被重复重建。
  if (updateModal && updateModal.dataset.version === String(pending.version)) return;

  deferredPending = null;

  buildUpdateDialog({
    title: `新版本 v${pending.version} 已下载`,
    subtitle: fromStartup ? '上次已下载完成，随时可以安装' : '安装完成后会自动重启噜噜便签',
    notes: pending.notes || '本次更新暂无说明。',
    actions: [
      {
        label: '跳过此版本',
        kind: 'ghost',
        onClick: () => skipVersion(pending.version)
      },
      {
        label: '稍后',
        kind: 'ghost',
        onClick: () => {
          closeUpdateDialog();
          showToast('已保留安装包，下次打开时会再提醒');
        }
      },
      {
        label: '立即安装',
        kind: 'primary',
        onClick: installNow
      }
    ]
  });

  if (updateModal) updateModal.dataset.version = String(pending.version);
}

function showFailureDialog(error) {
  buildUpdateDialog({
    title: '更新下载失败',
    subtitle: '可以稍后重试，或前往发布页面手动下载',
    notes: String(error && error.message ? error.message : error),
    actions: [
      {
        label: '关闭',
        kind: 'ghost',
        onClick: closeUpdateDialog
      },
      {
        label: '打开发布页',
        kind: 'primary',
        onClick: () => {
          safeInvoke('open_external_url', { url: UPDATE_PAGE }).catch(err => {
            showToast(`打开浏览器失败：${err}`);
          });
          closeUpdateDialog();
        }
      }
    ]
  });
}

// ---------------- 动作 ----------------

async function skipVersion(version) {
  Store.set({ [SKIPPED_VERSION_KEY]: version });
  closeUpdateDialog();
  try {
    await safeInvoke('discard_pending_update');
  } catch (err) {
    console.error('删除安装包失败:', err);
  }
  showToast(`已跳过 v${version}，可在菜单里手动检查更新`);
}

async function installNow() {
  closeUpdateDialog();
  hideProgress();

  // 安装会强制退出进程，先把当前编辑内容落盘。
  try {
    if (typeof saveNotes === 'function') saveNotes();
  } catch (err) {
    console.error('安装前保存便签失败:', err);
  }

  showToast('正在安装，程序即将重启…');
  try {
    await safeInvoke('install_pending_update');
    // 正常情况下安装器会直接结束进程，不会走到这里。
  } catch (err) {
    showToast(`安装失败：${err}`);
  }
}

async function startDownload(info, options = {}) {
  if (updateBusy) return;
  updateBusy = true;

  const silent = options.silent === true;
  const version = info && info.version ? info.version : '';

  closeUpdateDialog();
  if (!silent) showProgress(`正在下载 v${version}…`, 0);

  try {
    const pending = await safeInvoke('download_update');
    hideProgress();
    showReadyDialog(pending, false);
  } catch (err) {
    hideProgress();
    console.error('下载更新失败:', err);
    if (silent) {
      // 后台下载失败不打扰，等用户手动检查时再说。
      return;
    }
    showFailureDialog(err);
  } finally {
    updateBusy = false;
  }
}

// ---------------- 检查入口 ----------------

async function checkAndDownload(options = {}) {
  const silent = options.silent === true;

  if (updateBusy) {
    if (!silent) showToast('正在处理更新，请稍候');
    return;
  }

  if (silent) {
    const last = Number(Store.get([LAST_AUTO_CHECK_KEY])[LAST_AUTO_CHECK_KEY]) || 0;
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
  }

  updateBusy = true;
  if (!silent) showToast('正在检查更新…');

  let info;
  try {
    info = await safeInvoke('check_update');
    Store.set({ [LAST_AUTO_CHECK_KEY]: Date.now() });
  } catch (err) {
    updateBusy = false;
    console.error('检查更新失败:', err);
    if (!silent) showToast(`检查更新失败：${err}`);
    return;
  }

  updateBusy = false;

  if (!info || !info.available) {
    if (!silent) showToast(info && info.currentVersion ? `已是最新版本 v${info.currentVersion}` : '已是最新版本');
    return;
  }

  if (isSkipped(info.version)) {
    if (!silent) showToast(`v${info.version} 已被跳过，可在菜单里重新检查`);
    return;
  }

  await startDownload(info, { silent });
}

async function manualCheck() {
  if (updateBusy) {
    showToast('正在处理更新，请稍候');
    return;
  }

  // 已有下载好的包就不必再查一遍。
  try {
    const pending = await safeInvoke('pending_update');
    if (pending && !isSkipped(pending.version)) {
      showReadyDialog(pending, true);
      return;
    }
  } catch (err) {
    console.error('读取待安装更新失败:', err);
  }

  await checkAndDownload();
}

// ---------------- 启动流程 ----------------

async function bootUpdate() {
  // 先看有没有上次下载好的安装包
  try {
    const pending = await safeInvoke('pending_update');
    if (pending) {
      if (isSkipped(pending.version)) {
        await safeInvoke('discard_pending_update');
      } else {
        showReadyDialog(pending, true);
        return;
      }
    }
  } catch (err) {
    console.error('读取待安装更新失败:', err);
  }

  await checkAndDownload({ silent: true });
}

// 下载进度事件
onUpdateEvent('update-progress', (payload) => {
  if (!payload) return;
  showProgress('正在下载更新…', payload.percent);
});

// 下载完成事件（自动下载路径的兜底提示）
onUpdateEvent('update-downloaded', (payload) => {
  hideProgress();
  if (payload) showReadyDialog(payload, false);
});

// 托盘菜单「检查更新」
onUpdateEvent('check-update', async () => {
  if (typeof showPanel === 'function') {
    try {
      await showPanel();
    } catch (err) {
      console.error('打开面板失败:', err);
    }
  }
  setTimeout(manualCheck, 260);
});

// 面板内菜单的「检查更新」
const checkUpdateBtn = shadow.getElementById('check-update');
if (checkUpdateBtn) {
  checkUpdateBtn.addEventListener('click', () => {
    mainMenu.classList.remove('show');
    manualCheck();
  });
}

// 面板从悬浮球展开后，补弹之前被推迟的提示
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (deferredPending && panelVisible()) {
      const pending = deferredPending;
      deferredPending = null;
      showReadyDialog(pending, true);
    }
  }, 320);
});

window.addEventListener('load', () => {
  setTimeout(bootUpdate, UPDATE_AUTO_DELAY_MS);
});
