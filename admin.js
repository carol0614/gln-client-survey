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
let casesAreDemo = false;   // true = 目前顯示的是功能展示範例（無真實案件 / 後端連不上）

// 視覺 Demo：沒有真實案件時自動顯示，讓 Carol 看到案件列表所有功能。
// 真實案件提交後會自動取代。保留一筆範例展示完整卡片（含問卷連結）。
const DEMO_CASES = [
  { caseId: 'GLN-202605-004', clientName: '林先生一家（4 人 + 寵物 · 老屋翻新）', timestamp: '2026-06-20 14:30', analysisStatus: 'success' },
];

async function loadCasesList() {
  const app = $('#cases-app');
  app.innerHTML = '<p class="muted" style="text-align:center;padding:3rem 0;">載入案件中…</p>';
  try {
    const url = `${GAS_ENDPOINT_ADMIN}?action=list_cases&admin_token=${encodeURIComponent(ADMIN_KEY)}`;
    const res = await fetch(url);
    const result = await res.json();
    if (!result.ok) throw new Error(result.error || 'unknown');
    const real = result.cases || [];
    if (real.length === 0) {
      // 還沒有真實案件 → 顯示功能展示 Demo
      allCases = DEMO_CASES;
      casesAreDemo = true;
    } else {
      allCases = real;
      casesAreDemo = false;
    }
    renderCasesList();
  } catch (err) {
    // 後端連不上時也顯示 Demo，讓 Carol 看功能；保留重試入口
    allCases = DEMO_CASES;
    casesAreDemo = true;
    renderCasesList(err.message);
  }
}

