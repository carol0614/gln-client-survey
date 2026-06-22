/* ============================================================
   GLN 客戶問卷 — 前端邏輯
   ============================================================ */

// === 設定 ===
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzCpoKgXvana8_6cxxB1jrn0qCW8ulw7iX-vVrDJbqCQZ36KjAhHJRNAd489N_z564zsw/exec';
// getDraftKey() is now token-specific; use getDraftKey()
function getDraftKey() {
  const t = (new URLSearchParams(window.location.search)).get('t') ||
             (new URLSearchParams(window.location.search)).get('d') || 'anon';
  return 'gln_survey_draft_v1_' + t;
}
const DRAFT_TOKEN_KEY = 'gln_draft_token_v1';
const ACCORDION_KEY = 'gln_survey_accordion_v1';
const AUTOSAVE_INTERVAL = 3000; // ms
const CLOUD_SYNC_INTERVAL = 30000; // 每 30 秒推一次雲端

// === 工具 ===
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function getURLParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// === Token 驗證 ===
const token = getURLParam('t');
const tokenBanner = $('#token-banner');
// 草稿連結（?d=xxx）不需要 token，會在後續流程從雲端拉草稿
if (!token && !getURLParam('d')) {
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

// === 寵物卡 ===

const petSpeciesOptions = ['狗', '貓', '兔子', '鳥', '倉鼠/天竺鼠', '魚', '龜', '爬蟲', '其他'];
const petSizeOptions = ['小型（< 5 kg）', '中型（5-15 kg）', '大型（15-30 kg）', '巨大（30 kg+）', '不適用'];
const petEnvOptions = ['怕冷需保暖', '怕熱需冷氣', '需曬太陽', '需通風', '需安靜', '都還好'];

const petFields = [
  { key: 'name',          label: '名字',                  type: 'text',    placeholder: '例：小白、球球' },
  { key: 'species',       label: '物種',                  type: 'select',  options: petSpeciesOptions },
  { key: 'size',          label: '體型',                  type: 'select',  options: petSizeOptions },
  { key: 'age',           label: '年齡',                  type: 'text',    placeholder: '例：3 歲 / 6 個月' },
  { key: 'activity_area', label: '活動區域',              type: 'text',    placeholder: '例：客廳、陽台、整層自由' },
  { key: 'feeding_spot',  label: '飲食 / 如廁固定位置',   type: 'text',    placeholder: '例：廚房門邊、陽台、玄關' },
  { key: 'damage',        label: '掉毛 / 抓咬家具情況',   type: 'text',    placeholder: '例：很會掉毛、會抓沙發、會咬木頭' },
  { key: 'env_need',      label: '環境需求（可複選）',    type: 'chips',   options: petEnvOptions },
  { key: 'other_need',    label: '其他需求',              type: 'textarea', placeholder: '例：需要寵物房、有專屬籠子、需要矮櫃可跳' },
];

let petCounter = 0;

function createPetCard(prefill = {}) {
  petCounter++;
  const id = `pet-${petCounter}`;
  const card = document.createElement('div');
  card.className = 'member-card pet-card';
  card.dataset.petId = id;

  card.innerHTML = `
    <button type="button" class="remove-btn" aria-label="移除此寵物">移除</button>
    <div class="member-card-header">🐾 寵物 #${petCounter}</div>
    <div class="field-row">
      ${petFields.map(f => {
        if (f.type === 'select') {
          return `
            <div class="field">
              <label>${f.label}</label>
              <select name="${id}_${f.key}">
                <option value="">請選擇</option>
                ${f.options.map(o => `<option>${o}</option>`).join('')}
              </select>
            </div>`;
        }
        if (f.type === 'textarea') {
          return `
            <div class="field">
              <label>${f.label}</label>
              <textarea name="${id}_${f.key}" placeholder="${f.placeholder || ''}"></textarea>
            </div>`;
        }
        if (f.type === 'chips') {
          return `
            <div class="field">
              <label>${f.label}</label>
              <div class="checkbox-group" data-name="${id}_${f.key}">
                ${f.options.map(o => `
                  <label class="chip"><input type="checkbox" value="${o}" /><span>${o}</span></label>
                `).join('')}
              </div>
            </div>`;
        }
        return `
          <div class="field">
            <label>${f.label}</label>
            <input type="${f.type}" name="${id}_${f.key}" placeholder="${f.placeholder || ''}" />
          </div>`;
      }).join('')}
    </div>
  `;

  Object.entries(prefill).forEach(([name, val]) => {
    const input = card.querySelector(`[name="${name}"]`);
    if (input) input.value = val;
  });

  card.querySelector('.remove-btn').addEventListener('click', () => {
    if (confirm('確定要移除這隻寵物？')) {
      card.remove();
      updateProgress();
      saveDraft();
    }
  });

  return card;
}

function addPet(prefill) {
  const card = createPetCard(prefill);
  $('#pets-list').appendChild(card);
  bindChipBehavior(card);
  updateProgress();
}

$('#add-pet').addEventListener('click', () => addPet());

// === Chip 樣式同步 ===
function bindChipBehavior(root = document) {
  $$('.chip input[type="checkbox"]', root).forEach(cb => {
    if (cb.dataset._bound) return;
    cb.dataset._bound = '1';
    const label = cb.closest('.chip');
    if (cb.checked) label.classList.add('active');
    cb.addEventListener('change', () => {
      // 限制最多選 N 個（透過 data-max 在 checkbox-group 上）
      const group = cb.closest('.checkbox-group');
      const max = group && group.dataset.max ? parseInt(group.dataset.max, 10) : 0;
      if (max > 0 && cb.checked) {
        const checked = group.querySelectorAll('input[type="checkbox"]:checked').length;
        if (checked > max) {
          cb.checked = false;
          alert(`最多選 ${max} 個`);
          return;
        }
      }
      label.classList.toggle('active', cb.checked);
      updateProgress();
      saveDraft();
    });
  });
}
bindChipBehavior();

// === 工具：把 group 包成 sub-accordion（可折疊子區塊）===
// scopeKey: 'eq' / 'st' 等，用來在 localStorage 分區存開合狀態
function buildSubAccordion(name, scopeKey, groupKey, itemCount) {
  const wrap = document.createElement('div');
  wrap.className = 'sub-section';
  wrap.dataset.scope = scopeKey;
  wrap.dataset.group = groupKey;
  wrap.innerHTML = `
    <button type="button" class="sub-section-header" aria-expanded="false">
      <span class="sub-section-name">${name}</span>
      <span class="sub-section-count">${itemCount} 項</span>
      <span class="sub-section-caret" aria-hidden="true"></span>
    </button>
    <div class="sub-section-body"></div>
  `;
  return wrap;
}

const SUB_ACCORDION_KEY = 'gln_survey_sub_accordion_v1';

function bindSubAccordions(rootSelector) {
  const root = $(rootSelector);
  if (!root) return;
  let states = {};
  try {
    states = JSON.parse(localStorage.getItem(SUB_ACCORDION_KEY) || '{}');
  } catch (e) {}

  $$('.sub-section', root).forEach(sub => {
    const header = sub.querySelector(':scope > .sub-section-header');
    const key = `${sub.dataset.scope}_${sub.dataset.group}`;
    const isOpen = !!states[key]; // 預設折疊
    sub.classList.toggle('is-open', isOpen);
    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    header.addEventListener('click', () => {
      const next = !sub.classList.contains('is-open');
      sub.classList.toggle('is-open', next);
      header.setAttribute('aria-expanded', next ? 'true' : 'false');
      try {
        const cur = JSON.parse(localStorage.getItem(SUB_ACCORDION_KEY) || '{}');
        cur[key] = next;
        localStorage.setItem(SUB_ACCORDION_KEY, JSON.stringify(cur));
      } catch (e) {}
    });
  });
}

// === 設備清單渲染（下拉選單 + 其他自填，每類可折疊）===
async function renderEquipmentList() {
  const [areasData, brandsData] = await Promise.all([
    fetch('data/areas.json').then(r => r.json()),
    fetch('data/brands.json').then(r => r.json()),
  ]);
  const brandMap = brandsData.brands || {};
  const root = $('#equipment-list');

  areasData.equipment_categories.forEach(cat => {
    const sub = buildSubAccordion(cat.name, 'eq', cat.key, cat.items.length);
    const body = sub.querySelector('.sub-section-body');
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
      body.appendChild(row);

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
    root.appendChild(sub);
  });
  bindSubAccordions('#equipment-list');
}

// === 收納清單渲染（每區域可折疊）===
async function renderStorageList() {
  const data = await fetch('data/areas.json').then(r => r.json());
  const root = $('#storage-list');
  data.areas.forEach(area => {
    const sub = buildSubAccordion(area.name, 'st', area.key, area.items.length);
    const body = sub.querySelector('.sub-section-body');
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
      body.appendChild(row);
    });
    root.appendChild(sub);
  });
  bindSubAccordions('#storage-list');
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
  // Member / Pet count for restoration
  data._memberCount = memberCounter;
  data._petCount = petCounter;
  // P0: 感覺光譜洗牌順序（用於恢復時對照 photo id）
  if (swipeState.photos.length > 0) {
    data._swipeOrder = JSON.stringify(swipeState.photos.map(p => p.id));
  }
  // P2: 儲存時間戳，供雲端 vs 本機衝突比較
  data._savedAt = Date.now();
  return data;
}

