// ================================================================
//  updater.rs - 自动更新（后台下载 + 用户决定是否安装）
//
//  流程：
//    1. check_update    → 只查询，不改动任何状态
//    2. download_update → 后台下载安装包，落盘到 app_data/updates/，
//                         期间通过 update-progress 事件回报进度
//    3. install_pending_update → 用户确认后执行安装
//
//  设计要点：
//  * 安装包落盘而非留在内存，用户选「稍后」后关掉程序也不会白下载。
//  * 插件的 install() 在 Windows 上启动安装器后会直接 exit(0)，
//    因此本模块不在其后再做重启/退出动作。
//  * install() 需要 Update 实例，只能由 check() 取得，所以安装前
//    必须再确认一次远端版本（离线时无法安装已下载的包）。
// ================================================================
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

const EVENT_PROGRESS: &str = "update-progress";
const EVENT_DOWNLOADED: &str = "update-downloaded";

/// 已下载、等待用户确认安装的更新。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdate {
    pub version: String,
    pub notes: String,
    pub path: String,
    pub size: u64,
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<PendingUpdate>>,
}

/// 检查结果（不含下载动作）。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub available: bool,
    pub version: String,
    pub current_version: String,
    pub notes: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    downloaded: u64,
    total: Option<u64>,
    percent: f64,
}

// ---------------- 路径与状态文件 ----------------

fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建更新目录失败：{e}"))?;
    Ok(dir)
}

fn meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(updates_dir(app)?.join("pending.json"))
}

fn package_path(app: &AppHandle) -> Result<PathBuf, String> {
    // 扩展名用中性的 .pkg：安装包实际可能是 exe 或 zip，
    // 插件会自行嗅探内容类型，不会按扩展名执行。
    Ok(updates_dir(app)?.join("pending.pkg"))
}

/// 清理落盘的安装包与元数据。目录不存在也算成功。
fn clear_files(app: &AppHandle) -> Result<(), String> {
    for path in [meta_path(app)?, package_path(app)?] {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("删除更新文件失败：{e}"))?;
        }
    }
    Ok(())
}

/// 读取磁盘上的待安装记录，并丢弃无效项（文件缺失 / 版本不高于当前版本）。
fn read_pending(app: &AppHandle) -> Option<PendingUpdate> {
    let meta = meta_path(app).ok()?;
    let raw = std::fs::read_to_string(&meta).ok()?;
    let pending: PendingUpdate = serde_json::from_str(&raw).ok()?;

    let path = PathBuf::from(&pending.path);
    if !path.is_file() {
        let _ = clear_files(app);
        return None;
    }

    // 已经装上该版本，或记录比当前版本还旧（用户降级过），都直接作废。
    let current = app.package_info().version.to_string();
    if cmp_version(&pending.version, &current) <= 0 {
        let _ = clear_files(app);
        return None;
    }

    Some(pending)
}

fn write_pending(app: &AppHandle, pending: &PendingUpdate) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(pending).map_err(|e| format!("序列化更新信息失败：{e}"))?;
    std::fs::write(meta_path(app)?, raw).map_err(|e| format!("写入更新信息失败：{e}"))
}

/// 简单的数字段版本比较，避免为此引入 semver 依赖。
fn cmp_version(a: &str, b: &str) -> i32 {
    let parse = |text: &str| -> Vec<i64> {
        text.trim_start_matches(['v', 'V'])
            .split(['.', '-', '+'])
            .map(|part| part.parse::<i64>().unwrap_or(0))
            .collect()
    };
    let left = parse(a);
    let right = parse(b);
    let len = left.len().max(right.len());
    for i in 0..len {
        let x = *left.get(i).unwrap_or(&0);
        let y = *right.get(i).unwrap_or(&0);
        if x != y {
            return if x > y { 1 } else { -1 };
        }
    }
    0
}

// ---------------- 命令 ----------------

/// 只检查是否有新版本，不下载、不落盘。
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| format!("更新器不可用：{e}"))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateCheck {
            available: true,
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        }),
        Ok(None) => Ok(UpdateCheck {
            available: false,
            version: current.clone(),
            current_version: current,
            notes: String::new(),
        }),
        Err(e) => Err(format!("{e}")),
    }
}

/// 后台下载安装包并落盘。下载完成后发出 update-downloaded 事件。
#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<PendingUpdate, String> {
    let updater = app.updater().map_err(|e| format!("更新器不可用：{e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?
        .ok_or_else(|| "当前已是最新版本".to_string())?;

    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();

    let emit_app = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    // 进度事件做节流，避免高频 IPC 拖慢下载。
    let bytes = update
        .download(
            move |chunk_len, total| {
                downloaded += chunk_len as u64;
                if last_emit.elapsed() >= Duration::from_millis(120) {
                    last_emit = Instant::now();
                    let percent = match total {
                        Some(t) if t > 0 => (downloaded as f64 / t as f64 * 100.0).min(100.0),
                        _ => 0.0,
                    };
                    let _ = emit_app.emit(
                        EVENT_PROGRESS,
                        ProgressPayload {
                            downloaded,
                            total,
                            percent,
                        },
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载失败：{e}"))?;

    let path = package_path(&app)?;
    std::fs::write(&path, &bytes).map_err(|e| format!("保存安装包失败：{e}"))?;

    let pending = PendingUpdate {
        version,
        notes,
        path: path.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    };

    write_pending(&app, &pending)?;
    *state
        .pending
        .lock()
        .map_err(|_| "更新状态锁定失败".to_string())? = Some(pending.clone());

    let _ = app.emit(EVENT_PROGRESS, ProgressPayload { downloaded: pending.size, total: Some(pending.size), percent: 100.0 });
    let _ = app.emit(EVENT_DOWNLOADED, pending.clone());

    Ok(pending)
}

/// 安装已下载的更新。成功后插件会启动安装器并退出本进程，不会返回。
#[tauri::command]
pub async fn install_pending_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    let cached = state
        .pending
        .lock()
        .map_err(|_| "更新状态锁定失败".to_string())?
        .clone();

    let pending = match cached.or_else(|| read_pending(&app)) {
        Some(item) => item,
        None => return Err("没有待安装的更新".into()),
    };

    let bytes = std::fs::read(&pending.path).map_err(|e| format!("读取安装包失败：{e}"))?;

    // install() 依赖 check() 得到的 Update 实例，必须再确认一次远端版本。
    let updater = app.updater().map_err(|e| format!("更新器不可用：{e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("确认版本失败：{e}"))?
        .ok_or_else(|| "远端已无可用更新，请重新检查".to_string())?;

    if update.version != pending.version {
        return Err("远端版本已变化，请重新检查更新".into());
    }

    update
        .install(&bytes)
        .map_err(|e| format!("启动安装失败：{e}"))?;

    Ok(())
}

/// 查询是否有已下载待安装的更新（启动时调用）。
#[tauri::command]
pub fn pending_update(app: AppHandle, state: State<'_, UpdateState>) -> Option<PendingUpdate> {
    let cached = state.pending.lock().ok().and_then(|guard| guard.clone());
    cached.or_else(|| read_pending(&app))
}

/// 丢弃已下载的安装包（用户选择「跳过此版本」时调用）。
#[tauri::command]
pub fn discard_pending_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if let Ok(mut guard) = state.pending.lock() {
        *guard = None;
    }
    clear_files(&app)
}

/// 启动时把磁盘上的待安装记录载入内存。
pub fn restore_on_startup(app: &AppHandle, state: &UpdateState) {
    if let Some(pending) = read_pending(app) {
        if let Ok(mut guard) = state.pending.lock() {
            *guard = Some(pending);
        }
    }
}
