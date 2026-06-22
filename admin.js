/* ============================================================
   GLN 照片管理 Admin
   ============================================================ */

const STORAGE_KEY = 'gln_photo_tags_v1';
const ADMIN_TOKEN = 'admin';
const PHOTOS_DIR = 'assets/photos/';
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
const GAS_ENDPOINT_ADMIN = 'https://script.google.com/macros/s/AKfycbzCpoKgXvana8_6cxxB1jrn0qCW8ulw7iX-vVrDJbqCQZ36KjAhHJRNAd489N_z564zsw/exec';
const ADMIN_KEY = 'gln-admin-2026';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const params = new URLSearchParams(location.search);
const token = params.get('t');

let feelings = [];      // [{ key, label, desc, color, axis }]
let photoFiles = [];    // [ filename ]
let tagState = {};      // { filename: [feeling_keys] }

// === 權限 ===
if (token !== ADMIN_TOKEN) {
  $('#auth-gate').style.display = 'block';
} else {
  $('#admin-app').style.display = 'block';
  initTabs();
  init();
  loadCasesList();
  bindNotesParser();
}

// === Tab 切換 ===
function initTabs() {
  $$('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      $$('.admin-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// === 案件列表 ===
let allCases = [];

async function loadCasesList() {
  const app = $('#cases-app');
  app.innerHTML = '<p class="muted" style="text-align:center;padding:3rem 0;">載入案件中…</p>';
  try {
    const url = `${GAS_ENDPOINT_ADMIN}?action=list_cases&admin_token=${encodeURIComponent(ADMIN_KEY)}`;
    const res = await fetch(url);
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'unknown');
    allCases = result.cases || [];
    renderCasesList();
  } catch (err) {
    app.innerHTML = `<p style="text-align:center;padding:3rem;color:var(--gln-error)">載入失敗：${err.message}<br><button class="btn btn-ghost" onclick="loadCasesList()" style="margin-top:1rem;">重試</button></p>`;
  }
}

function renderCasesList() {
  const app = $('#cases-app');
  const query = ($('#case-search')?.value || '').toLowerCase();
  const filtered = query
    ? allCases.filter(c =>
        c.caseId.toLowerCase().includes(query) ||
        (c.clientName || '').toLowerCase().includes(query)
      )
    : allCases;

  const badgeMap = {
    success: ['badge-success', 'AI 分析完成'],
    failed:  ['badge-failed',  'AI 分析失敗'],
    none:    ['badge-none',    '未分析'],
  };

  const listHtml = filtered.length === 0
    ? '<div class="cases-empty"><p>沒有符合的案件</p></div>'
    : filtered.map(c => {
        const [badgeClass, badgeLabel] = badgeMap[c.analysisStatus] || badgeMap.none;
        return `
          <div class="case-card">
            <div class="case-meta">
              <p class="case-id">${c.caseId}</p>
              ${c.clientName ? `<p class="case-client">${c.clientName}</p>` : ''}
              <p class="case-time">${c.timestamp}</p>
            </div>
            <div class="case-actions">
              <span class="case-badge ${badgeClass}">${badgeLabel}</span>
              <a class="btn-report btn-designer" href="${c.designerReportUrl}" target="_blank">設計師報告</a>
              <a class="btn-report btn-client" href="${c.clientReportUrl}" target="_blank">客戶報告</a>
              <a class="btn-report btn-client" href="designer.html?id=${c.caseId}" target="_blank">設計師補填</a>
            </div>
          </div>
        `;
      }).join('');

  app.innerHTML = `
    <div class="cases-toolbar">
      <input class="cases-search" id="case-search" type="search" placeholder="搜尋案件編號、客戶名稱…" value="${query}" />
      <span class="cases-count">${filtered.length} / ${allCases.length} 筆</span>
      <button class="btn btn-ghost btn-sm" onclick="loadCasesList()">重新整理</button>
    </div>
    ${allCases.length === 0
      ? '<div class="cases-empty"><p>目前還沒有已提交的案件。</p></div>'
      : listHtml
    }
  `;
  $('#case-search')?.addEventListener('input', renderCasesList);
}

// === 初始化 ===
async function init() {
  feelings = await fetch('data/feelings.json').then(r => r.json()).then(d => d.feelings);
  renderLegend();
  loadTagState();
  bindControls();
  bindTokenControls();
  // 嘗試自動掃一次
  await rescan();
}

function renderLegend() {
  const root = $('#feeling-legend');
  root.innerHTML = feelings.map(f => {
    const terms = f.search_en || [];
    const pinterestLinks = terms.map(t =>
      `<a class="pin-link" href="https://www.pinterest.com/search/pins/?q=${encodeURIComponent(t)}" target="_blank" rel="noopener" title="Pinterest 搜尋：${t}">${t}</a>`
    ).join(' · ');
    return `
      <div class="feeling-legend-row" title="${f.desc}">
        <span class="feeling-legend-chip">
          <span class="dot" style="background:${f.color}"></span>${f.label}
        </span>
        <span class="feeling-legend-search">${pinterestLinks}</span>
      </div>
    `;
  }).join('');
}

function loadTagState() {
  try {
    tagState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch { tagState = {}; }
}

function saveTagState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tagState));
}