function saveDraft() {
  try {
    const data = collectFormData();
    localStorage.setItem(getDraftKey(), JSON.stringify(data));
    $('#autosave-status').textContent = '已自動儲存 ' + new Date().toLocaleTimeString('zh-TW');
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(getDraftKey());
    if (!raw) return false;
    const data = JSON.parse(raw);
    // Restore members + pets first（卡片要先存在才能設值）
    const memberCount = data._memberCount || 0;
    for (let i = 0; i < memberCount; i++) {
      addMember();
    }
    const petCount = data._petCount || 0;
    for (let i = 0; i < petCount; i++) {
      addPet();
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
    // P0: 恢復感覺光譜（swipe）進度
    try {
      const rawLikes = data._feeling_likes;
      const rawNopes = data._feeling_nopes;
      const rawSkips  = data._feeling_skips;
      const rawOrder  = data._swipeOrder;
      if (rawLikes !== undefined && swipeState.photos.length > 0) {
        swipeState.likes  = JSON.parse(rawLikes  || '[]');
        swipeState.nopes  = JSON.parse(rawNopes  || '[]');
        swipeState.skips  = JSON.parse(rawSkips  || '[]');
        // 依原始洗牌順序重排照片，確保 index 對應正確
        if (rawOrder) {
          const orderIds = JSON.parse(rawOrder);
          const photoMap = Object.fromEntries(swipeState.photos.map(p => [p.id, p]));
          const reordered = orderIds.map(id => photoMap[id]).filter(Boolean);
          if (reordered.length === swipeState.photos.length) swipeState.photos = reordered;
        }
        swipeState.index = swipeState.likes.length + swipeState.nopes.length + swipeState.skips.length;
        syncSwipeHiddenFields();
        renderSwipeStage();
      }
    } catch (eSwipe) {
      console.warn('swipe restore failed', eSwipe);
    }
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
    draftToken: getOrCreateDraftToken(), // 讓 GAS 知道要把哪份草稿標記為已提交
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
      localStorage.removeItem(getDraftKey());
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

// ============================================================
// === 感覺光譜（風格左右滑）===
// ============================================================
const swipeState = {
  feelings: [],           // [{ key, label, desc, color, axis }]
  archetypes: [],         // 12 空間人格原型
  photos: [],             // [{ id, src, tags, isPlaceholder }]
  index: 0,
  likes: [],              // photo ids 右滑
  nopes: [],              // photo ids 左滑
  skips: [],              // photo ids 跳過
};

async function loadSwipeAssets() {
  const [feelingsData, photosData] = await Promise.all([
    fetch('data/feelings.json').then(r => r.json()),
    fetch('data/photos.json').then(r => r.json()),
  ]);
  swipeState.feelings = feelingsData.feelings;
  swipeState.archetypes = feelingsData.archetypes || [];
  swipeState.photos = shuffleArray(photosData.photos.slice());
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function feelingByKey(key) {
  return swipeState.feelings.find(f => f.key === key);
}

function renderSwipeStage() {
  const stage = $('#swipe-stage');
  if (!stage) return;
  stage.innerHTML = '';

  if (swipeState.index >= swipeState.photos.length) {
    finishSwipe();
    return;
  }

  // 渲染最多 3 張卡片堆疊（最上面那張可操作）
  const cardsToShow = swipeState.photos.slice(swipeState.index, swipeState.index + 3);
  cardsToShow.reverse().forEach((photo, idxFromBack) => {
    const isTop = idxFromBack === cardsToShow.length - 1;
    const card = document.createElement('div');
    card.className = 'swipe-card';
    card.dataset.photoId = photo.id;
    // 後面的卡略小、略下
    const depth = cardsToShow.length - 1 - idxFromBack;
    card.style.transform = `translateY(${depth * 6}px) scale(${1 - depth * 0.04})`;
    card.style.zIndex = isTop ? '10' : String(5 - depth);

    const placeholderClass = photo.isPlaceholder ? 'is-placeholder' : '';
    // 中文檔名需做 URL encoding（iOS Safari / LINE 內建瀏覽器才能正確載入）
    const encodedSrc = photo.src.split('/').map(encodeURIComponent).join('/');
    card.innerHTML = `
      <div class="swipe-card-decision like">LIKE</div>
      <div class="swipe-card-decision nope">NOPE</div>
      <div class="swipe-card-img ${placeholderClass}" style="background-image:url('${encodedSrc}');"></div>
      <div class="swipe-card-meta">
        ${photo._gln_slot ? '🏠 ' + photo._gln_slot + ' · ' : ''}照片 ${photo.id} / ${swipeState.photos.length}
      </div>
    `;

    if (isTop) bindCardDrag(card);
    stage.appendChild(card);
  });

  updateSwipeProgress();
  preloadUpcomingPhotos(); // 預載下面 5 張，避免慢速網路滑卡時白屏
}

// 預載下 5 張照片到瀏覽器快取，讓 swipe 不卡頓
function preloadUpcomingPhotos() {
  const upcoming = swipeState.photos.slice(swipeState.index + 3, swipeState.index + 8);
  upcoming.forEach(photo => {
    if (!photo || !photo.src) return;
    const img = new Image();
    img.src = photo.src.split('/').map(encodeURIComponent).join('/');
  });
}

function updateSwipeProgress() {
  const total = swipeState.photos.length;
  const done = swipeState.index;
  const progressEl = $('#swipe-progress');
  if (progressEl) progressEl.textContent = `${done} / ${total}`;
}

function bindCardDrag(card) {
  let startX = 0, startY = 0, currentX = 0, currentY = 0;
  let dragging = false;
  const decisionLike = card.querySelector('.swipe-card-decision.like');
  const decisionNope = card.querySelector('.swipe-card-decision.nope');

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    card.classList.add('dragging');
    startX = e.clientX;
    startY = e.clientY;
    card.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!dragging) return;
    currentX = e.clientX - startX;
    currentY = e.clientY - startY;
    const rotate = currentX / 14;
    card.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${rotate}deg)`;
    decisionLike.style.opacity = Math.max(0, Math.min(1, currentX / 100));
    decisionNope.style.opacity = Math.max(0, Math.min(1, -currentX / 100));
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('dragging');
    const threshold = 110;
    if (currentX > threshold) {
      decideTopCard('like');
    } else if (currentX < -threshold) {
      decideTopCard('nope');
    } else if (currentY < -threshold) {
      decideTopCard('skip');
    } else {
      // snap back
      card.style.transform = '';
      decisionLike.style.opacity = 0;
      decisionNope.style.opacity = 0;
      currentX = 0;
      currentY = 0;
    }
  }

  card.addEventListener('pointerdown', onDown);
  card.addEventListener('pointermove', onMove);
  card.addEventListener('pointerup', onUp);
  card.addEventListener('pointercancel', onUp);
}

function decideTopCard(decision) {
  const topCard = $('#swipe-stage').querySelector('.swipe-card[style*="z-index: 10"], .swipe-card:last-child');
  // 用 zIndex 找最上面
  const allCards = $$('.swipe-card', $('#swipe-stage'));
  const visibleTop = allCards.find(c => parseInt(c.style.zIndex || '0', 10) === 10) || allCards[allCards.length - 1];
  if (!visibleTop) return;

  const photoId = parseInt(visibleTop.dataset.photoId, 10);
  if (decision === 'like') {
    swipeState.likes.push(photoId);
    visibleTop.classList.add('gone-right');
  } else if (decision === 'nope') {
    swipeState.nopes.push(photoId);
    visibleTop.classList.add('gone-left');
  } else {
    swipeState.skips.push(photoId);
    visibleTop.classList.add('gone-up');
  }

  setTimeout(() => {
    swipeState.index++;
    syncSwipeHiddenFields();
    saveDraft();
    renderSwipeStage();
  }, 360);
}

function calculateSpectrum() {
  // 統計每個 feeling 在 deck 中總出現數
  const totalByFeeling = {};
  swipeState.photos.forEach(p => {
    (p.tags || []).forEach(t => {
      totalByFeeling[t] = (totalByFeeling[t] || 0) + 1;
    });
  });

  // 累計 likes 中各 feeling 的累積分數（每次右滑該 tag +1）
  const likeByFeeling = {};
  swipeState.photos
    .filter(p => swipeState.likes.includes(p.id))
    .forEach(p => {
      (p.tags || []).forEach(t => {
        likeByFeeling[t] = (likeByFeeling[t] || 0) + 1;
      });
    });

  // 算 % = likeByFeeling / totalByFeeling
  const spectrum = swipeState.feelings.map(f => {
    const total = totalByFeeling[f.key] || 0;
    const liked = likeByFeeling[f.key] || 0;
    const pct = total === 0 ? 0 : Math.round((liked / total) * 100);
    return { key: f.key, label: f.label, color: f.color, desc: f.desc, axis: f.axis, pct, liked, total };
  }).sort((a, b) => b.pct - a.pct);

  return spectrum;
}

function syncSwipeHiddenFields() {
  $('#feeling-likes').value = JSON.stringify(swipeState.likes);
  $('#feeling-nopes').value = JSON.stringify(swipeState.nopes);
  $('#feeling-skips').value = JSON.stringify(swipeState.skips);
  $('#feeling-spectrum').value = JSON.stringify(calculateSpectrum());
}

function finishSwipe() {
  $('#swipe-stage').style.display = 'none';
  document.querySelector('.swipe-controls').style.display = 'none';
  document.querySelector('.swipe-hint').style.display = 'none';
  $('#swipe-done').style.display = 'block';
  syncSwipeHiddenFields();
  renderSpectrumPreview();
  updateProgress();
}

function renderSpectrumPreview() {
  const spectrum = calculateSpectrum();
  const liked = spectrum.filter(s => s.liked > 0);
  const target = $('#swipe-spectrum-preview');
  if (!target) return;
  if (liked.length === 0) {
    target.innerHTML = '<p class="muted" style="margin-top:1rem;">沒有右滑任何照片。試試「重新挑選」？</p>';
    return;
  }

  const top5 = spectrum.filter(s => s.pct > 0).slice(0, 5);
  const archetype = computePreviewPersonality(spectrum);

  const archetypeHtml = archetype ? `
    <div class="spectrum-personality-teaser">
      <div class="teaser-eyebrow">根據你的選擇，我們已看見</div>
      <div class="teaser-archetype-name">${archetype.name}</div>
      <div class="teaser-tagline">${archetype.tagline}</div>
      <div class="teaser-cta">完成後半段問卷，解鎖完整的空間人格分析 →</div>
    </div>
  ` : '';

  target.innerHTML = `
    <div style="margin-top:1.25rem;">
      ${renderFeelingPie(spectrum, { topN: 6 })}
      <div class="feeling-spectrum" style="max-width:420px; margin: 1.5rem auto 0;">
        ${top5.map(s => `
          <div class="feeling-bar-row">
            <div class="feeling-bar-label">${s.label}</div>
            <div class="feeling-bar-track"><div class="feeling-bar-fill" style="width:${s.pct}%; background:${s.color};"></div></div>
            <div class="feeling-bar-pct">${s.pct}%</div>
          </div>
        `).join('')}
      </div>
      ${archetypeHtml}
    </div>
  `;
}

function computePreviewPersonality(spectrum) {
  const top3Keys = spectrum.filter(s => s.pct > 0).slice(0, 3).map(s => s.key);
  if (top3Keys.length === 0 || swipeState.archetypes.length === 0) return null;

  let best = null, bestScore = 0;
  swipeState.archetypes.forEach(a => {
    const score = (a.triggers || []).filter(t => top3Keys.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = a; }
  });

  // 至少 1 個 trigger 命中才顯示，否則用 explorer fallback
  if (!best || bestScore < 1) {
    best = swipeState.archetypes.find(a => a.key === 'explorer') || null;
  }
  return best;
}

// === 圓餅圖（共用：preview + 報告）===
function renderFeelingPie(spectrum, opts = {}) {
  const topN = opts.topN || 6;
  const liked = spectrum.filter(s => s.liked > 0).sort((a, b) => b.liked - a.liked);
  if (liked.length === 0) return '';

  const top = liked.slice(0, topN);
  const rest = liked.slice(topN);
  const restTotal = rest.reduce((s, x) => s + x.liked, 0);
  const allSlices = top.slice();
  if (restTotal > 0) {
    allSlices.push({ key: '_other', label: '其他', color: '#D8D4CC', liked: restTotal });
  }
  const totalLiked = allSlices.reduce((s, x) => s + x.liked, 0);

  let cumAngle = 0;
  const slices = allSlices.map(s => {
    const proportion = s.liked / totalLiked;
    const angle = proportion * 360;
    const slice = {
      ...s,
      startAngle: cumAngle,
      endAngle: cumAngle + angle,
      pct: Math.round(proportion * 100),
    };
    cumAngle += angle;
    return slice;
  });

  const svg = `
    <svg viewBox="0 0 240 240" class="feeling-pie" role="img" aria-label="感覺光譜圓餅圖">
      ${slices.map(s => `<path d="${donutSlicePath(120, 120, 110, 60, s.startAngle, s.endAngle, slices.length === 1)}" fill="${s.color}" stroke="#FAF8F4" stroke-width="2" />`).join('')}
      <text x="120" y="116" text-anchor="middle" class="feeling-pie-center-label" font-family="'Noto Serif TC', serif" font-size="11" fill="#8E877D" letter-spacing="0.1em">感覺光譜</text>
      <text x="120" y="138" text-anchor="middle" class="feeling-pie-center-value" font-family="'Noto Serif TC', serif" font-size="22" fill="#5E5347">${slices[0].label}</text>
    </svg>
  `;

  const legend = slices.map(s => `
    <div class="pie-legend-row">
      <span class="pie-legend-dot" style="background:${s.color}"></span>
      <span class="pie-legend-label">${s.label}</span>
      <span class="pie-legend-pct">${s.pct}%</span>
    </div>
  `).join('');

  return `
    <div class="feeling-pie-container">
      <div class="feeling-pie-wrap">${svg}</div>
      <div class="feeling-pie-legend">${legend}</div>
    </div>
  `;
}

// donut slice SVG path
function donutSlicePath(cx, cy, outerR, innerR, startAngle, endAngle, isFullCircle) {
  if (isFullCircle) {
    // 整圈時用兩個半圓組成（path 弧度無法畫完整 360）
    return `
      M ${cx} ${cy - outerR}
      A ${outerR} ${outerR} 0 1 1 ${cx} ${cy + outerR}
      A ${outerR} ${outerR} 0 1 1 ${cx} ${cy - outerR}
      M ${cx} ${cy - innerR}
      A ${innerR} ${innerR} 0 1 0 ${cx} ${cy + innerR}
      A ${innerR} ${innerR} 0 1 0 ${cx} ${cy - innerR} Z
    `.trim();
  }
  const toRad = d => (d - 90) * Math.PI / 180;
  const x1 = cx + outerR * Math.cos(toRad(startAngle));
  const y1 = cy + outerR * Math.sin(toRad(startAngle));
  const x2 = cx + outerR * Math.cos(toRad(endAngle));
  const y2 = cy + outerR * Math.sin(toRad(endAngle));
  const x3 = cx + innerR * Math.cos(toRad(endAngle));
  const y3 = cy + innerR * Math.sin(toRad(endAngle));
  const x4 = cx + innerR * Math.cos(toRad(startAngle));
  const y4 = cy + innerR * Math.sin(toRad(startAngle));
  const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

function resetSwipe() {
  swipeState.index = 0;
  swipeState.likes = [];
  swipeState.nopes = [];
  swipeState.skips = [];
  swipeState.photos = shuffleArray(swipeState.photos);
  $('#swipe-stage').style.display = '';
  document.querySelector('.swipe-controls').style.display = '';
  document.querySelector('.swipe-hint').style.display = '';
  $('#swipe-done').style.display = 'none';
  syncSwipeHiddenFields();
  renderSwipeStage();
}

function bindSwipeControls() {
  $('#swipe-nope')?.addEventListener('click', () => decideTopCard('nope'));
  $('#swipe-like')?.addEventListener('click', () => decideTopCard('like'));
  $('#swipe-skip')?.addEventListener('click', () => decideTopCard('skip'));
  $('#swipe-reset')?.addEventListener('click', resetSwipe);
}

// === 客戶上傳參考圖（最多 20 張、每張 ≤ 5MB、自動壓縮到 1600px 長邊）===
const REFERENCE_MAX_PHOTOS = 20;
const REFERENCE_MAX_SIZE_MB = 5;
const REFERENCE_TARGET_LONG_EDGE = 1600; // 客戶上傳的圖會壓縮到此寬高內
let referencePhotos = []; // [{ name, dataUrl, sizeKB }]

function bindReferenceUpload() {
  const input = $('#reference-photos');
  const zone = document.querySelector('.upload-zone');
  if (!input || !zone) return;

  input.addEventListener('change', async (e) => {
    await handleReferenceFiles(e.target.files);
    input.value = ''; // 清空 input 才能重新選同名檔
  });

  // 拖曳支援
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('dragging');
    await handleReferenceFiles(e.dataTransfer.files);
  });
}

async function handleReferenceFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    if (referencePhotos.length >= REFERENCE_MAX_PHOTOS) {
      alert(`最多上傳 ${REFERENCE_MAX_PHOTOS} 張`);
      break;
    }
    if (file.size > REFERENCE_MAX_SIZE_MB * 1024 * 1024) {
      alert(`「${file.name}」超過 ${REFERENCE_MAX_SIZE_MB}MB，請先壓縮`);
      continue;
    }
    if (!file.type.startsWith('image/')) {
      alert(`「${file.name}」不是圖片`);
      continue;
    }
    try {
      const dataUrl = await compressImage(file, REFERENCE_TARGET_LONG_EDGE);
      const sizeKB = Math.round(dataUrl.length * 0.75 / 1024); // base64 → 約原 size
      referencePhotos.push({
        name: file.name,
        dataUrl,
        sizeKB,
        mimeType: 'image/jpeg', // 壓縮後統一 jpeg
      });
    } catch (err) {
      console.error('壓縮失敗', err);
      alert(`「${file.name}」處理失敗：${err.message}`);
    }
  }
  renderReferencePreview();
  syncReferenceField();
  saveDraft();
}

function compressImage(file, maxLongEdge) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const longEdge = Math.max(width, height);
        if (longEdge > maxLongEdge) {
          const scale = maxLongEdge / longEdge;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('無法讀取圖片'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('檔案讀取失敗'));
    reader.readAsDataURL(file);
  });
}

function renderReferencePreview() {
  const root = $('#reference-photos-preview');
  if (!root) return;
  root.innerHTML = referencePhotos.map((p, i) => `
    <div class="ref-thumb">
      <img src="${p.dataUrl}" alt="${p.name}" />
      <button type="button" class="ref-thumb-remove" data-idx="${i}" aria-label="移除">✕</button>
      <div class="ref-thumb-meta">${p.sizeKB}KB</div>
    </div>
  `).join('');
  root.querySelectorAll('.ref-thumb-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      referencePhotos.splice(idx, 1);
      renderReferencePreview();
      syncReferenceField();
      saveDraft();
    });
  });
}

function syncReferenceField() {
  const field = $('#reference-photos-data');
  if (field) field.value = JSON.stringify(referencePhotos);
}

// === 偵測 in-app browser（LINE / FB / IG / WeChat），提示用系統瀏覽器開啟 ===
function detectInAppBrowserAndWarn() {
  const ua = navigator.userAgent || '';
  const tests = [
    { name: 'LINE',     re: /\bLine\//i },
    { name: 'Facebook', re: /\bFBAN|FBAV\b/i },
    { name: 'Instagram',re: /\bInstagram\b/i },
    { name: 'WeChat',   re: /\bMicroMessenger\b/i },
    { name: 'TikTok',   re: /\bBytedance|musical_ly\b/i },
  ];
  const match = tests.find(t => t.re.test(ua));
  if (!match) return;

  // 已提示過就不再煩
  try { if (sessionStorage.getItem('gln_inapp_dismiss')) return; } catch (e) {}

  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;' +
    'background:#7C837B;color:#fff;padding:0.75rem 1rem;font-size:0.85rem;' +
    'display:flex;justify-content:space-between;align-items:center;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.15);font-family:inherit;';
  bar.innerHTML =
    `<span>⚠️ 偵測到 ${match.name} 內建瀏覽器，部分功能（照片、滑動）可能異常。` +
    `建議點右上選單→<b>「用 Safari/Chrome 開啟」</b></span>` +
    `<button style="background:transparent;color:#fff;border:1px solid #fff;` +
    `padding:0.25rem 0.75rem;border-radius:4px;cursor:pointer;font-size:0.8rem;margin-left:0.5rem;">關閉</button>`;
  bar.querySelector('button').onclick = () => {
    bar.remove();
    try { sessionStorage.setItem('gln_inapp_dismiss', '1'); } catch (e) {}
  };
  document.body.appendChild(bar);
}

// === 雲端草稿同步（跨裝置續填）===

function getOrCreateDraftToken() {
  // 優先：URL ?d=xxx（從 email 點來的）
  const urlDraft = getURLParam('d');
  if (urlDraft) {
    try { localStorage.setItem(DRAFT_TOKEN_KEY, urlDraft); } catch (e) {}
    return urlDraft;
  }
  // 其次：localStorage（同裝置之前用過的）
  try {
    let dt = localStorage.getItem(DRAFT_TOKEN_KEY);
    if (!dt) {
      dt = 'dr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(DRAFT_TOKEN_KEY, dt);
    }
    return dt;
  } catch (e) {
    return 'dr_' + Math.random().toString(36).slice(2);
  }
}

let cloudSyncBusy = false;
let lastCloudSyncAt = 0;

async function syncDraftToCloud(opts = {}) {
  // 手動寄信（opts.email）時絕對不能被 busy flag 擋住
  if (cloudSyncBusy && !opts.email) return;
  cloudSyncBusy = true;
  try {
    const draftToken = getOrCreateDraftToken();
    const originalToken = getURLParam('t') || '';
    const data = collectFormData();
    const payload = { action: 'save_draft', draftToken, originalToken, data };
    if (opts.email) payload.email = opts.email;

    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (result.ok) {
      lastCloudSyncAt = Date.now();
      updateCloudSyncStatus();
      return result;
    }
    throw new Error(result.error || 'sync_failed');
  } finally {
    cloudSyncBusy = false;
  }
}

async function loadDraftFromCloud() {
  const urlDraft = getURLParam('d');
  if (!urlDraft) return false;
  try {
    const url = `${GAS_ENDPOINT}?action=load_draft&t=${encodeURIComponent(urlDraft)}`;
    const res = await fetch(url);
    const result = await res.json();
    if (result.ok && result.data) {
      // P2: 只在雲端版本較新（或本機無草稿）時才覆蓋
      const cloudData = result.data;
      const cloudTime = cloudData._savedAt || 0;
      try {
        const localRaw = localStorage.getItem(getDraftKey());
        const localData = localRaw ? JSON.parse(localRaw) : null;
        const localTime = localData ? (localData._savedAt || 0) : 0;
        if (cloudTime >= localTime) {
          localStorage.setItem(getDraftKey(), JSON.stringify(cloudData));
        }
      } catch (_) {
        localStorage.setItem(getDraftKey(), JSON.stringify(cloudData));
      }
      localStorage.setItem(DRAFT_TOKEN_KEY, urlDraft);
      return true;
    }
  } catch (e) {
    console.warn('cloud draft load failed', e);
  }
  return false;
}

function updateCloudSyncStatus() {
  const el = $('#cloud-sync-status');
  if (!el) return;
  if (lastCloudSyncAt === 0) {
    el.textContent = '';
    return;
  }
  const t = new Date(lastCloudSyncAt).toLocaleTimeString('zh-TW');
  el.textContent = `☁️ 已同步雲端 ${t}`;
}

function startCloudSync() {
  setInterval(() => {
    // 只有表單有變動才推（簡單比對 lastSavedDataHash）
    syncDraftToCloud().catch(() => {});
  }, CLOUD_SYNC_INTERVAL);
}

// P1: 儲存進度 modal（取代原本的 prompt/alert）
function showSaveModal() {
  document.getElementById('gln-save-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'gln-save-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';
  modal.innerHTML = `
    <div style="background:#faf9f7;border-radius:14px;padding:1.75rem 1.5rem;max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,0.28);font-family:inherit;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <strong style="font-size:1.05rem;">💾 儲存進度 &amp; 取得連結</strong>
        <button id="gln-save-close-btn" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:#999;line-height:1;" aria-label="關閉">×</button>
      </div>
      <p style="margin:0 0 1rem;font-size:0.875rem;color:#666;line-height:1.5;">
        填入 Email 即可寄出連結，從任何裝置繼續填寫。<br>也可直接複製連結自行儲存。
      </p>
      <div style="margin-bottom:1rem;">
        <div style="font-size:0.78rem;color:#888;margin-bottom:0.35rem;">草稿連結（可直接複製貼給自己）</div>
        <div style="display:flex;gap:0.5rem;">
          <input id="gln-draft-link-input" readonly
            style="flex:1;padding:0.45rem 0.65rem;border:1px solid #ddd;border-radius:7px;font-size:0.8rem;background:#f5f5f5;color:#444;min-width:0;" />
          <button id="gln-copy-link-btn"
            style="padding:0.45rem 0.9rem;background:#5a4a3a;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:0.85rem;white-space:nowrap;">複製</button>
        </div>
      </div>
      <div style="border-top:1px solid #eee;padding-top:1rem;margin-bottom:0.75rem;">
        <div style="font-size:0.78rem;color:#888;margin-bottom:0.35rem;">或寄連結到 Email</div>
        <div style="display:flex;gap:0.5rem;">
          <input id="gln-email-input" type="email" placeholder="your@email.com"
            style="flex:1;padding:0.5rem 0.75rem;border:1px solid #ddd;border-radius:7px;font-size:0.9rem;min-width:0;" />
          <button id="gln-email-send-btn"
            style="padding:0.5rem 1rem;background:#8B6F47;color:#fff;border:none;border-radius:7px;cursor:pointer;font-size:0.9rem;white-space:nowrap;">寄送</button>
        </div>
      </div>
      <div id="gln-save-msg" style="font-size:0.85rem;min-height:1.2rem;line-height:1.5;"></div>
    </div>
  `;
  document.body.appendChild(modal);

  // 立即顯示草稿連結
  const draftToken = getOrCreateDraftToken();
  const draftUrl = window.location.origin + window.location.pathname + '?d=' + encodeURIComponent(draftToken);
  const linkInput = document.getElementById('gln-draft-link-input');
  linkInput.value = draftUrl;

  // 複製連結
  document.getElementById('gln-copy-link-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(draftUrl);
    } catch (_) {
      linkInput.select();
      document.execCommand('copy');
    }
    const btn = document.getElementById('gln-copy-link-btn');
    if (btn) { btn.textContent = '✓ 已複製'; setTimeout(() => { if (btn) btn.textContent = '複製'; }, 2000); }
  });

  // 寄送 Email
  document.getElementById('gln-email-send-btn').addEventListener('click', async () => {
    const email = document.getElementById('gln-email-input').value.trim();
    const msgEl = document.getElementById('gln-save-msg');
    if (!email.includes('@') || !email.includes('.')) {
      msgEl.style.color = '#c00'; msgEl.textContent = '⚠️ Email 格式不正確'; return;
    }
    const sendBtn = document.getElementById('gln-email-send-btn');
    sendBtn.disabled = true; sendBtn.textContent = '寄送中…';
    msgEl.style.color = '#888'; msgEl.textContent = '正在同步並寄信…';
    try {
      const result = await syncDraftToCloud({ email });
      if (result && result.emailSent) {
        msgEl.style.color = '#2a7c2a';
        msgEl.textContent = `✅ 連結已寄到 ${email}，隨時點擊即可繼續填寫。`;
      } else if (result && result.emailError) {
        msgEl.style.color = '#c00';
        msgEl.textContent = `⚠️ 進度已存雲端，但寄信失敗：${result.emailError}`;
      } else {
        msgEl.style.color = '#c00';
        msgEl.textContent = '⚠️ 請稍後再試一次。（本機草稿仍自動保存）';
      }
    } catch (e) {
      msgEl.style.color = '#c00';
      msgEl.textContent = '❌ 儲存失敗：' + e.message;
    } finally {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '寄送'; }
    }
  });

  // 關閉（點 × 或點遮罩）
  const closeHandler = () => document.getElementById('gln-save-modal')?.remove();
  document.getElementById('gln-save-close-btn').addEventListener('click', closeHandler);
  modal.addEventListener('click', e => { if (e.target === modal) closeHandler(); });

  // 自動 focus email 輸入框
  setTimeout(() => document.getElementById('gln-email-input')?.focus(), 80);
}