function renderCasesList(loadError) {
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
        const taId = 'note-ta-' + c.caseId;
        const base = location.origin + location.pathname.replace('admin.html', '');
        const d = casesAreDemo ? '&demo=1' : '';
        const designerUrl = `${base}report.html?id=${c.caseId}&v=designer${d}`;
        const clientUrl   = `${base}report.html?id=${c.caseId}&v=client${d}`;
        const fillUrl     = `${base}designer.html?id=${c.caseId}${d}`;
        // 範例卡片用一條示意連結，讓 Carol 看到「問卷連結 + 複製」長相
        const surveyUrl   = c.clientUrl || (casesAreDemo ? `${base}?t=DEMO-RANGE-TOKEN` : '');
        return `
          <div class="case-card" data-case-id="${c.caseId}">
            <div class="case-meta">
              <p class="case-id">${c.caseId}${casesAreDemo ? ' <span class="case-demo-tag">範例</span>' : ''}</p>
              ${c.clientName ? `<p class="case-client">${c.clientName}</p>` : ''}
              <p class="case-time">${c.timestamp}</p>
              ${surveyUrl ? `
              <div class="case-survey">
                <span class="case-survey-label">問卷連結</span>
                <a class="token-url" id="survey-url-${c.caseId}" href="${surveyUrl}" target="_blank" rel="noopener">${surveyUrl}</a>
                <button class="btn-copy" data-copy="survey-url-${c.caseId}">複製</button>
              </div>` : ''}
            </div>
            <div class="case-actions">
              <span class="case-badge ${badgeClass}">${badgeLabel}</span>
              <button class="btn-report btn-client" onclick="toggleNotes('${c.caseId}')">📝 筆記</button>
              <a class="btn-report btn-designer" href="${designerUrl}" target="_blank" rel="noopener">設計師報告 ↗</a>
              <a class="btn-report btn-client" href="${clientUrl}" target="_blank" rel="noopener">客戶報告 ↗</a>
              <a class="btn-report btn-client" href="${fillUrl}" target="_blank" rel="noopener">設計師補填 ↗</a>
              <button class="btn-report btn-rerun" id="rerun-${c.caseId}" onclick="rerunAnalysis('${c.caseId}')">🔄 重跑 AI</button>
            </div>
            <div class="case-notes-area" id="notes-area-${c.caseId}">
              <div class="note-history" id="note-history-${c.caseId}">
                <p class="muted" style="font-size:0.8rem;">載入筆記中…</p>
              </div>
              <div class="note-add-row">
                <textarea class="note-add-ta" id="${taId}" rows="3" placeholder="貼上會談逐字稿或錄音連結（用手機 / Otter / 超級轉錄等錄完，再貼回這裡），或手動輸入筆記…"></textarea>
                <div style="display:flex;flex-direction:column;gap:0.4rem;">
                  <button class="btn btn-primary" style="font-size:0.82rem;padding:0.4rem 0.75rem;" onclick="submitNote('${c.caseId}')">💾 儲存</button>
                </div>
              </div>
              <p class="muted" id="note-status-${c.caseId}" style="font-size:0.8rem;margin-top:0.4rem;"></p>
            </div>
          </div>
        `;
      }).join('');

  const demoBanner = casesAreDemo
    ? `<div class="demo-banner">
         👀 <strong>功能展示範例</strong>　以下這筆為示範資料，讓你預覽案件卡片的所有功能（問卷連結 / 報告 / 補填 / 筆記 / AI 狀態）。
         ${loadError ? `<span style="color:#a03030;">（後端暫時連不上：${loadError}）</span>` : '等真實案件提交後會自動取代。'}
         <button class="btn btn-ghost btn-sm" onclick="loadCasesList()" style="margin-left:0.5rem;">重新載入真實資料</button>
       </div>`
    : '';

  app.innerHTML = `
    ${demoBanner}
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
  $('#case-search')?.addEventListener('input', () => renderCasesList());
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

// === 載入照片清單（讀 data/photos.json，相容 GitHub Pages 靜態主機）===
// 註：GitHub Pages 不提供目錄索引，無法靠 fetch('assets/photos/') 解析 HTML 列表，
// 故改讀 photos.json 既有清單；新增照片時匯出新的 photos.json 覆蓋即可。
async function rescan() {
  setStatus('載入中…');
  try {
    const res = await fetch('data/photos.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`讀取 photos.json 失敗 HTTP ${res.status}`);
    const data = await res.json();
    const photos = Array.isArray(data.photos) ? data.photos : [];

    photoFiles = photos
      .map(p => p.filename || (p.src || '').split('/').pop())
      .filter(name => name && !name.startsWith('.') && IMG_EXTS.some(ext => name.toLowerCase().endsWith(ext)))
      .sort();

    // 以 photos.json 既有 tags 補種尚未在 localStorage 編輯過的照片
    photos.forEach(p => {
      const name = p.filename || (p.src || '').split('/').pop();
      if (name && !(name in tagState) && Array.isArray(p.tags)) {
        tagState[name] = p.tags.slice();
      }
    });
    saveTagState();

    renderGrid();
    setStatus(`已載入 · ${photoFiles.length} 張照片`);
  } catch (e) {
    setStatus('載入失敗：' + e.message, true);
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


// === 案件筆記 ===
async function toggleNotes(caseId) {
  const area = $('#notes-area-' + caseId);
  if (!area) return;
  const isOpen = area.classList.toggle('open');
  if (isOpen) await loadNotes(caseId);
}

async function loadNotes(caseId) {
  const histEl = $('#note-history-' + caseId);
  if (!histEl) return;
  if (casesAreDemo) {
    renderNoteHistory(caseId, [{
      timestamp: '2026-06-20 15:10',
      noteText: '丈量現場：客廳採光偏暗，屋主希望開放式廚房；主臥要增設更衣室；長輩房需無障礙動線。預算抓 250 萬。',
      parsedFields: JSON.stringify({ meeting_summary: [
        '客廳採光不足，考慮拆牆引光 / 玻璃隔間',
        '廚房改開放式，需確認管線與抽油煙排煙',
        '主臥增設更衣室',
        '長輩房無障礙動線（地坪齊平、扶手）',
        '預算上限約 NT$2,500,000',
      ] }),
    }]);
    return;
  }
  histEl.innerHTML = '<p class="muted" style="font-size:0.8rem;">載入中…</p>';
  try {
    const url = `${GAS_ENDPOINT_ADMIN}?action=get_notes&case_id=${encodeURIComponent(caseId)}&admin_token=${encodeURIComponent(ADMIN_KEY)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderNoteHistory(caseId, json.notes || []);
  } catch (err) {
    histEl.innerHTML = `<p style="font-size:0.8rem;color:var(--gln-error)">載入失敗：${err.message}</p>`;
  }
}

function renderNoteHistory(caseId, notes) {
  const histEl = $('#note-history-' + caseId);
  if (!histEl) return;
  if (notes.length === 0) {
    histEl.innerHTML = '<p class="muted" style="font-size:0.8rem;">尚無筆記記錄</p>';
    return;
  }
  histEl.innerHTML = notes.map(n => {
    let summary = '';
    try {
      const pf = typeof n.parsedFields === 'string' ? JSON.parse(n.parsedFields || '{}') : (n.parsedFields || {});
      if (pf.meeting_summary) {
        const items = Array.isArray(pf.meeting_summary)
          ? pf.meeting_summary
          : String(pf.meeting_summary).split(/\n|；|;/).map(s => s.trim()).filter(Boolean);
        summary = `<div class="note-summary"><strong>📌 統整重點</strong><ul>${
          items.map(s => `<li>${s.replace(/^[-・•\s]+/, '')}</li>`).join('')
        }</ul></div>`;
      }
    } catch (e) { /* parsedFields 解析失敗就只顯示原文 */ }
    return `
    <div class="note-item">
      <div class="note-item-ts">${n.timestamp}</div>
      ${summary}
      <div>${n.noteText.replace(/\n/g, '<br>')}</div>
    </div>
  `;
  }).join('');
}