// === 掃描 assets/photos/ 目錄（解析 http-server 的 HTML 索引）===
async function rescan() {
  setStatus('掃描中…');
  try {
    const res = await fetch(PHOTOS_DIR, { headers: { Accept: 'text/html' } });
    if (!res.ok) throw new Error(`掃描失敗 HTTP ${res.status}`);
    const html = await res.text();

    // 解析 <a href="..."> 找圖檔
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));
    photoFiles = links
      .map(href => decodeURIComponent(href.split('/').pop()))
      .filter(name => IMG_EXTS.some(ext => name.toLowerCase().endsWith(ext)))
      .filter(name => name && !name.startsWith('.'))
      .sort();

    renderGrid();
    setStatus(`已掃描 · ${photoFiles.length} 張照片`);
  } catch (e) {
    setStatus('掃描失敗：' + e.message, true);
  }
}

function renderGrid() {
  const root = $('#photo-grid');
  if (photoFiles.length === 0) {
    root.innerHTML = `
      <p class="muted" style="padding: 3rem 0; text-align: center; grid-column: 1 / -1;">
        <code>${PHOTOS_DIR}</code> 內沒有照片。請把 .jpg / .png / .webp 檔丟進這個資料夾後重新掃描。
      </p>
    `;
    updateStats();
    return;
  }

  root.innerHTML = photoFiles.map(name => {
    const tags = tagState[name] || [];
    const count = tags.length;
    let countClass = '';
    let countText = `已標 ${count} 個 tag`;
    if (count === 0) { countClass = 'empty'; countText = '⚠️ 尚未標籤'; }
    else if (count < 3) { countText = `${count} 個 tag（建議 3-5）`; }
    else if (count > 5) { countClass = 'too-many'; countText = `${count} 個 tag（偏多）`; }

    const cardClass = count === 0 ? 'warning' : (count >= 3 ? 'tagged' : '');

    return `
      <div class="photo-card ${cardClass}" data-name="${name}">
        <div class="photo-card-img" style="background-image: url('${PHOTOS_DIR}${encodeURIComponent(name)}')"></div>
        <div class="photo-card-body">
          <div class="photo-card-name">${name}</div>
          <div class="photo-card-tag-count ${countClass}">${countText}</div>
          <div class="photo-card-tags">
            ${feelings.map(f => `
              <label class="tag-chip ${tags.includes(f.key) ? 'checked' : ''}" title="${f.desc}">
                <input type="checkbox" data-name="${name}" data-key="${f.key}" ${tags.includes(f.key) ? 'checked' : ''} />
                ${f.label}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindCardEvents();
  updateStats();
}

function bindCardEvents() {
  $$('.tag-chip input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const name = cb.dataset.name;
      const key = cb.dataset.key;
      if (!tagState[name]) tagState[name] = [];
      if (cb.checked) {
        if (!tagState[name].includes(key)) tagState[name].push(key);
      } else {
        tagState[name] = tagState[name].filter(k => k !== key);
      }
      saveTagState();
      // 更新該卡片的視覺狀態，不重渲染整個 grid
      const card = cb.closest('.photo-card');
      const chip = cb.closest('.tag-chip');
      chip.classList.toggle('checked', cb.checked);
      const count = tagState[name].length;
      const countEl = card.querySelector('.photo-card-tag-count');
      countEl.classList.remove('empty', 'too-many');
      card.classList.remove('warning', 'tagged');
      if (count === 0) {
        countEl.textContent = '⚠️ 尚未標籤';
        countEl.classList.add('empty');
        card.classList.add('warning');
      } else if (count < 3) {
        countEl.textContent = `${count} 個 tag（建議 3-5）`;
      } else if (count > 5) {
        countEl.textContent = `${count} 個 tag（偏多）`;
        countEl.classList.add('too-many');
        card.classList.add('tagged');
      } else {
        countEl.textContent = `已標 ${count} 個 tag`;
        card.classList.add('tagged');
      }
      updateStats();
    });
  });
}