async function manualSaveWithEmail() {
  syncDraftToCloud().catch(() => {}); // 先靜默同步一次，確保雲端有最新資料
  showSaveModal();
}

// === Accordion（可折疊 Section）===
function initAccordion() {
  const sections = $$('.section.collapsible');
  let storedStates = {};
  try {
    storedStates = JSON.parse(localStorage.getItem(ACCORDION_KEY) || '{}');
  } catch (e) {
    storedStates = {};
  }

  sections.forEach((section, idx) => {
    const h2 = section.querySelector(':scope > h2');
    if (!h2 || section.querySelector(':scope > .section-body')) return;

    // 把 h2 之後的所有兄弟節點包進 section-body
    const body = document.createElement('div');
    body.className = 'section-body';
    let next = h2.nextSibling;
    while (next) {
      const cur = next;
      next = next.nextSibling;
      body.appendChild(cur);
    }
    section.appendChild(body);

    // h2 改成可點擊
    h2.setAttribute('role', 'button');
    h2.setAttribute('tabindex', '0');

    // 預設：Section A 開、其餘關；localStorage 有紀錄則覆蓋
    const key = section.dataset.section || `idx_${idx}`;
    let isOpen;
    if (Object.prototype.hasOwnProperty.call(storedStates, key)) {
      isOpen = !!storedStates[key];
    } else {
      isOpen = idx === 0;
    }
    section.classList.toggle('is-open', isOpen);
    h2.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

    const toggle = () => {
      const next = !section.classList.contains('is-open');
      section.classList.toggle('is-open', next);
      h2.setAttribute('aria-expanded', next ? 'true' : 'false');
      try {
        const states = JSON.parse(localStorage.getItem(ACCORDION_KEY) || '{}');
        states[key] = next;
        localStorage.setItem(ACCORDION_KEY, JSON.stringify(states));
      } catch (e) { /* ignore */ }
    };

    h2.addEventListener('click', toggle);
    h2.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  });
}


