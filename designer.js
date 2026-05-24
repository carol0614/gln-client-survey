/* ============================================================
   GLN 客戶問卷 — 設計師補填頁
   URL: /designer.html?t=<designer_token>&id=<caseId>&demo=1
   ============================================================ */

const GAS_ENDPOINT = '';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const designerToken = params.get('t');
const caseId = params.get('id') || 'GLN-DEMO';
const isAdmin = params.get('admin') === '1';
const demoMode = params.get('demo') === '1' || !GAS_ENDPOINT;

const banner = $('#token-banner');
if (!designerToken && !demoMode) {
  banner.style.display = 'block';
  banner.classList.add('error');
  banner.innerHTML = '⚠️ 缺少設計師 token，無法存取此案件。<br><small>開發：URL 加 <code>?demo=1</code> 預覽</small>';
}

let caseData = null;

async function loadCase() {
  if (demoMode) {
    return fetch('data/demo-case.json').then(r => r.json());
  }
  const url = `${GAS_ENDPOINT}?id=${encodeURIComponent(caseId)}&v=designer`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'load failed');
  return { caseId: json.data.caseId, timestamp: json.data.timestamp, data: json.data.data };
}

function val(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  if (Array.isArray(v)) return v.length ? v.join(' · ') : fallback;
  return v;
}

function extractMembers(data) {
  const count = parseInt(data._memberCount || 0, 10);
  const members = [];
  for (let i = 1; i <= count; i++) {
    const m = { id: i };
    const prefix = `member-${i}_`;
    Object.keys(data).forEach(k => {
      if (k.startsWith(prefix)) {
        m[k.slice(prefix.length)] = data[k];
      }
    });
    if (m.role || m.age) members.push(m);
  }
  return members;
}

