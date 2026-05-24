/* ============================================================
   GLN 客戶問卷 — 前端邏輯
   ============================================================ */

// === 設定 ===
const GAS_ENDPOINT = ''; // TODO: 部署後填入 GAS Web App URL
const AUTOSAVE_KEY = 'gln_survey_draft_v1';
const AUTOSAVE_INTERVAL = 3000; // ms

// === 工具 ===
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function getURLParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// === Token 驗證 ===
const token = getURLParam('t');
const tokenBanner = $('#token-banner');
if (!token) {
  tokenBanner.style.display = 'block';
  tokenBanner.classList.remove('info');
  tokenBanner.classList.add('error');
  tokenBanner.innerHTML = '⚠️ 缺少存取 token。請使用 GLN 提供的專屬連結進入。<br><small>開發模式：URL 加 <code>?t=test</code> 可預覽</small>';
}

// === 動態家庭成員 ===
const memberFields = [
  { key: 'role', label: '稱謂', type: 'text', placeholder: '例：爸爸 / 媽媽 / 老大 / 寵物名' },
  { key: 'age', label: '年齡', type: 'number' },
  { key: 'occupation', label: '職業', type: 'text' },
  { key: 'height', label: '身高 (cm)', type: 'number' },
  { key: 'lifestyle', label: '型態', type: 'text', placeholder: '居家 / 外勤 / 早鳥 / 夜貓' },
  { key: 'sleep', label: '睡眠習慣', type: 'text', placeholder: '早睡 / 晚睡 / 淺眠 / 需遮光' },
  { key: 'common_area', label: '常用區域', type: 'text', placeholder: '客廳 / 書房 / 廚房' },
  { key: 'space_need', label: '空間需求', type: 'text' },
  { key: 'wardrobe_need', label: '衣櫃需求', type: 'text', placeholder: '衣量、種類' },
  { key: 'wardrobe_style', label: '衣櫃樣式', type: 'text', placeholder: '開放 / 封閉 / 吊掛比例' },
  { key: 'hobbies', label: '休閒娛樂', type: 'text' },
  { key: 'health', label: '健康需求', type: 'text', placeholder: '過敏 / 慢性病 / 行動需求' },
  { key: 'faith', label: '信仰需求', type: 'text', placeholder: '神明廳 / 禁忌' },
  { key: 'main_need', label: '主要需求', type: 'textarea' },
  { key: 'special_need', label: '特殊需求', type: 'textarea', placeholder: '無障礙、寵物動線、嬰幼兒安全' },
];

const responsibilityRoles = [
  ['家事', 'r_housework'],
  ['烹飪', 'r_cooking'],
  ['收納', 'r_storage'],
  ['風格', 'r_style'],
  ['風水', 'r_fengshui'],
  ['資金', 'r_finance'],
];

let memberCounter = 0;

function createMemberCard(prefill = {}) {
  memberCounter++;
  const id = `member-${memberCounter}`;
  const card = document.createElement('div');
  card.className = 'member-card';
  card.dataset.memberId = id;

  card.innerHTML = `
    <button type="button" class="remove-btn" aria-label="移除此成員">移除</button>
    <div class="member-card-header">家庭成員 #${memberCounter}</div>
    <div class="field-row">
      ${memberFields.map(f => `
        <div class="field">
          <label>${f.label}</label>
          ${f.type === 'textarea'
            ? `<textarea name="${id}_${f.key}" placeholder="${f.placeholder || ''}"></textarea>`
            : `<input type="${f.type}" name="${id}_${f.key}" placeholder="${f.placeholder || ''}" />`}
        </div>
      `).join('')}
    </div>
    <div class="field">
      <label>負責人標記（勾選此成員負責的項目）</label>
      <div class="checkbox-group" data-name="${id}_responsibilities">
        ${responsibilityRoles.map(([label, key]) => `
          <label class="chip"><input type="checkbox" value="${label}" data-key="${id}_${key}" /><span>${label}</span></label>
        `).join('')}
      </div>
    </div>
  `;

  // Prefill if provided
  Object.entries(prefill).forEach(([name, val]) => {
    const input = card.querySelector(`[name="${name}"]`);
    if (input) input.value = val;
  });

  card.querySelector('.remove-btn').addEventListener('click', () => {
    if (confirm('確定要移除這位成員？')) {
      card.remove();
      updateProgress();
      saveDraft();
    }
  });

  return card;
}

