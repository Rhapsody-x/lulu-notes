//! 原生 Windows 文件对话框（不依赖额外插件，保证离线可构建）。
//! 通过 comdlg32 的 GetSaveFileNameW / GetOpenFileNameW 实现。

use std::path::PathBuf;

use serde::Serialize;
use tauri::WebviewWindow;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Controls::Dialogs::{
    CommDlgExtendedError, GetOpenFileNameW, GetSaveFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST,
    OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST, OPENFILENAMEW,
};

/// COM 初始化守卫：保证对话框所需 STA 环境，并成对释放。
struct ComGuard {
    should_uninit: bool,
}

impl ComGuard {
    fn new() -> Self {
        // 若当前线程已用相同模型初始化，返回 S_FALSE（HRESULT 0x1），
        // 此时无需也不能调用 CoUninitialize。若模型不同（RPC_E_CHANGED_MODE），
        // 同样不释放，以免破坏宿主 COM 状态。
        let hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };

        Self {
            should_uninit: hr.0 == 0,
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.should_uninit {
            unsafe { CoUninitialize() };
        }
    }
}

fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn filter_buffer(name: &str, extension: &str) -> Vec<u16> {
    let pattern = format!("*.{}", extension);
    format!(
        "{name} ({pattern})\0{pattern}\0所有文件 (*.*)\0*.*\0\0"
    )
    .encode_utf16()
    .collect()
}

fn path_from_buffer(buffer: &[u16]) -> Option<PathBuf> {
    let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    if len == 0 {
        return None;
    }
    let text = String::from_utf16_lossy(&buffer[..len]);
    let trimmed = text.trim().trim_matches('"');
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// 对话框返回 false：错误码为 0 表示用户取消；其余为真实错误。
fn dialog_failure() -> Result<Option<PathBuf>, String> {
    let code = unsafe { CommDlgExtendedError() }.0;
    if code == 0 {
        Ok(None)
    } else {
        Err(format!("文件对话框出错（代码 0x{code:04X}）"))
    }
}

fn save_dialog(
    default_name: &str,
    filter_name: &str,
    extension: &str,
    title: &str,
    hwnd_owner: HWND,
) -> Result<Option<PathBuf>, String> {
    let _com = ComGuard::new();

    let filter = filter_buffer(filter_name, extension);
    let title_wide = to_wide(title);
    let default_ext = to_wide(extension);
    let mut file_buffer = vec![0u16; 32_768];
    for (slot, unit) in default_name.encode_utf16().take(file_buffer.len() - 1).zip(file_buffer.iter_mut()) {
        *unit = slot;
    }

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter.as_ptr()),
        nFilterIndex: 1,
        lpstrFile: PWSTR(file_buffer.as_mut_ptr()),
        nMaxFile: file_buffer.len() as u32,
        lpstrTitle: PCWSTR(title_wide.as_ptr()),
        Flags: OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER,
        lpstrDefExt: PCWSTR(default_ext.as_ptr()),
        hwndOwner: hwnd_owner,
        ..Default::default()
    };

    let ok = unsafe { GetSaveFileNameW(&mut ofn) };
    if ok.as_bool() {
        Ok(path_from_buffer(&file_buffer))
    } else {
        dialog_failure()
    }
}

fn open_dialog(
    filter_name: &str,
    extension: &str,
    title: &str,
    hwnd_owner: HWND,
) -> Result<Option<PathBuf>, String> {
    let _com = ComGuard::new();

    let filter = filter_buffer(filter_name, extension);
    let title_wide = to_wide(title);
    let default_ext = to_wide(extension);
    let mut file_buffer = vec![0u16; 32_768];

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter.as_ptr()),
        nFilterIndex: 1,
        lpstrFile: PWSTR(file_buffer.as_mut_ptr()),
        nMaxFile: file_buffer.len() as u32,
        lpstrTitle: PCWSTR(title_wide.as_ptr()),
        Flags: OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER,
        lpstrDefExt: PCWSTR(default_ext.as_ptr()),
        hwndOwner: hwnd_owner,
        ..Default::default()
    };

    let ok = unsafe { GetOpenFileNameW(&mut ofn) };
    if ok.as_bool() {
        Ok(path_from_buffer(&file_buffer))
    } else {
        dialog_failure()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    pub path: String,
    pub content: String,
}

/// 弹出“另存为”对话框并写入 UTF-8 文本；取消时返回 None。
#[tauri::command]
pub fn save_export_file(
    window: WebviewWindow,
    default_name: String,
    content: String,
    filter_name: String,
    extension: String,
    title: Option<String>,
) -> Result<Option<String>, String> {
    let ext = extension.trim_start_matches('.').to_string();
    let title = title.unwrap_or_else(|| "保存文件".to_string());
    let owner = window.hwnd().unwrap_or_else(|_| HWND(std::ptr::null_mut()));

    match save_dialog(&default_name, &filter_name, &ext, &title, owner)? {
        Some(path) => {
            std::fs::write(&path, content.as_bytes())
                .map_err(|e| format!("写入文件失败：{e}"))?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

/// 弹出“打开”对话框并读取 UTF-8 文本；取消时返回 None。
#[tauri::command]
pub fn pick_import_file(
    window: WebviewWindow,
    filter_name: String,
    extension: String,
    title: Option<String>,
) -> Result<Option<ImportedFile>, String> {
    let ext = extension.trim_start_matches('.').to_string();
    let title = title.unwrap_or_else(|| "打开文件".to_string());
    let owner = window.hwnd().unwrap_or_else(|_| HWND(std::ptr::null_mut()));

    match open_dialog(&filter_name, &ext, &title, owner)? {
        Some(path) => {
            let content = std::fs::read_to_string(&path)
                .or_else(|_| std::fs::read(&path).map(|bytes| String::from_utf8_lossy(&bytes).to_string()))
                .map_err(|e| format!("读取文件失败：{e}"))?;
            Ok(Some(ImportedFile {
                path: path.to_string_lossy().to_string(),
                content,
            }))
        }
        None => Ok(None),
    }
}