function render(caseData) {
  const d = caseData.data;
  const members = extractMembers(d);

  $('#case-info').textContent = `${caseData.caseId} · ${val(d.case_type)} · ${val(d.house_size)} 坪`;

  const root = $('#designer-content');
  root.innerHTML = `
    <section class="section">
      <h2>客戶答案（唯讀）</h2>
      <p class="section-meta">${isAdmin ? '⚠️ 你目前處於總監模式，可覆寫客戶答案' : '此區僅供參考，無法修改'}</p>

      <h3>家庭結構</h3>
      <table class="report-table">
        <thead><tr><th>稱謂</th><th>年齡</th><th>職業</th><th>主要需求</th></tr></thead>
        <tbody>
          ${members.map(m => `
            <tr>
              <td>${val(m.role)}</td>
              <td>${val(m.age)}</td>
              <td>${val(m.occupation)}</td>
              <td>${val(m.main_need)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <h3>背景</h3>
      <div class="kv-grid">
        <div><strong>形態：</strong>${val(d.house_type)}</div>
        <div><strong>坪數：</strong>${val(d.house_size)}</div>
        <div><strong>屋齡：</strong>${val(d.house_age)} 年</div>
        <div><strong>預算：</strong>${val(d.budget)}</div>
        <div><strong>入住：</strong>${val(d.move_in_date)}</div>
        <div><strong>分類：</strong>${val(d.case_type)}</div>
      </div>

      <h3>痛點與期待</h3>
      <p><strong>痛點：</strong>${val(d.pain_points)}</p>
      <p><strong>許願清單：</strong>${val(d.wishlist)}</p>
      <p><strong>重視 Top 3：</strong>${val(d.priority_1)} / ${val(d.priority_2)} / ${val(d.priority_3)}</p>
    </section>

    <section class="section">
      <h2>設計師補填區</h2>
      <p class="section-meta">補完家電型號 / 電壓，做配電規劃用。</p>

      <h3>配電補填（從客戶選擇的設備清單擴充）</h3>
      <div id="power-list"></div>

      <h3 style="margin-top:2rem;">設備品牌建議 / 覆寫</h3>
      <p class="muted">客戶已選的品牌列在下方，設計師可建議替代品牌或補充型號。</p>
      <div id="brand-overrides"></div>
    </section>

    <section class="section">
      <h2>總監備註</h2>
      <p class="section-meta">案件分類、特殊處理建議、預算策略等。會出現在設計師版報告。</p>
      <textarea id="designer-notes" placeholder="例：客戶預算彈性 +10%，可推薦中島升級方案；老屋翻新需特別處理管線..."></textarea>
    </section>
  `;

  renderPowerList(d);
  renderBrandOverrides(d);

  $('#designer-notes').value = d.designer_notes || '';
}

function renderPowerList(d) {
  const equipmentKeys = Object.keys(d).filter(k => k.startsWith('eq_') && k.endsWith('_brand') && d[k]);
  const root = $('#power-list');
  if (!equipmentKeys.length) {
    root.innerHTML = '<p class="muted">客戶尚未選擇任何設備。</p>';
    return;
  }
  root.innerHTML = `
    <table class="report-table editable">
      <thead><tr><th>項目</th><th>品牌</th><th>型號</th><th>電壓 / 功率</th><th>專插</th></tr></thead>
      <tbody>
        ${equipmentKeys.map(k => {
          const item = k.slice(3, -6);
          const brand = d[k];
          return `
            <tr>
              <td>${item}</td>
              <td><strong>${brand}</strong></td>
              <td><input type="text" data-field="${k.replace('_brand','_model_designer')}" /></td>
              <td><input type="text" data-field="${k.replace('_brand','_voltage_designer')}" placeholder="例：220V / 1.5kW" /></td>
              <td><input type="checkbox" data-field="${k.replace('_brand','_dedicated_designer')}" /></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderBrandOverrides(d) {
  const root = $('#brand-overrides');
  const equipmentKeys = Object.keys(d).filter(k => k.startsWith('eq_') && k.endsWith('_brand') && d[k]);
  if (!equipmentKeys.length) {
    root.innerHTML = '<p class="muted">客戶尚未選擇任何設備品牌。</p>';
    return;
  }
  root.innerHTML = equipmentKeys.map(k => {
    const item = k.slice(3, -6);
    const brand = d[k];
    return `
      <div class="field-row" style="grid-template-columns: 200px 200px 1fr;">
        <div class="muted">${item}</div>
        <div><strong>客戶選：</strong>${brand}</div>
        <input type="text" placeholder="設計師建議 / 備註" data-field="eq_${item}_designer_note" />
      </div>
    `;
  }).join('');
}

// === 儲存 ===
$('#save-btn').addEventListener('click', async () => {
  const updates = {};
  $$('[data-field]').forEach(el => {
    if (el.type === 'checkbox') updates[el.dataset.field] = el.checked;
    else if (el.value) updates[el.dataset.field] = el.value;
  });
  updates.designer_notes = $('#designer-notes').value;

  const status = $('#save-status');
  status.style.display = 'block';

  if (demoMode) {
    status.className = 'status-banner info';
    status.textContent = '（demo 模式）儲存將寫入：' + JSON.stringify(updates).slice(0, 100) + '…';
    return;
  }

  if (!GAS_ENDPOINT) {
    status.className = 'status-banner error';
    status.textContent = '尚未設定 GAS_ENDPOINT。';
    return;
  }

  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'designer_update',
        token: designerToken,
        caseId,
        updates,
      }),
    });
    const result = await res.json();
    if (result.ok) {
      status.className = 'status-banner success';
      status.textContent = '已儲存。';
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    status.className = 'status-banner error';
    status.textContent = '儲存失敗：' + err.message;
  }
});

// === 報告連結 ===
$('#view-report').href = `report.html?id=${caseId}&v=designer${demoMode ? '&demo=1' : ''}`;

// === Init ===
(async () => {
  try {
    caseData = await loadCase();
    render(caseData);
  } catch (err) {
    $('#designer-content').innerHTML = `<div class="status-banner error">載入失敗：${err.message}</div>`;
  }
})();
