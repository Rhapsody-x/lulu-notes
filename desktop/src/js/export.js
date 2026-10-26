// ================================================================
//  export.js - 数据导出模块
//  负责：JSON 全量备份、自定义勾选 Word(.doc) / Excel(.xls) 导出抽屉、文件下载。
// ================================================================

// 当前选择的导出格式，默认为 'word'
let currentExportFormat = 'word';

// 备份 JSON
exportJsonBtn.addEventListener('click', async () => {
  if (typeof saveNotes === 'function') saveNotes();
  const data = Store.readAll();

  // 图片本体不在 localStorage 里，备份时一并打包成 base64，保证换机可恢复。
  try {
    const names = collectImageNames([
      ...(Array.isArray(data.notes) ? data.notes : []),
      ...(Array.isArray(data.deletedNotes) ? data.deletedNotes : [])
    ]);
    if (names.length) {
      data.images = await invoke('read_images', { names });
    }
  } catch (err) {
    console.error('打包图片失败:', err);
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  saveExportFile(blob, `notes-backup-${new Date().toISOString().slice(0,10)}.json`);
});

// 导出前把 data-image 引用换成内联 base64：导出的 .doc 是独立文件，
// 离开本机后无法访问应用数据目录里的图片。
async function inlineImagesForExport(html) {
  const names = imageNamesFromHtml(html);
  if (!names.length) return html || '';
  let map = {};
  try {
    map = await invoke('read_images', { names });
  } catch (err) {
    console.error('读取导出图片失败:', err);
  }
  return String(html).replace(/<img\b([^>]*?)data-image="([^"]+)"([^>]*?)\/?>/g, (match, before, name, after) => {
    const src = map && map[name];
    if (!src) return '';
    return `<img src="${src}"${before}${after}>`;
  });
}

// 调出自定义选择导出面板
exportWordBtn.addEventListener('click', () => openExport('word'));
if (exportExcelBtn) {
  exportExcelBtn.addEventListener('click', () => openExport('excel'));
}

// 通过 Tauri 命令弹出 Windows 保存对话框并写入文件
async function saveExportFile(blob, filename) {
  try {
    const content = await blob.text();
    const extension = (filename.split('.').pop() || 'txt').toLowerCase();
    const filterNames = { json: 'JSON 备份', doc: 'Word 文档', xls: 'Excel 表格' };
    const savedPath = await invoke('save_export_file', {
      defaultName: filename,
      content: content,
      filterName: filterNames[extension] || '文件',
      extension: extension,
      title: '导出便签'
    });
    if (savedPath) {
      showToast(`已导出：${savedPath}`);
    }
  } catch (err) {
    console.error('导出文件失败:', err);
    showToast(`导出失败：${err}`);
  }
}

function openExport(format = 'word') {
  currentExportFormat = format;

  // 动态更新抽屉副标题显示的导出格式
  const subtitle = shadow.querySelector('.export-subtitle');
  if (subtitle) {
    subtitle.textContent = format === 'excel' ? '导出格式: Excel (.xls)' : '导出格式: Word (.doc)';
  }

  renderExportList();
  exportDrawer.classList.add('open');
  innerBackdrop.classList.add('active');
}

function closeExport() {
  exportDrawer.classList.remove('open');
  innerBackdrop.classList.remove('active');
}

closeExportBtn.addEventListener('click', closeExport);

// 一键全选控制逻辑
chkSelectAll.addEventListener('change', () => {
  const isChecked = chkSelectAll.checked;
  exportList.querySelectorAll('.export-item-chk').forEach(chk => {
    chk.checked = isChecked;
  });
});

function updateSelectAllState() {
  const checkboxes = exportList.querySelectorAll('.export-item-chk');
  const checkedBoxes = exportList.querySelectorAll('.export-item-chk:checked');
  chkSelectAll.checked = checkboxes.length > 0 && checkboxes.length === checkedBoxes.length;
}

function renderExportList() {
  if (typeof saveNotes === 'function') saveNotes();
  const res = Store.get(['notes']);
  const list = Array.isArray(res.notes) ? res.notes : [];
  exportList.innerHTML = list.length ? '' : '<div class="empty-tip">没有可以导出的便签</div>';

    // 默认如果列表不为空，则勾选全选框
    chkSelectAll.checked = list.length > 0;

    list.forEach(n => {
      const el = document.createElement('div');
      el.className = 'export-item';

      // 提取纯文本以便于在此处生成简洁的前端预览
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = n.content || '无内容';
      const plainText = tempDiv.innerText || tempDiv.textContent || '无内容';

      // 用 DOM 赋值而非字符串拼接：便签内容含 < & 等字符时不会破坏结构
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'export-item-chk custom-chk';
      checkbox.dataset.id = n.id;
      checkbox.checked = true;

      const details = document.createElement('div');
      details.className = 'export-item-details';

      const contentEl = document.createElement('div');
      contentEl.className = 'export-item-content';
      contentEl.textContent = plainText;

      const metaEl = document.createElement('div');
      metaEl.className = 'export-item-meta';
      metaEl.textContent = n.timestamp || '';

      details.appendChild(contentEl);
      details.appendChild(metaEl);
      el.appendChild(checkbox);
      el.appendChild(details);

      // 绑定点击这一项的详情部分时自动联动勾选
      details.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        updateSelectAllState();
      });

      checkbox.addEventListener('change', () => {
        updateSelectAllState();
      });

    exportList.appendChild(el);
  });
}

