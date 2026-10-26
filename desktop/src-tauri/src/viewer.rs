//! 便签图片的放大预览窗口。
//!
//! 主面板宽度只有 360px，内嵌灯箱能提供的放大幅度有限，因此点击图片时
//! 另开一个无边框置顶窗口，按图片原始尺寸（受屏幕工作区 85% 约束）显示。
//! 窗口复用：再次点击其它图片时只更新内容与尺寸，不重复创建。

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::images;

const VIEWER_LABEL: &str = "viewer";
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 180.0;
/// 窗口最大占屏幕工作区的比例，留出边距以免贴满整屏。
const MAX_AREA_RATIO: f64 = 0.85;

#[derive(Default)]
pub struct ViewerState {
    image: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerPayload {
    /// 图片绝对路径，前端用资源协议转成可显示地址。
    path: String,
    /// 相对引用（images/xxx.png），便于排查与去重。
    name: String,
}

fn payload_from_state(app: &AppHandle) -> Result<ViewerPayload, String> {
    let state = app.state::<ViewerState>();
    let name = state
        .image
        .lock()
        .map_err(|_| "读取预览状态失败".to_string())?
        .clone()
        .ok_or_else(|| "没有可预览的图片".to_string())?;

    let path = images::absolute_path(app, &name)?;
    if !path.is_file() {
        return Err("图片文件不存在".to_string());
    }
    Ok(ViewerPayload {
        path: path.to_string_lossy().to_string(),
        name,
    })
}

/// 预览页加载完成后调用，取当前应显示的图片。
#[tauri::command]
pub fn viewer_current_image(app: AppHandle) -> Result<ViewerPayload, String> {
    payload_from_state(&app)
}

/// 依据图片原始尺寸计算窗口尺寸与居中坐标。
/// 图片小于屏幕时按原尺寸显示（不放大），大于屏幕时等比缩到 85% 工作区。
fn compute_geometry(
    source: &WebviewWindow,
    width: f64,
    height: f64,
) -> (f64, f64, f64, f64) {
    let (area_x, area_y, area_w, area_h) = match source.current_monitor().ok().flatten() {
        Some(monitor) => {
            let scale = monitor.scale_factor();
            let area = monitor.work_area();
            (
                area.position.x as f64 / scale,
                area.position.y as f64 / scale,
                area.size.width as f64 / scale,
                area.size.height as f64 / scale,
            )
        }
        None => (0.0, 0.0, 1280.0, 720.0),
    };

    let max_w = (area_w * MAX_AREA_RATIO).max(MIN_WIDTH);
    let max_h = (area_h * MAX_AREA_RATIO).max(MIN_HEIGHT);

    let mut w = if width.is_finite() && width > 0.0 { width } else { max_w };
    let mut h = if height.is_finite() && height > 0.0 { height } else { max_h };

    if w > max_w {
        h *= max_w / w;
        w = max_w;
    }
    if h > max_h {
        w *= max_h / h;
        h = max_h;
    }

    let w = w.clamp(MIN_WIDTH.min(max_w), max_w);
    let h = h.clamp(MIN_HEIGHT.min(max_h), max_h);
    (
        w,
        h,
        area_x + (area_w - w) / 2.0,
        area_y + (area_h - h) / 2.0,
    )
}

/// 打开（或复用）图片预览窗口。
/// width / height 由前端读取 img.naturalWidth / naturalHeight 传入。
///
/// 必须是 async 命令，且所有窗口操作都通过 run_on_main_thread 投递到主线程
/// 消息循环中执行。同步命令会跑在 webview 的 IPC 回调栈里，此时再创建新的
/// WebView2 实例会自锁，表现为界面无响应（AppHang）。
#[tauri::command]
pub async fn open_image_viewer(
    app: AppHandle,
    source: WebviewWindow,
    name: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let path = images::absolute_path(&app, &name)?;
    if !path.is_file() {
        return Err("图片文件不存在".to_string());
    }

    {
        let state = app.state::<ViewerState>();
        let mut guard = state
            .image
            .lock()
            .map_err(|_| "保存预览状态失败".to_string())?;
        *guard = Some(name);
    }

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app_for_main = app.clone();

    app.run_on_main_thread(move || {
        let result = open_or_update_viewer(&app_for_main, &source, width, height);
        let _ = tx.send(result);
    })
    .map_err(|e| format!("投递窗口创建任务失败：{e}"))?;

    // 等待主线程建窗完成；超时只影响错误反馈，不影响窗口本身。
    rx.recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "预览窗口创建超时".to_string())?
}

/// 只允许在主线程调用：建窗与显隐都必须在消息循环内完成。
fn open_or_update_viewer(
    app: &AppHandle,
    source: &WebviewWindow,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let (w, h, x, y) = compute_geometry(source, width, height);

    if let Some(viewer) = app.get_webview_window(VIEWER_LABEL) {
        viewer
            .set_size(LogicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
        viewer
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
        // 通知已存在的窗口刷新内容（尺寸由 Rust 侧直接设定）。
        let _ = viewer.emit("viewer-image", ());
        viewer.show().map_err(|e| e.to_string())?;
        let _ = viewer.set_focus();
        return Ok(());
    }

    let viewer = WebviewWindowBuilder::new(app, VIEWER_LABEL, WebviewUrl::App("viewer.html".into()))
        .title("图片预览")
        .inner_size(w, h)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .visible(false)
        .build()
        .map_err(|e| format!("创建预览窗口失败：{e}"))?;

    viewer.show().map_err(|e| e.to_string())?;
    let _ = viewer.set_focus();
    Ok(())
}

#[tauri::command]
pub fn close_viewer(app: AppHandle) {
    if let Some(viewer) = app.get_webview_window(VIEWER_LABEL) {
        let _ = viewer.close();
    }
}
