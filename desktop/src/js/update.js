// ================================================================
//  update.js - 检查更新（阶段一：提示 + 跳转下载页）
//  机制：读取 GitHub Releases 的最新 tag，与当前版本号比对。
//        有新版本时弹窗告知，用户可"去下载 / 稍后 / 跳过此版本"。
//  说明：这一阶段不下载安装包，也不替换程序，只做提示与跳转，
//        因此不需要签名密钥；后续升级到自动更新时再补签名。
//  ⚠️ 更新源仓库（公开仓库才能被未认证请求读取）
// ================================================================
const UPDATE_REPO = 'Rhapsody-x/lulu-notes';

const UPDATE_API_BASE = 'https://api.github.com/repos';
const UPDATE_TIMEOUT_MS = 8000;
const UPDATE_AUTO_DELAY_MS = 8000;
/// 自动检查最多每天一次：GitHub 未认证接口按 IP 限流（60 次/小时），
/// 同一出口 IP 的多个使用者频繁重启容易撞上限。
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SKIPPED_VERSION_KEY = 'skippedUpdateVersion';
const LAST_AUTO_CHECK_KEY = 'lastAutoUpdateCheckAt';

let updateChecking = false;
let updateModal = null;

// --- 版本号比对（只取数字段，v2.2.0 与 2.2.0 等价） ---
function parseVersion(text) {
  return String(text || '')
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map(part => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const x = left[i] || 0;
    const y = right[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function currentAppVersion() {
  const app = Tauri.app;
  if (app && typeof app.getVersion === 'function') {
    try {
      return await app.getVersion();
    } catch (err) {
      console.error('读取当前版本失败:', err);
    }
  }
  return '';
}

// --- 取远端最新版本 ---
async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPDATE_API_BASE}/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      cache: 'no-store'
    });

    if (res.status === 404) throw new Error('仓库还没有发布任何版本');
    if (res.status === 403) throw new Error('GitHub 访问次数受限，请稍后再试');
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);

    const data = await res.json();
    const version = String(data.tag_name || data.name || '').replace(/^v/i, '');
    if (!version) throw new Error('版本信息缺失');

    return {
      version,
      notes: String(data.body || '').trim(),
      url: String(data.html_url || '')
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- 更新弹窗 ---
function closeUpdateDialog() {
  if (updateModal && updateModal.parentNode) {
    updateModal.parentNode.removeChild(updateModal);
  }
  updateModal = null;
}

function showUpdateDialog(latest, current) {
  closeUpdateDialog();

  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';

  const card = document.createElement('div');
  card.className = 'update-card';

  const title = document.createElement('h3');
  title.className = 'update-title';
  title.textContent = `发现新版本 v${latest.version}`;

  const subtitle = document.createElement('div');
  subtitle.className = 'update-subtitle';
  subtitle.textContent = current ? `当前版本 v${current}` : '';

  const notes = document.createElement('div');
  notes.className = 'update-notes';
  const rawNotes = latest.notes || '本次更新暂无说明。';
  notes.textContent = rawNotes.length > 500 ? `${rawNotes.slice(0, 500)}…` : rawNotes;

  const actions = document.createElement('div');
  actions.className = 'update-actions';

  const skipBtn = document.createElement('button');
  skipBtn.className = 'update-btn ghost';
  skipBtn.textContent = '跳过此版本';

  const laterBtn = document.createElement('button');
  laterBtn.className = 'update-btn ghost';
  laterBtn.textContent = '稍后';

  const goBtn = document.createElement('button');
  goBtn.className = 'update-btn primary';
  goBtn.textContent = '去下载';

  actions.appendChild(skipBtn);
  actions.appendChild(laterBtn);
  actions.appendChild(goBtn);

  card.appendChild(title);
  if (subtitle.textContent) card.appendChild(subtitle);
  card.appendChild(notes);
  card.appendChild(actions);
  overlay.appendChild(card);
  shadow.appendChild(overlay);
  updateModal = overlay;

  // 两个"不更新"的选项语义不同：
  //   跳过此版本 → 记住版本号，以后不再提示它
  //   稍后      → 只是本次关闭，下次启动仍会提示
  skipBtn.addEventListener('click', () => {
    Store.set({ [SKIPPED_VERSION_KEY]: latest.version });
    closeUpdateDialog();
  });
  laterBtn.addEventListener('click', closeUpdateDialog);

  goBtn.addEventListener('click', () => {
    if (!latest.url) {
      showToast('该版本没有提供下载页面');
      return;
    }
    invoke('open_external_url', { url: latest.url }).catch(err => {
      showToast(`打开浏览器失败：${err}`);
    });
    closeUpdateDialog();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeUpdateDialog();
  });
}

// --- 检查入口 ---
async function checkForUpdate(options = {}) {
  const silent = options.silent === true;

  if (updateChecking) return;

  if (!UPDATE_REPO) {
    if (!silent) {
      showToast('尚未配置更新源：请在 update.js 中填写 UPDATE_REPO');
    }
    return;
  }

  // 自动检查做节流；手动检查不受限制，并会顺带刷新时间戳
  if (silent) {
    const last = Number(Store.get([LAST_AUTO_CHECK_KEY])[LAST_AUTO_CHECK_KEY]) || 0;
    if (Date.now() - last < AUTO_CHECK_INTERVAL_MS) return;
  }

  updateChecking = true;
  if (!silent) showToast('正在检查更新…');

  try {
    const current = await currentAppVersion();
    const latest = await fetchLatestRelease();
    // 只在拿到响应后记录，失败时不记录，下次启动还能重试
    Store.set({ [LAST_AUTO_CHECK_KEY]: Date.now() });

    if (compareVersions(latest.version, current) > 0) {
      const skipped = Store.get([SKIPPED_VERSION_KEY])[SKIPPED_VERSION_KEY];
      if (silent && skipped === latest.version) return;
      showUpdateDialog(latest, current);
    } else if (!silent) {
      showToast(current ? `已是最新版本 v${current}` : '已是最新版本');
    }
  } catch (err) {
    console.error('检查更新失败:', err);
    if (!silent) {
      showToast(`检查更新失败：${err && err.message ? err.message : err}`);
    }
  } finally {
    updateChecking = false;
  }
}

// 菜单入口
const checkUpdateBtn = shadow.getElementById('check-update');
if (checkUpdateBtn) {
  checkUpdateBtn.addEventListener('click', () => {
    mainMenu.classList.remove('show');
    checkForUpdate();
  });
}

// 启动后静默检查一次：失败不打扰，有新版本才弹窗
window.addEventListener('load', () => {
  setTimeout(() => {
    checkForUpdate({ silent: true });
  }, UPDATE_AUTO_DELAY_MS);
});