doExportBtn.addEventListener('click', async () => {
  const checkedBoxes = exportList.querySelectorAll('.export-item-chk:checked');
  const selectedIds = Array.from(checkedBoxes).map(chk => parseInt(chk.dataset.id));

  if (selectedIds.length === 0) {
    showToast('请至少勾选一条便签进行导出！');
    return;
  }

  if (typeof saveNotes === 'function') saveNotes();
  const res = Store.get(['notes']);
  const notes = Array.isArray(res.notes) ? res.notes : [];
  const selectedNotes = notes.filter(n => selectedIds.includes(n.id));

    // --- 1. 如果是 Excel 格式导出 ---
    if (currentExportFormat === 'excel') {
      let excelContent = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:x="urn:schemas-microsoft-com:office:excel"
              xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>便签导出</x:Name>
                  <x:WorksheetOptions>
                    <x:DisplayGridlines/>
                  </x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            table {
              border-collapse: collapse;
              font-family: Arial, sans-serif;
            }
            th {
              background-color: #f2f2f2;
              font-weight: bold;
              text-align: center !important; /* 标题居中 */
              padding: 8px 12px;
              border: 0.5pt solid #d0d0d0;
            }
            td.col-date {
              text-align: center !important; /* 日期居中 */
              padding: 8px 12px;
              border: 0.5pt solid #e0e0e0;
              mso-number-format: "\@"; /* 防止日期格式变形 */
            }
            td.col-content {
              text-align: left !important;   /* 👈 内容向左对齐 */
              padding: 8px 12px;
              border: 0.5pt solid #e0e0e0;
              word-break: break-all;
            }
          </style>
        </head>
        <body>
          <table>
            <!-- 👈 限制列宽，防止撑满整屏 -->
            <colgroup>
              <col width="130">
              <col width="350">
            </colgroup>
            <thead>
              <tr>
                <th style="text-align: center;">日期</th>
                <th style="text-align: center;">内容</th>
              </tr>
            </thead>
            <tbody>
      `;

    selectedNotes.forEach(note => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = note.content || '';
      const plainText = tempDiv.innerText || tempDiv.textContent || '无内容';
        // 👈 仅保留到“日”（去掉后面的时分秒）
        const fullTime = note.timestamp || '';
        const dateOnly = fullTime.split(' ')[0] || fullTime;

        excelContent += `
          <tr>
            <td class="col-date" style="text-align: center;">${dateOnly}</td>
            <td class="col-content" style="text-align: left;">${plainText}</td>
          </tr>
        `;
      });

      excelContent += `
            </tbody>
          </table>
        </body>
        </html>
      `;

      const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const filename = `便签导出-${new Date().toISOString().slice(0, 10)}.xls`;
      saveExportFile(blob, filename);
      closeExport();
      return;
    }

    // --- 2. 如果是 Word 格式导出 ---
    let docContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office'
            xmlns:w='urn:schemas-microsoft-com:office:word'
            xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset="utf-8">
        <title>我的悬浮便签导出列表</title>
        <style>
          body { font-family: 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; line-height: 1.8; color: #333333; padding: 20px; }
          h1 { font-size: 22px; color: #0D47A1; border-bottom: 2px solid #90CAF9; padding-bottom: 8px; margin-bottom: 24px; }
          .note-container { margin-bottom: 28px; padding: 15px; border-left: 4px solid #1976D2; background-color: #F5F9FD; }
          .note-header { font-size: 11px; color: #666666; margin-bottom: 10px; border-bottom: 1px dashed #E0E0E0; padding-bottom: 4px; }
          .note-body { font-size: 13px; color: #1A237E; word-break: break-all; }
        </style>
      </head>
      <body>
        <h1>我的悬浮便签导出</h1>
    `;

    for (const note of selectedNotes) {
      const body = await inlineImagesForExport(note.content || '');
      docContent += `
        <div class="note-container">
          <div class="note-header">
            时间：${note.timestamp} ${note.isPinned ? ' [已置顶]' : ''}
          </div>
          <div class="note-body">
            ${body || '无内容'}
          </div>
        </div>
      `;
    }

    docContent += `</body></html>`;

    const blob = new Blob([docContent], { type: 'application/msword;charset=utf-8' });
    const filename = `便签导出-${new Date().toISOString().slice(0,10)}.doc`;
    saveExportFile(blob, filename);
    closeExport();
});

// 从 JSON 备份恢复数据（桌面版新增，便于跨设备迁移）
if (importJsonBtn) {
  importJsonBtn.addEventListener('click', async () => {
    try {
      const file = await invoke('pick_import_file', {
        filterName: 'JSON 备份',
        extension: 'json',
        title: '恢复便签数据'
      });
      if (!file) return;

      const data = JSON.parse(file.content);
      if (!data || typeof data !== 'object' ||
          (!Array.isArray(data.notes) && !Array.isArray(data.deletedNotes))) {
        throw new Error('备份文件格式不正确');
      }

      const confirmed = window.confirm('恢复备份将覆盖当前便签和回收站数据，是否继续？');
      if (!confirmed) return;

      const patch = {};
      if (Array.isArray(data.notes)) patch.notes = data.notes;
      if (Array.isArray(data.deletedNotes)) patch.deletedNotes = data.deletedNotes;

      // 备份里携带的图片按原文件名写回，便签 HTML 中的引用即可继续生效。
      if (data.images && typeof data.images === 'object' && !Array.isArray(data.images)) {
        try {
          await invoke('write_images', { images: data.images });
        } catch (err) {
          console.error('恢复图片失败:', err);
        }
      }

      Store.set(patch);
      loadNotes();
      renderTrash();
      showToast(`已恢复：${file.path}`);
    } catch (err) {
      console.error('恢复数据失败:', err);
      showToast(`恢复失败：${err}`);
    }
  });
}

// 双效合并背景板点击事件，点击面板外侧主动收回所有抽屉
innerBackdrop.addEventListener('click', () => {
  closeTrash();
  closeExport();
});