function addMember(prefill) {
  const card = createMemberCard(prefill);
  $('#members-list').appendChild(card);
  bindChipBehavior(card);
  updateProgress();
}

$('#add-member').addEventListener('click', () => addMember());

// === Chip 樣式同步 ===
function bindChipBehavior(root = document) {
  $$('.chip input[type="checkbox"]', root).forEach(cb => {
    if (cb.dataset._bound) return;
    cb.dataset._bound = '1';
    const label = cb.closest('.chip');
    if (cb.checked) label.classList.add('active');
    cb.addEventListener('change', () => {
      label.classList.toggle('active', cb.checked);
      updateProgress();
      saveDraft();
    });
  });
}
bindChipBehavior();

// === 設備清單渲染（下拉選單 + 其他自填）===
async function renderEquipmentList() {
  const [areasData, brandsData] = await Promise.all([
    fetch('data/areas.json').then(r => r.json()),
    fetch('data/brands.json').then(r => r.json()),
  ]);
  const brandMap = brandsData.brands || {};
  const root = $('#equipment-list');

  areasData.equipment_categories.forEach(cat => {
    const catDiv = document.createElement('div');
    catDiv.innerHTML = `<div class="equipment-category">${cat.name}</div>`;
    cat.items.forEach(item => {
      const safeKey = `eq_${cat.key}_${item.replace(/[^a-zA-Z0-9一-龥]/g, '_')}`;
      const options = brandMap[item] || [];
      const optionsHtml = options.map(b => `<option value="${b}">${b}</option>`).join('');

      const row = document.createElement('div');
      row.className = 'equipment-row equipment-row--select';
      row.innerHTML = `
        <div class="label">${item}</div>
        <select name="${safeKey}_brand" data-key="${safeKey}">
          <option value="">請選擇品牌</option>
          ${optionsHtml}
          <option value="__other__">其他（請設計師討論）</option>
          <option value="__none__">不需要</option>
        </select>
        <input type="text" name="${safeKey}_other" placeholder="自填品牌名稱" style="display:none;" />
        <input type="text" name="${safeKey}_note" placeholder="型號 / 備註" />
      `;
      catDiv.appendChild(row);

      // 「其他」→ 顯示自填輸入框
      const select = row.querySelector('select');
      const otherInput = row.querySelector(`input[name="${safeKey}_other"]`);
      select.addEventListener('change', () => {
        if (select.value === '__other__') {
          otherInput.style.display = '';
          otherInput.focus();
        } else {
          otherInput.style.display = 'none';
          otherInput.value = '';
        }
      });
    });
    root.appendChild(catDiv);
  });
}

// === 收納清單渲染 ===
async function renderStorageList() {
  const data = await fetch('data/areas.json').then(r => r.json());
  const root = $('#storage-list');
  data.areas.forEach(area => {
    const areaDiv = document.createElement('div');
    areaDiv.innerHTML = `<div class="equipment-category">${area.name}</div>`;
    area.items.forEach(item => {
      const safeKey = `st_${area.key}_${item.replace(/[^a-zA-Z0-9一-龥]/g, '_')}`;
      const row = document.createElement('div');
      row.className = 'equipment-row';
      row.innerHTML = `
        <div class="label">${item}</div>
        <input type="number" name="${safeKey}_qty" placeholder="數量" min="0" />
        <input type="text" name="${safeKey}_size" placeholder="尺寸/樣式" />
        <input type="text" name="${safeKey}_model" placeholder="型號/電壓" />
        <input type="text" name="${safeKey}_location" placeholder="希望收納位置" />
        <input type="text" name="${safeKey}_note" placeholder="備註" />
      `;
      areaDiv.appendChild(row);
    });
    root.appendChild(areaDiv);
  });
}