// === 預填：從 GAS 拉 admin 填的客戶基本資料，填入空白欄位 ===
async function fetchAndApplyPrefill() {
  const t = getURLParam('t');
  if (!t || t === 'test') return; // test token 跳過
  try {
    const url = GAS_ENDPOINT + '?action=get_prefill&t=' + encodeURIComponent(t);
    const res = await fetch(url);
    const result = await res.json();
    if (!result.ok || !result.prefill) return;
    const pf = result.prefill;
    // 只填入目前空白的欄位（不覆蓋客戶已填的內容）
    const fieldMap = {
      client_name:   pf.client_name,
      client_phone:  pf.client_phone,
      house_address: pf.house_address,
      house_size:    pf.house_size,
      house_age:     pf.house_age,
      house_type:    pf.house_type,
      case_type:     pf.case_type,
      budget:        pf.budget,
    };
    Object.entries(fieldMap).forEach(([name, val]) => {
      if (!val) return;
      const el = document.querySelector('[name="' + name + '"]');
      if (el && !el.value) el.value = val;
    });
  } catch (e) {
    console.warn('prefill fetch failed', e);
  }
}

// === 初始化 ===
async function init() {
  detectInAppBrowserAndWarn();
  await renderEquipmentList();
  await renderStorageList();
  await loadSwipeAssets();
  renderSwipeStage();
  bindSwipeControls();
  bindReferenceUpload();
  bindChipBehavior();

  // Accordion 必須在所有 DOM 渲染完成後才包 section-body（避免 dynamic 渲染斷裂）
  initAccordion();

  // 1. 先看 URL 有沒有 ?d=draftToken，若有則從雲端拉草稿覆蓋 localStorage
  await loadDraftFromCloud();

  // 2. 然後從 localStorage 載入（可能已被雲端覆蓋）
  const restored = loadDraft();
  if (!restored) {
    addMember(); // 至少給一張成員卡
  }

  // 3. 從 GAS 拉 admin 預填的客戶基本資料（只填空白欄位，不覆蓋已填內容）
  await fetchAndApplyPrefill();

  updateProgress();

  // 3. 綁「保存進度寄連結」按鈕
  const saveCloudBtn = $('#save-cloud-btn');
  if (saveCloudBtn) saveCloudBtn.addEventListener('click', manualSaveWithEmail);

  // 4. 開始每 30 秒自動推雲端
  startCloudSync();
}

init();