function updateStats() {
  const total = photoFiles.length;
  const tagged = photoFiles.filter(n => (tagState[n] || []).length >= 3).length;
  const partial = photoFiles.filter(n => {
    const c = (tagState[n] || []).length;
    return c >= 1 && c < 3;
  }).length;
  const empty = total - tagged - partial;
  $('#admin-stats').innerHTML = `
    📊 共 ${total} 張 ·
    <span style="color: var(--gln-success)">完整 ${tagged}</span> ·
    <span style="color: var(--gln-accent)">部分 ${partial}</span> ·
    <span style="color: var(--gln-error)">未標 ${empty}</span>
  `;
}

// === 匯出 photos.json ===
function buildPhotosJson() {
  const out = {
    _doc: "由 admin.html 匯出。每張照片含 feeling tags 陣列。",
    _exported_at: new Date().toISOString(),
    _replace_guide: "把此檔覆蓋 data/photos.json 即可上線。",
    photos: photoFiles.map((name, idx) => ({
      id: idx + 1,
      src: PHOTOS_DIR + name,
      tags: tagState[name] || [],
      isPlaceholder: false,
      filename: name
    }))
  };
  return out;
}

function showExportModal() {
  const json = buildPhotosJson();
  const text = JSON.stringify(json, null, 2);

  // 統計提醒
  const untagged = json.photos.filter(p => p.tags.length === 0).length;
  const warning = untagged > 0
    ? `<p style="color: var(--gln-error); margin: 0.5rem 0;">⚠️ 還有 ${untagged} 張未標 tag（會以空陣列匯出，建議補完）</p>`
    : `<p style="color: var(--gln-success); margin: 0.5rem 0;">✅ 全部 ${json.photos.length} 張都有 tag</p>`;

  const modal = document.createElement('div');
  modal.className = 'export-modal-backdrop';
  modal.innerHTML = `
    <div class="export-modal">
      <h2>匯出 photos.json</h2>
      ${warning}
      <p class="muted">
        按「下載 photos.json」存檔，然後手動拖到 <code>data/photos.json</code> 覆蓋。<br />
        或直接複製下面文字貼到 <code>data/photos.json</code>。
      </p>
      <textarea readonly>${text.replace(/</g, '&lt;')}</textarea>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modal-close">關閉</button>
        <button type="button" class="btn btn-ghost" id="modal-copy">📋 複製到剪貼簿</button>
        <button type="button" class="btn btn-primary" id="modal-download">⬇️ 下載 photos.json</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  $('#modal-close', modal).onclick = () => modal.remove();
  $('#modal-copy', modal).onclick = async () => {
    await navigator.clipboard.writeText(text);
    $('#modal-copy', modal).textContent = '✓ 已複製';
  };
  $('#modal-download', modal).onclick = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'photos.json';
    a.click();
    URL.revokeObjectURL(url);
  };
}

// === 控制 ===
function bindControls() {
  $('#btn-rescan').addEventListener('click', rescan);
  $('#btn-export').addEventListener('click', showExportModal);
  $('#btn-clear').addEventListener('click', () => {
    if (!confirm('確定清空所有照片的 tag？此動作不可復原。')) return;
    tagState = {};
    saveTagState();
    renderGrid();
  });
}

function setStatus(msg, isError = false) {
  const el = $('#admin-status');
  el.textContent = msg;
  el.style.color = isError ? 'var(--gln-error)' : 'var(--gln-taupe)';
}

// === 報告 Modal ===
let _currentCaseId = '';
let _currentView = 'client';

function openReportModal(caseId, clientName, view) {
  _currentCaseId = caseId;
  const title = clientName ? `${caseId} · ${clientName}` : caseId;
  $('#report-modal-title').textContent = title;
  switchReportView(view);
  $('#report-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeReportModal() {
  $('#report-modal').classList.remove('open');
  $('#report-modal-iframe').src = 'about:blank';
  document.body.style.overflow = '';
}

function switchReportView(view) {
  _currentView = view;
  $$('.report-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const base = location.origin + location.pathname.replace('admin.html', '');
  const urls = {
    client:   `${base}report.html?id=${_currentCaseId}&v=client`,
    designer: `${base}report.html?id=${_currentCaseId}&v=designer`,
    fill:     `${base}designer.html?id=${_currentCaseId}`,
  };
  $('#report-modal-iframe').src = urls[view] || 'about:blank';
}

// 按 Escape 關閉
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#report-modal').classList.contains('open')) closeReportModal();
});

// === 筆記解析 ===
function bindNotesParser() {
  const btn = $('#btn-parse-notes');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const notes = ($('#notes-input')?.value || '').trim();
    if (!notes) { alert('請先貼入筆記內容'); return; }

    const statusEl = $('#notes-parse-status');
    const resultEl = $('#notes-parse-result');
    btn.disabled = true;
    btn.textContent = '解析中…';
    statusEl.textContent = 'AI 分析筆記中，約需 10–20 秒…';
    resultEl.style.display = 'none';

    try {
      const res = await fetch(GAS_ENDPOINT_ADMIN, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'prefill_from_notes', adminKey: ADMIN_KEY, notes }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '解析失敗');

      statusEl.textContent = `✅ 解析完成 · 案件編號 ${json.projectNumber || '—'}`;
      resultEl.innerHTML = `
        <div class="token-result-title">連結已產生（筆記已預填）</div>
        <div class="token-row">
          <span class="token-row-label">客戶問卷</span>
          <a id="notes-client-url" href="${json.clientUrl}" target="_blank" class="token-url">${json.clientUrl}</a>
          <button class="btn-copy" data-copy-href="${json.clientUrl}">複製</button>
        </div>
        <p class="muted" style="margin-top:.75rem;font-size:.8rem;">
          問卷已根據筆記預填。客戶開啟後可確認並補充資料。
        </p>
      `;
      resultEl.style.display = 'block';
      // 解析完後清空筆記框
      $('#notes-input').value = '';
    } catch (err) {
      statusEl.textContent = '❌ 解析失敗：' + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ AI 解析並產生連結';
    }
  });

  // 複製按鈕（支援 data-copy-href）
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.btn-copy[data-copy-href]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copyHref);
      const orig = b.textContent;
      b.textContent = '✓ 已複製';
      setTimeout(() => { b.textContent = orig; }, 2000);
    } catch { b.textContent = '複製失敗'; }
  });
}

// === Token 產生器 ===
function bindTokenControls() {
  const btn = $('#btn-create-token');
  const noteInput = $('#token-note');
  const resultEl = $('#token-result');
  const errorEl = $('#token-error');

  btn.addEventListener('click', async () => {
    const name = ($('#pf-client-name')?.value || '').trim();
    if (!name) { errorEl.textContent = '請填入業主姓名'; errorEl.style.display = 'block'; return; }
    const note = noteInput.value.trim();
    const prefill = {
      client_name:   name,
      client_phone:  ($('#pf-client-phone')?.value  || '').trim(),
      house_address: ($('#pf-house-address')?.value || '').trim(),
      house_size:    ($('#pf-house-size')?.value    || '').trim(),
      house_age:     ($('#pf-house-age')?.value     || '').trim(),
      house_type:    ($('#pf-house-type')?.value    || '').trim(),
      case_type:     ($('#pf-case-type')?.value     || '').trim(),
      budget:        ($('#pf-budget')?.value         || '').trim(),
    };
    resultEl.style.display = 'none';
    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = '產生中…';

    try {
      const res = await fetch(GAS_ENDPOINT_ADMIN, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'create_token', adminKey: ADMIN_KEY, note, prefill }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || '產生失敗');

      const clientLink = $('#token-client-url');
      const designerLink = $('#token-designer-url');

      clientLink.href = json.clientUrl;
      clientLink.textContent = json.clientUrl;
      // designer report URL 在客戶送出後才有 caseId，這裡先顯示 GAS 回傳的 base URL
      designerLink.href = json.designerReportUrl || '#';
      designerLink.textContent = json.designerReportUrl || '（客戶送出後自動寄出）';

      resultEl.style.display = 'block';
      noteInput.value = '';
      // Clear prefill fields
      ['pf-client-name','pf-client-phone','pf-house-address','pf-house-size','pf-house-age'].forEach(id => {
        const el = $('#' + id); if (el) el.value = '';
      });
      ['pf-house-type','pf-case-type'].forEach(id => {
        const el = $('#' + id); if (el) el.selectedIndex = 0;
      });
      $('#pf-budget').value = '';
    } catch (err) {
      errorEl.textContent = '產生失敗：' + err.message;
      errorEl.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.textContent = '產生連結';
    }
  });

  // 複製按鈕（事件委派，因為 result section 一開始是 hidden）
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-copy');
    if (!btn) return;
    const targetId = btn.dataset.copy;
    const targetEl = $('#' + targetId);
    const text = targetEl ? (targetEl.textContent || targetEl.href) : '';
    if (!text || text === '#') return;
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓ 已複製';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    } catch {
      btn.textContent = '複製失敗';
    }
  });
}