async function submitNote(caseId) {
  const ta = $('#note-ta-' + caseId);
  const statusEl = $('#note-status-' + caseId);
  const text = (ta?.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = '請先輸入筆記內容'; return; }
  if (casesAreDemo) {
    if (statusEl) statusEl.textContent = '🅓 範例展示模式：實際送出會跑 AI 分析並寫入資料庫。有真實案件後即可使用。';
    return;
  }
  if (statusEl) statusEl.textContent = 'AI 分析中（約 10–20 秒）…';
  try {
    const res = await fetch(GAS_ENDPOINT_ADMIN, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'add_note', adminKey: ADMIN_KEY, caseId, noteText: text }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    ta.value = '';
    if (statusEl) statusEl.textContent = `✅ 已儲存（共 ${json.totalNotes} 筆筆記）`;
    await loadNotes(caseId); // 重新讀取歷史
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ 儲存失敗：' + err.message;
  }
}

// === 手動重跑 AI 分析（會再收一次 AI 費 ~NT$4.5）===
async function rerunAnalysis(caseId) {
  if (casesAreDemo) {
    alert('🅓 範例展示模式：實際重跑會呼叫 AI 分析（約 NT$4.5）。有真實案件後即可使用。');
    return;
  }
  if (!confirm(`重跑「${caseId}」的 AI 分析會再收一次費用（約 NT$4.5），確定要重跑嗎？`)) return;
  const btn = $('#rerun-' + caseId);
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 分析中…'; }
  try {
    const res = await fetch(GAS_ENDPOINT_ADMIN, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'rerun_analysis', adminKey: ADMIN_KEY, caseId }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    if (btn) btn.textContent = '✅ 已重跑';
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.disabled = false; } }, 2500);
  } catch (err) {
    if (btn) { btn.textContent = '❌ 失敗'; btn.disabled = false; }
    alert('重跑失敗：' + err.message);
    setTimeout(() => { if (btn) btn.textContent = orig; }, 2500);
  }
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
    const notes = ($('#notes-input')?.value || '').trim();
    const brand = ($('#pf-brand')?.value || 'GLN');
    const prefill = {
      client_name:   name,
      client_phone:  ($('#pf-client-phone')?.value  || '').trim(),
      client_email:  ($('#pf-client-email')?.value  || '').trim(),
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
    const statusEl = $('#notes-parse-status');

    try {
      let json;
      if (notes) {
        // 有筆記 → AI 解析 + 手填欄位優先覆蓋
        btn.textContent = 'AI 解析中…';
        if (statusEl) statusEl.textContent = '約需 10–20 秒…';
        const res = await fetch(GAS_ENDPOINT_ADMIN, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'prefill_from_notes', adminKey: ADMIN_KEY, notes, brand, location: prefill.house_address, prefillOverride: prefill }),
        });
        json = await res.json();
        if (!json.ok) throw new Error(json.error || 'AI 解析失敗');
        if (statusEl) statusEl.textContent = '✅ AI 解析完成';
      } else {
        // 沒有筆記 → 直接產生 token
        btn.textContent = '產生中…';
        const res = await fetch(GAS_ENDPOINT_ADMIN, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'create_token', adminKey: ADMIN_KEY, note, brand, location: prefill.house_address, prefill }),
        });
        json = await res.json();
        if (!json.ok) throw new Error(json.error || '產生失敗');
      }

      const clientLink = $('#token-client-url');
      const designerLink = $('#token-designer-url');
      clientLink.href = json.clientUrl;
      clientLink.textContent = json.clientUrl;
      designerLink.href = json.designerReportUrl || '#';
      designerLink.textContent = json.designerReportUrl || '（客戶送出後自動寄出）';

      const titleEl = $('#token-result-title');
      if (titleEl) {
        titleEl.textContent = json.reused
          ? '此客戶已有連結，已沿用既有連結（未重複建立案件）'
          : '連結已產生';
      }

      resultEl.style.display = 'block';
      // 清空所有欄位
      noteInput.value = '';
      if ($('#notes-input')) $('#notes-input').value = '';
      ['pf-client-name','pf-client-phone','pf-client-email','pf-house-address','pf-house-size','pf-house-age','pf-budget'].forEach(id => {
        const el = $('#' + id); if (el) el.value = '';
      });
      ['pf-house-type','pf-case-type'].forEach(id => {
        const el = $('#' + id); if (el) el.selectedIndex = 0;
      });
    } catch (err) {
      errorEl.textContent = '產生失敗：' + err.message;
      errorEl.style.display = 'block';
      if (statusEl) statusEl.textContent = '';
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ 產生客戶連結';
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
