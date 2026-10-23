mod dialogs;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewWindow,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkArea {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
    scale: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowMetrics {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
    work_area: WorkArea,
}

/// 返回窗口的逻辑坐标/尺寸，以及所在显示器的可用工作区。
/// 前端据此记忆位置、贴边与限制拖动范围（支持多显示器与缩放）。
#[tauri::command]
fn window_metrics(window: WebviewWindow) -> Result<WindowMetrics, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window
        .outer_position()
        .map_err(|e| e.to_string())
        .unwrap_or(PhysicalPosition::new(0, 0));
    let size = window
        .outer_size()
        .map_err(|e| e.to_string())
        .unwrap_or(PhysicalSize::new(360, 800));

    let work_area = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| {
            let monitor_scale = monitor.scale_factor();
            let area = monitor.work_area();
            WorkArea {
                left: area.position.x as f64 / monitor_scale,
                top: area.position.y as f64 / monitor_scale,
                width: area.size.width as f64 / monitor_scale,
                height: area.size.height as f64 / monitor_scale,
                scale: monitor_scale,
            }
        })
        .unwrap_or(WorkArea {
            left: 0.0,
            top: 0.0,
            width: 1280.0,
            height: 720.0,
            scale,
        });

    Ok(WindowMetrics {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        scale,
        work_area,
    })
}

/// 切换悬浮球/面板时一次性调整窗口尺寸与位置。
#[tauri::command]
fn configure_window(
    window: WebviewWindow,
    width: f64,
    height: f64,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || !x.is_finite() || !y.is_finite() {
        return Err("窗口参数无效".into());
    }
    window
        .set_size(LogicalSize::new(
            width.clamp(16.0, 2000.0),
            height.clamp(16.0, 2000.0),
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn move_window(window: WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() {
        return Ok(());
    }
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show-panel", "打开便签", true, None::<&str>)?;
    let new_item = MenuItem::with_id(app, "new-note", "新建便签", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出噜噜便签", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &new_item, &separator, &quit_item])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("噜噜便签")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show-panel" => {
                let _ = app.emit("show-panel", ());
            }
            "new-note" => {
                let _ = app.emit("new-note", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("show-panel", ());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            window_metrics,
            configure_window,
            move_window,
            show_window,
            hide_window,
            quit_app,
            dialogs::save_export_file,
            dialogs::pick_import_file,
        ])
        .setup(|app| {
            build_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // 关闭按钮只隐藏，应用继续驻留托盘。
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("噜噜便签启动失败");
}