// === 進度計算 ===
function updateProgress() {
  const allInputs = $$('input, select, textarea').filter(el =>
    el.type !== 'submit' && el.type !== 'button' && el.id !== 'consent-checkbox'
  );
  const filled = allInputs.filter(el => {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value && el.value.trim() !== '';
  }).length;
  const pct = allInputs.length === 0 ? 0 : Math.round((filled / allInputs.length) * 100);
  $('#progress-fill').style.width = pct + '%';
  $('#progress-label').textContent = pct + '% 完成';
}

// === 自動儲存草稿 ===
let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveDraft, AUTOSAVE_INTERVAL);
}

function collectFormData() {
  const data = {};
  $$('input, select, textarea').forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') {
      if (!data[el.name]) data[el.name] = [];
      if (el.checked) data[el.name].push(el.value);
    } else {
      data[el.name] = el.value;
    }
  });
  // Member count for restoration
  data._memberCount = memberCounter;
  return data;
}

function saveDraft() {
  try {
    const data = collectFormData();
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    $('#autosave-status').textContent = '已自動儲存 ' + new Date().toLocaleTimeString('zh-TW');
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Restore members first
    const memberCount = data._memberCount || 0;
    for (let i = 0; i < memberCount; i++) {
      addMember();
    }
    // Restore field values
    Object.entries(data).forEach(([name, val]) => {
      if (name.startsWith('_')) return;
      if (Array.isArray(val)) {
        val.forEach(v => {
          const cb = document.querySelector(`[name="${name}"][value="${v}"]`);
          if (cb) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
          }
        });
      } else {
        const input = document.querySelector(`[name="${name}"]`);
        if (input) input.value = val;
      }
    });
    return true;
  } catch (e) {
    console.warn('loadDraft failed', e);
    return false;
  }
}

// Listen for any input change
document.addEventListener('input', () => {
  updateProgress();
  scheduleAutosave();
});
document.addEventListener('change', () => {
  updateProgress();
  scheduleAutosave();
});

// === 同意 checkbox 控制送出 ===
$('#consent-checkbox').addEventListener('change', (e) => {
  $('#submit-btn').disabled = !e.target.checked;
});

// === 送出 ===
$('#survey-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!token) {
    showStatus('error', '缺少 token，無法送出。');
    return;
  }
  if (!$('#consent-checkbox').checked) {
    showStatus('error', '請先勾選同意以上內容。');
    return;
  }

  const submitBtn = $('#submit-btn');
  submitBtn.disabled = true;
  submitBtn.textContent = '送出中…';
  showStatus('info', '正在送出問卷，請稍候…');

  const payload = {
    token,
    timestamp: new Date().toISOString(),
    data: collectFormData(),
  };

  if (!GAS_ENDPOINT) {
    showStatus('error', '尚未設定 GAS_ENDPOINT，無法送出。請聯絡開發人員。');
    submitBtn.textContent = '送出問卷';
    return;
  }

  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (result.ok) {
      showStatus('success', `送出成功！案件編號：${result.caseId}。報告連結：${result.clientReportUrl || '稍後寄送'}`);
      localStorage.removeItem(AUTOSAVE_KEY);
    } else {
      throw new Error(result.error || 'unknown');
    }
  } catch (err) {
    console.error(err);
    showStatus('error', '送出失敗，請稍後再試。錯誤：' + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = '送出問卷';
  }
});

function showStatus(type, msg) {
  const banner = $('#submit-status');
  banner.className = 'status-banner ' + type;
  banner.style.display = 'block';
  banner.textContent = msg;
}

// === 初始化 ===
async function init() {
  await renderEquipmentList();
  await renderStorageList();
  bindChipBehavior();
  const restored = loadDraft();
  if (!restored) {
    addMember(); // 至少給一張成員卡
  }
  updateProgress();
}

init();
