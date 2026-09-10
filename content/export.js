// ================================================================
//  export.js - 数据导出模块
//  负责：JSON 全量备份、自定义勾选 Word(.doc) / Excel(.xls) 导出抽屉、文件下载。
// ================================================================

// 当前选择的导出格式，默认为 'word'
let currentExportFormat = 'word';

// 备份 JSON
exportJsonBtn.addEventListener('click', () => {
  chrome.storage.local.get(null, (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadFile(blob, `notes-backup-${new Date().toISOString().slice(0,10)}.json`);
  });
});

// 调出自定义选择导出面板
exportWordBtn.addEventListener('click', () => openExport('word'));
if (exportExcelBtn) {
  exportExcelBtn.addEventListener('click', () => openExport('excel'));
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  shadow.appendChild(a);
  a.click();
  shadow.removeChild(a);
  URL.revokeObjectURL(url);
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
  chrome.storage.local.get(['notes'], res => {
    const list = res.notes || [];
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

      el.innerHTML = `
        <input type="checkbox" class="export-item-chk custom-chk" data-id="${n.id}" checked>
        <div class="export-item-details">
          <div class="export-item-content">${plainText}</div>
          <div class="export-item-meta">${n.timestamp}</div>
        </div>
      `;

      // 绑定点击这一项的详情部分时自动联动勾选
      el.querySelector('.export-item-details').addEventListener('click', () => {
        const checkbox = el.querySelector('.export-item-chk');
        checkbox.checked = !checkbox.checked;
        updateSelectAllState();
      });

      el.querySelector('.export-item-chk').addEventListener('change', () => {
        updateSelectAllState();
      });

      exportList.appendChild(el);
    });
  });
}

doExportBtn.addEventListener('click', () => {
  const checkedBoxes = exportList.querySelectorAll('.export-item-chk:checked');
  const selectedIds = Array.from(checkedBoxes).map(chk => parseInt(chk.dataset.id));

  if (selectedIds.length === 0) {
    alert('请至少勾选一条便签进行导出！');
    return;
  }

  chrome.storage.local.get(['notes'], res => {
    const notes = res.notes || [];
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
      downloadFile(blob, filename);
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

    selectedNotes.forEach(note => {
      docContent += `
        <div class="note-container">
          <div class="note-header">
            时间：${note.timestamp} ${note.isPinned ? ' [已置顶]' : ''}
          </div>
          <div class="note-body">
            ${note.content || '无内容'}
          </div>
        </div>
      `;
    });

    docContent += `</body></html>`;

    const blob = new Blob([docContent], { type: 'application/msword;charset=utf-8' });
    const filename = `便签导出-${new Date().toISOString().slice(0,10)}.doc`;
    downloadFile(blob, filename);
    closeExport();
  });
});

// 双效合并背景板点击事件，点击面板外侧主动收回所有抽屉
innerBackdrop.addEventListener('click', () => {
  closeTrash();
  closeExport();
});
