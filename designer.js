/* ============================================================
   GLN 客戶問卷 — 設計師補填頁
   URL: /designer.html?t=<designer_token>&id=<caseId>&demo=1
   ============================================================ */

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzCpoKgXvana8_6cxxB1jrn0qCW8ulw7iX-vVrDJbqCQZ36KjAhHJRNAd489N_z564zsw/exec';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const designerToken = params.get('t');
const adminKey = params.get('k'); // 後台補填用 admin key 授權
const caseId = params.get('id') || 'GLN-DEMO';
const isAdmin = params.get('admin') === '1';
const demoMode = params.get('demo') === '1' || !GAS_ENDPOINT;

const banner = $('#token-banner');
if (!designerToken && !adminKey && !demoMode) {
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
      <h2>💰 實際預算分配（提案版）</h2>
      <p class="section-meta">
        丈量提案後，依實際報價單填入各項金額（單位：元）。供設計師 / 客戶 / 總監三方對齊。
        <strong>未填則報告不顯示此區塊。</strong>監工費與稅金填百分比，系統自動計算。
      </p>
      <div class="ba-toolbar">
        <button type="button" id="budget-tpl-btn" class="btn btn-ghost btn-sm">⬇ 下載預算範本</button>
        <label for="budget-file" class="btn btn-ghost btn-sm" style="cursor:pointer;">⬆ 上傳 Excel 自動填入</label>
        <input type="file" id="budget-file" accept=".xlsx,.xls" style="display:none;" />
        <span class="muted" id="budget-upload-status"></span>
      </div>
      <div id="budget-unmatched"></div>
      <div id="budget-alloc"></div>
    </section>
  `;

  renderPowerList(d);
  renderBrandOverrides(d);
  renderBudgetAlloc(d);
}

// ============================================================
// === 實際預算分配（提案版）===
// 大欄位 → 子欄位（可增列）；監工費/稅金填 % 自動算。
// 課稅（計入工程費 → 監工費 + 稅金基礎）：基礎工程、裝修工程
// 另計 / 已含稅（不再課稅）：設備、軟裝家具、設計費
// ============================================================
const BUDGET_GROUP_TEMPLATE = [
  { name: '基礎工程', taxable: true,  items: ['假設工程', '拆除工程', '泥作工程', '門扇工程', '水電工程'] },
  { name: '裝修工程', taxable: true,  items: ['木作工程', '油漆工程', '超耐磨地板工程', '玻璃工程', '空調工程', '清潔工程'] },
  { name: '設備（代辦項目·已含稅）', taxable: false, items: ['智慧家居', '衛浴設備', '廚具設備', '磁磚材料'] },
  { name: '軟裝家具', taxable: false, items: ['沙發', '燈具', '窗簾', '桌椅'] },
  { name: '設計費',   taxable: false, items: ['設計費', '工管費'] },
];

let budgetState = null;

function buildBudgetState(saved) {
  if (saved && Array.isArray(saved.groups)) return JSON.parse(JSON.stringify(saved));
  return {
    groups: BUDGET_GROUP_TEMPLATE.map(g => ({
      name: g.name,
      taxable: g.taxable,
      items: g.items.map(n => ({ name: n, amount: 0 })),
    })),
    supervision_pct: 10,
    tax_pct: 5,
  };
}

function computeBudget(state) {
  let engineering = 0;
  const groupTotals = state.groups.map(g => {
    const sub = g.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    if (g.taxable) engineering += sub;
    return sub;
  });
  const supervision = Math.round(engineering * (Number(state.supervision_pct) || 0) / 100);
  const tax = Math.round((engineering + supervision) * (Number(state.tax_pct) || 0) / 100);
  const otherTotal = state.groups.reduce((s, g, i) => s + (g.taxable ? 0 : groupTotals[i]), 0);
  const preTax = engineering + supervision + otherTotal;
  const withTax = preTax + tax;
  return { groupTotals, engineering, supervision, tax, otherTotal, preTax, withTax };
}

function budgetHasData(state) {
  if (!state) return false;
  return state.groups.some(g => g.items.some(it => (Number(it.amount) || 0) > 0));
}

const fmtNT = n => 'NT$ ' + (Number(n) || 0).toLocaleString('en-US');

function renderBudgetAlloc(d) {
  budgetState = buildBudgetState(d.budget_allocation);
  drawBudgetAlloc();
  wireBudgetTools();
}

// === Excel 一鍵上傳 / 範本下載 ===
function wireBudgetTools() {
  const tplBtn = $('#budget-tpl-btn');
  const fileInput = $('#budget-file');
  if (tplBtn) tplBtn.onclick = downloadBudgetTemplate;
  if (fileInput) fileInput.onchange = () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) parseUploadedBudget(f);
    fileInput.value = '';
  };
}

function setBudgetUploadStatus(msg, isErr) {
  const el = $('#budget-upload-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isErr ? '#a05068' : '#4a7040';
}

// 依目前 budgetState（含設計師已增列的子項）產出標準範本
function downloadBudgetTemplate() {
  if (typeof XLSX === 'undefined') { setBudgetUploadStatus('Excel 元件載入失敗，請重新整理頁面', true); return; }
  const rows = [['大分類', '項目', '金額（元）']];
  budgetState.groups.forEach(g => {
    g.items.forEach(it => rows.push([g.name, it.name, it.amount || '']));
  });
  rows.push([]);
  rows.push(['費率設定', '監工費管理費(%)', budgetState.supervision_pct]);
  rows.push(['費率設定', '稅金(%)', budgetState.tax_pct]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '預算分配');
  XLSX.writeFile(wb, `GLN-預算分配範本-${caseId || 'GLN'}.xlsx`);
  setBudgetUploadStatus('範本已下載，填好金額後再上傳', false);
}

function parseUploadedBudget(file) {
  if (typeof XLSX === 'undefined') { setBudgetUploadStatus('Excel 元件載入失敗，請重新整理頁面', true); return; }
  const reader = new FileReader();
  reader.onload = e => {
    let wb;
    try {
      wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
    } catch (err) {
      setBudgetUploadStatus('檔案無法解析，請確認是 .xlsx 範本格式', true);
      return;
    }
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) { setBudgetUploadStatus('找不到工作表內容', true); return; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
    applyParsedBudget(aoa);
  };
  reader.readAsArrayBuffer(file);
}

function applyParsedBudget(aoa) {
  if (!budgetState) return;
  // 建索引：優先用（大分類 + 項目）精準對應，退而求其次只比項目名
  const pairIndex = {};
  const nameIndex = {};
  budgetState.groups.forEach((g, gi) => g.items.forEach((it, ii) => {
    pairIndex[g.name.trim() + '\u0000' + it.name.trim()] = { gi, ii };
    (nameIndex[it.name.trim()] = nameIndex[it.name.trim()] || []).push({ gi, ii });
  }));
  const unmatched = [];
  let matched = 0;
  aoa.forEach((row, ri) => {
    if (ri === 0) return; // 標題列
    const cat = String(row[0] == null ? '' : row[0]).trim();
    const item = String(row[1] == null ? '' : row[1]).trim();
    if (!item || item === '項目') return;
    if (cat === '費率設定') {
      if (item.indexOf('監工') >= 0) budgetState.supervision_pct = parseFloat(row[2]) || 0;
      else if (item.indexOf('稅') >= 0) budgetState.tax_pct = parseFloat(row[2]) || 0;
      return;
    }
    const amount = parseAmount(row[2]);
    const target = pairIndex[cat + '\u0000' + item] || (nameIndex[item] && nameIndex[item][0]);
    if (target) {
      budgetState.groups[target.gi].items[target.ii].amount = amount;
      matched++;
    } else {
      unmatched.push({ cat, item, amount });
    }
  });
  drawBudgetAlloc();
  renderBudgetUnmatched(unmatched);
  setBudgetUploadStatus(
    `已匯入：${matched} 項自動對應` + (unmatched.length ? `，${unmatched.length} 項待指派` : '，全部對應完成'),
    false
  );
}

// 未匹配項目：列清單，讓設計師指派到分類或略過
function renderBudgetUnmatched(list) {
  const root = $('#budget-unmatched');
  if (!root) return;
  if (!list || !list.length) { root.innerHTML = ''; return; }
  root.innerHTML = `
    <div class="ba-unmatched">
      <div class="ba-unmatched-head">未匹配項目（${list.length}）— 請指派到分類，或略過</div>
      ${list.map((u, idx) => `
        <div class="ba-unmatched-row">
          <span class="ba-unmatched-name">${escapeAttr(u.item)}${u.cat ? `<small>（原分類：${escapeAttr(u.cat)}）</small>` : ''}</span>
          <span class="ba-unmatched-amt">${fmtNT(u.amount)}</span>
          <select class="ba-unmatched-sel" data-idx="${idx}">
            <option value="">— 指派到分類 —</option>
            ${budgetState.groups.map((g, gi) => `<option value="${gi}">${escapeAttr(g.name)}</option>`).join('')}
            <option value="skip">略過此項</option>
          </select>
        </div>
      `).join('')}
    </div>
  `;
  const remaining = list.slice();
  $$('.ba-unmatched-sel', root).forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.idx;
      const u = remaining[idx];
      if (!u || sel.value === '') return;
      if (sel.value !== 'skip') {
        budgetState.groups[+sel.value].items.push({ name: u.item, amount: u.amount });
        drawBudgetAlloc();
      }
      remaining[idx] = null;
      const left = remaining.filter(Boolean);
      renderBudgetUnmatched(left);
      if (!left.length) setBudgetUploadStatus('全部項目已指派完成', false);
    });
  });
}

function drawBudgetAlloc() {
  const root = $('#budget-alloc');
  const c = computeBudget(budgetState);
  root.innerHTML = `
    ${budgetState.groups.map((g, gi) => `
      <div class="ba-group">
        <div class="ba-group-head">
          <span class="ba-group-name">${g.name}</span>
          <span class="ba-group-tag">${g.taxable ? '計入工程費（課監工＋稅）' : '另計／已含稅'}</span>
        </div>
        <table class="ba-table">
          <tbody>
            ${g.items.map((it, ii) => `
              <tr>
                <td><input type="text" class="ba-item-name" value="${escapeAttr(it.name)}" data-g="${gi}" data-i="${ii}" data-k="name" placeholder="項目名稱" /></td>
                <td class="ba-amount-cell">
                  <input type="text" inputmode="numeric" class="ba-item-amount" value="${it.amount ? Number(it.amount).toLocaleString('en-US') : ''}" data-g="${gi}" data-i="${ii}" data-k="amount" placeholder="0" />
                </td>
                <td class="ba-del-cell"><button type="button" class="ba-del" data-g="${gi}" data-i="${ii}" title="刪除此列">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="ba-group-foot">
          <button type="button" class="ba-add" data-g="${gi}">＋ 新增子項</button>
          <span class="ba-group-sub">小計 ${fmtNT(c.groupTotals[gi])}</span>
        </div>
      </div>
    `).join('')}

    <div class="ba-rates">
      <label>監工費管理費 <input type="number" class="ba-rate" data-rate="supervision_pct" value="${budgetState.supervision_pct}" min="0" max="100" step="0.5" /> %</label>
      <label>稅金 <input type="number" class="ba-rate" data-rate="tax_pct" value="${budgetState.tax_pct}" min="0" max="100" step="0.5" /> %</label>
    </div>

    <div class="ba-summary">
      <div class="ba-sum-row"><span>工程費合計（基礎＋裝修）</span><span>${fmtNT(c.engineering)}</span></div>
      <div class="ba-sum-row"><span>監工費管理費（${budgetState.supervision_pct}%）</span><span>${fmtNT(c.supervision)}</span></div>
      <div class="ba-sum-row"><span>稅金（${budgetState.tax_pct}%）</span><span>${fmtNT(c.tax)}</span></div>
      <div class="ba-sum-row"><span>其他（設備／軟裝／設計費）</span><span>${fmtNT(c.otherTotal)}</span></div>
      <div class="ba-sum-row ba-sum-total"><span>總合計（未稅）</span><span>${fmtNT(c.preTax)}</span></div>
      <div class="ba-sum-row ba-sum-total ba-sum-final"><span>含稅後總合計</span><span>${fmtNT(c.withTax)}</span></div>
    </div>
  `;

  // item 欄位輸入
  $$('.ba-item-name, .ba-item-amount', root).forEach(el => {
    el.addEventListener('input', () => {
      const g = +el.dataset.g, i = +el.dataset.i, k = el.dataset.k;
      if (k === 'amount') {
        budgetState.groups[g].items[i].amount = parseAmount(el.value);
      } else {
        budgetState.groups[g].items[i].name = el.value;
      }
      refreshBudgetTotals();
    });
  });
  // 金額欄失焦補千分位
  $$('.ba-item-amount', root).forEach(el => {
    el.addEventListener('blur', () => {
      const v = parseAmount(el.value);
      el.value = v ? v.toLocaleString('en-US') : '';
    });
  });
  // 增列
  $$('.ba-add', root).forEach(btn => btn.addEventListener('click', () => {
    budgetState.groups[+btn.dataset.g].items.push({ name: '', amount: 0 });
    drawBudgetAlloc();
  }));
  // 刪列
  $$('.ba-del', root).forEach(btn => btn.addEventListener('click', () => {
    budgetState.groups[+btn.dataset.g].items.splice(+btn.dataset.i, 1);
    drawBudgetAlloc();
  }));
  // 費率
  $$('.ba-rate', root).forEach(el => el.addEventListener('input', () => {
    budgetState[el.dataset.rate] = parseFloat(el.value) || 0;
    refreshBudgetTotals();
  }));
}

function refreshBudgetTotals() {
  const c = computeBudget(budgetState);
  const root = $('#budget-alloc');
  $$('.ba-group', root).forEach((el, gi) => {
    const sub = el.querySelector('.ba-group-sub');
    if (sub) sub.textContent = '小計 ' + fmtNT(c.groupTotals[gi]);
  });
  const rows = $$('.ba-summary .ba-sum-row span:last-child', root);
  if (rows.length === 6) {
    rows[0].textContent = fmtNT(c.engineering);
    rows[1].textContent = fmtNT(c.supervision);
    rows[2].textContent = fmtNT(c.tax);
    rows[3].textContent = fmtNT(c.otherTotal);
    rows[4].textContent = fmtNT(c.preTax);
    rows[5].textContent = fmtNT(c.withTax);
  }
}

function parseAmount(raw) {
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  // 實際預算分配（提案版）：有填才送；全 0 視為清空
  if (budgetState) {
    updates.budget_allocation = budgetHasData(budgetState)
      ? { ...budgetState, updated_at: new Date().toISOString() }
      : null;
  }

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
        adminKey,
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

// ============================================================
// === 會議紀錄（內部開會筆記 / 客戶會議筆記 + 備註）===
// ============================================================
const MN_AUTHOR_LABEL = { director: '總監', designer: '設計師', client: '客戶' };

const MN_DEMO = [
  {
    timestamp: '2026-06-20 15:10', noteType: 'internal', author: 'director',
    noteText: '丈量現場：客廳採光偏暗，屋主希望開放式廚房；主臥要增設更衣室；長輩房需無障礙動線。預算抓 250 萬。',
    parsedFields: JSON.stringify({ meeting_summary: [
      '客廳採光不足，考慮拆牆引光 / 玻璃隔間',
      '廚房改開放式，需確認管線與抽油煙排煙',
      '主臥增設更衣室',
    ] }),
  },
  {
    timestamp: '2026-06-21 11:00', noteType: 'client', author: 'designer',
    noteText: '第一次設計提案會議：客戶確認開放式廚房方向，玄關要加鞋櫃與穿鞋椅。',
    parsedFields: JSON.stringify({ meeting_summary: ['確認開放式廚房，中島含電陶爐', '玄關增設鞋櫃 + 穿鞋椅'] }),
  },
  { timestamp: '2026-06-21 15:30', noteType: 'comment', author: 'client', noteText: '中島想再大一點，可以坐 3 個人嗎？' },
];

function mnSummaryHtml(n) {
  try {
    const pf = typeof n.parsedFields === 'string' ? JSON.parse(n.parsedFields || '{}') : (n.parsedFields || {});
    if (pf.meeting_summary) {
      const items = Array.isArray(pf.meeting_summary)
        ? pf.meeting_summary
        : String(pf.meeting_summary).split(/\n|；|;/).map(s => s.trim()).filter(Boolean);
      return `<div class="mn-summary"><strong>📌 統整重點</strong><ul>${
        items.map(s => `<li>${s.replace(/^[-・•\s]+/, '')}</li>`).join('')
      }</ul></div>`;
    }
  } catch (e) {}
  return '';
}

function renderMeetingNotes(notes) {
  const root = $('#mn-history');
  if (!root) return;
  const internal = (notes || []).filter(n => n.noteType === 'internal' || !n.noteType);
  const client = (notes || []).filter(n => n.noteType === 'client');
  const comments = (notes || []).filter(n => n.noteType === 'comment');

  const item = (n) => `
    <div class="mn-item">
      <div class="mn-item-ts">${n.timestamp}${n.author ? ` · ${MN_AUTHOR_LABEL[n.author] || n.author}` : ''}</div>
      ${mnSummaryHtml(n)}
      <div>${(n.noteText || '').replace(/\n/g, '<br>')}</div>
    </div>`;

  const internalBlock = `<div class="mn-group"><div class="mn-group-head mn-group-internal">🔒 內部開會筆記（總監＋設計師）</div>${
    internal.length ? internal.map(item).join('') : '<p class="muted" style="font-size:.82rem;">尚無內部筆記</p>'
  }</div>`;

  const commentItem = (c) => `
    <div class="mn-comment ${c.author}">
      <span class="mn-comment-author">${MN_AUTHOR_LABEL[c.author] || c.author}</span>
      <span class="mn-comment-text">${(c.text || c.noteText || '').replace(/\n/g, '<br>')}</span>
      <span class="mn-comment-ts">${c.timestamp}</span>
    </div>`;

  const commentsBlock = `
    <div class="mn-comment-thread">
      <div class="mn-comment-head">💬 備註（總監／設計師／客戶皆可留言）</div>
      ${comments.length ? comments.map(commentItem).join('') : '<p class="muted" style="font-size:.78rem;">尚無備註</p>'}
      <div class="mn-comment-add">
        <input id="mn-comment-input" type="text" placeholder="以設計師身分新增備註…" />
        <button type="button" class="btn btn-ghost" id="mn-comment-send">送出備註</button>
      </div>
      <p class="muted" id="mn-comment-status" style="font-size:.78rem;margin-top:.3rem;"></p>
    </div>`;

  const clientBlock = `<div class="mn-group"><div class="mn-group-head mn-group-client">👤 客戶會議筆記（重點條列會顯示在客戶報告頁）</div>${
    client.length ? client.map(item).join('') : '<p class="muted" style="font-size:.82rem;">尚無客戶會議筆記</p>'
  }${commentsBlock}</div>`;

  root.innerHTML = internalBlock + clientBlock;
  $('#mn-comment-send')?.addEventListener('click', submitMeetingComment);
}

async function loadMeetingNotes() {
  const root = $('#mn-history');
  if (!root) return;
  if (demoMode) { renderMeetingNotes(MN_DEMO); return; }
  if (!designerToken) { root.innerHTML = '<p class="muted" style="font-size:.85rem;">缺少設計師 token，無法載入會議紀錄。</p>'; return; }
  try {
    const url = `${GAS_ENDPOINT}?action=get_notes&case_id=${encodeURIComponent(caseId)}&designer_token=${encodeURIComponent(designerToken)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderMeetingNotes(json.notes || []);
  } catch (err) {
    root.innerHTML = `<p class="muted" style="font-size:.85rem;color:#a03030;">載入失敗：${err.message}</p>`;
  }
}

async function submitMeetingNote() {
  const statusEl = $('#mn-status');
  const text = ($('#mn-text')?.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = '請先輸入筆記內容'; return; }
  const noteType = document.querySelector('input[name="mn-type"]:checked')?.value || 'internal';
  if (demoMode) { if (statusEl) statusEl.textContent = '（demo 模式）實際送出會跑 AI 分析並寫入資料庫。'; return; }
  if (statusEl) statusEl.textContent = 'AI 分析中（約 10–20 秒）…';
  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'add_note', designerToken, caseId, noteText: text, noteType }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    $('#mn-text').value = '';
    const typeLabel = noteType === 'client' ? '客戶會議筆記' : '內部開會筆記';
    if (statusEl) statusEl.textContent = `✅ 已儲存為${typeLabel}`;
    await loadMeetingNotes();
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ 儲存失敗：' + err.message;
  }
}

async function submitMeetingComment() {
  const statusEl = $('#mn-comment-status');
  const input = $('#mn-comment-input');
  const text = (input?.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = '請先輸入備註內容'; return; }
  if (demoMode) { if (statusEl) statusEl.textContent = '（demo 模式）實際送出會寫入資料庫。'; return; }
  if (statusEl) statusEl.textContent = '送出中…';
  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'add_comment', designerToken, caseId, commentText: text }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    input.value = '';
    if (statusEl) statusEl.textContent = '✅ 備註已送出';
    await loadMeetingNotes();
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ 送出失敗：' + err.message;
  }
}

$('#mn-save')?.addEventListener('click', submitMeetingNote);

// === Init ===
(async () => {
  try {
    caseData = await loadCase();
    render(caseData);
  } catch (err) {
    $('#designer-content').innerHTML = `<div class="status-banner error">載入失敗：${err.message}</div>`;
  }
  loadMeetingNotes();
})();
