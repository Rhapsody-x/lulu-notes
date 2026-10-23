// ================================================================
//  storage.js - 桌面版本地持久化
//  原扩展使用 chrome.storage.local；桌面版改为 localStorage，
//  并保持同样的 get / set 回调调用方式，便于业务代码 1:1 迁移。
// ================================================================
const STORAGE_KEY = 'lulu-notes-store-v1';

const Store = (() => {
  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (err) {
      console.error('读取本地数据失败:', err);
      return {};
    }
  }

  function writeAll(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('保存本地数据失败:', err);
      return false;
    }
  }

  function normalizeKeys(keys) {
    if (keys === null || keys === undefined) return null;
    if (Array.isArray(keys)) return keys;
    if (typeof keys === 'string') return [keys];
    return Object.keys(keys);
  }

  function get(keys, callback) {
    const all = readAll();
    const keyList = normalizeKeys(keys);
    let result;
    if (keyList === null) {
      result = all;
    } else {
      result = {};
      keyList.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(all, key)) {
          result[key] = all[key];
        }
      });
    }
    if (typeof callback === 'function') callback(result);
    return result;
  }

  function set(patch, callback) {
    const all = readAll();
    Object.keys(patch || {}).forEach(key => {
      all[key] = patch[key];
    });
    const ok = writeAll(all);
    if (!ok && typeof showToast === 'function') {
      showToast('本地存储空间不足，请删除部分图片或便签');
    }
    if (typeof callback === 'function') callback();
  }

  return { get, set, readAll, writeAll };
})();

// ---- 桌面窗口辅助（Tauri 2 全局 API） ----
const Tauri = window.__TAURI__ || {};
const invoke = (command, args = {}) => {
  if (!Tauri.core || typeof Tauri.core.invoke !== 'function') {
    return Promise.reject(new Error('Tauri API 不可用'));
  }
  return Tauri.core.invoke(command, args);
};
