//! 便签图片的本地文件存储。
//!
//! 背景：早期版本把图片以 base64 直接写进 localStorage 中的便签 HTML，
//! 而 WebView2 的 localStorage 配额仅数 MB，十几张截图就会整体写入失败
//! （连纯文字的修改也会一并丢失）。因此图片改为落在应用数据目录，
//! 便签 HTML 中只保留 `<img data-image="images/xxx.png">` 这样的相对引用。

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use tauri::{AppHandle, Manager};

const IMAGE_SUBDIR: &str = "images";
/// 单张图片上限：超过即拒绝，避免误传超大文件占满磁盘。
const MAX_IMAGE_BYTES: usize = 24 * 1024 * 1024;

/// 图片目录（不存在时自动创建）。
fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("定位应用数据目录失败：{e}"))?
        .join(IMAGE_SUBDIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建图片目录失败：{e}"))?;
    Ok(dir)
}

/// 把 `images/xxx.png` 或 `xxx.png` 归一化为纯文件名。
/// 只接受 ASCII 安全字符，拒绝 `..`、路径分隔符等一切穿越写法。
fn normalize_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    let file = trimmed
        .strip_prefix("images/")
        .or_else(|| trimmed.strip_prefix("images\\"))
        .unwrap_or(trimmed);

    if file.is_empty() || file.len() > 128 || file.starts_with('.') || file.contains("..") {
        return None;
    }
    if !file
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    {
        return None;
    }
    Some(file.to_string())
}

/// 根据 data URL 的 MIME 或调用方给的扩展名决定落盘格式。
/// 刻意不支持 svg：避免把可执行脚本当作图片长期保存。
fn extension_for(mime: &str, fallback: &str) -> String {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => return "png".into(),
        "image/jpeg" | "image/jpg" => return "jpg".into(),
        "image/webp" => return "webp".into(),
        "image/gif" => return "gif".into(),
        "image/bmp" => return "bmp".into(),
        _ => {}
    }
    let ext = fallback.trim_start_matches('.').to_ascii_lowercase();
    match ext.as_str() {
        "png" | "webp" | "gif" | "bmp" => ext,
        "jpg" | "jpeg" => "jpg".to_string(),
        _ => "png".to_string(),
    }
}

fn mime_for_extension(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        _ => "image/png",
    }
}

/// 接受完整 data URL 或裸 base64 字符串。
fn decode_payload(data: &str) -> Result<Vec<u8>, String> {
    let payload = match data.find(',') {
        Some(idx) if data.starts_with("data:") => &data[idx + 1..],
        _ => data,
    };
    let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned.is_empty() {
        return Err("图片内容为空".into());
    }
    BASE64
        .decode(cleaned.as_bytes())
        .map_err(|e| format!("图片数据解码失败：{e}"))
}

fn mime_from_data_url(data: &str) -> String {
    if !data.starts_with("data:") {
        return String::new();
    }
    data[5..]
        .split(',')
        .next()
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_string()
}

/// 图片的绝对路径（供资源协议与预览窗口使用）。
pub fn absolute_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let file = normalize_name(name).ok_or_else(|| "图片名不合法".to_string())?;
    Ok(images_dir(app)?.join(file))
}

/// 图片目录的绝对路径；前端据此拼接可显示的资源地址，避免逐张 IPC。
#[tauri::command]
pub fn images_base_dir(app: AppHandle) -> Result<String, String> {
    Ok(images_dir(&app)?.to_string_lossy().to_string())
}

/// 保存一张图片，返回 `images/<文件名>` 形式的相对引用。
#[tauri::command]
pub fn save_image(app: AppHandle, data: String, extension: String) -> Result<String, String> {
    let ext = extension_for(&mime_from_data_url(&data), &extension);
    let bytes = decode_payload(&data)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("图片过大（单张上限 24 MB）".into());
    }

    let dir = images_dir(&app)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // 同一毫秒内连续保存时递增后缀，避免互相覆盖。
    let mut file = format!("{stamp}.{ext}");
    let mut counter = 1;
    while dir.join(&file).exists() {
        file = format!("{stamp}-{counter}.{ext}");
        counter += 1;
    }

    std::fs::write(dir.join(&file), &bytes).map_err(|e| format!("写入图片失败：{e}"))?;
    Ok(format!("{IMAGE_SUBDIR}/{file}"))
}

/// 删除指定图片文件，返回实际删除数量。文件不存在不视为错误。
#[tauri::command]
pub fn delete_images(app: AppHandle, names: Vec<String>) -> Result<usize, String> {
    let dir = images_dir(&app)?;
    let mut removed = 0usize;
    for name in names {
        if let Some(file) = normalize_name(&name) {
            if std::fs::remove_file(dir.join(file)).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// 孤儿回收：删除所有不在 `keep` 名单中的图片。
/// 用于兜底——用户手动删掉编辑器里的图片、异常退出等场景不会留下垃圾文件。
#[tauri::command]
pub fn gc_images(app: AppHandle, keep: Vec<String>) -> Result<usize, String> {
    let dir = images_dir(&app)?;
    let keep: HashSet<String> = keep.iter().filter_map(|n| normalize_name(n)).collect();

    let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取图片目录失败：{e}"))?;
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if keep.contains(&name) {
            continue;
        }
        if std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// 批量读取为 data URL：导出 Word 与 JSON 备份需要把图片内联进文本。
#[tauri::command]
pub fn read_images(app: AppHandle, names: Vec<String>) -> Result<HashMap<String, String>, String> {
    let dir = images_dir(&app)?;
    let mut out = HashMap::new();
    for name in names {
        let Some(file) = normalize_name(&name) else {
            continue;
        };
        let path = dir.join(&file);
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png")
            .to_string();
        out.insert(
            name,
            format!("data:{};base64,{}", mime_for_extension(&ext), BASE64.encode(&bytes)),
        );
    }
    Ok(out)
}

/// 恢复备份时按原文件名写回，保证便签 HTML 中的引用继续有效。
#[tauri::command]
pub fn write_images(app: AppHandle, images: HashMap<String, String>) -> Result<usize, String> {
    let dir = images_dir(&app)?;
    let mut written = 0usize;
    for (name, data) in images {
        let Some(file) = normalize_name(&name) else {
            continue;
        };
        let Ok(bytes) = decode_payload(&data) else {
            continue;
        };
        if bytes.len() > MAX_IMAGE_BYTES {
            continue;
        }
        if std::fs::write(dir.join(file), &bytes).is_ok() {
            written += 1;
        }
    }
    Ok(written)
}
