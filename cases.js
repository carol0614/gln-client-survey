// GLN 案件後台
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzCpoKgXvana8_6cxxB1jrn0qCW8ulw7iX-vVrDJbqCQZ36KjAhHJRNAd489N_z564zsw/exec';
const ADMIN_TOKEN_KEY = 'gln_admin_token_v1';

const app = document.getElementById('app');

// ── 工具 ──────────────────────────────────────────
function getURLParam(key) {
  return new URLSearchParams(location.search).get(key) || '';
}

function extractCaseSummary(rawData) {
  // 從問卷 data 萃取可讀摘要
  const memberCount = parseInt(rawData._memberCount || rawData.memberCount || 0);
  const member1 = rawData['member-1_role'] || '';
  const member1occ = rawData['member-1_occupation'] || '';
  const houseSize = rawData.house_size ? rawData.house_size + ' 坪' : '';
  const houseAge = rawData.house_age ? rawData.house_age + ' 年屋齡' : '';
  const budget = rawData.budget || '';
  const moveIn = rawData.move_in_date || '';
  return { memberCount, member1, member1occ, houseSize, houseAge, budget, moveIn };
}

// ── 登入畫面 ──────────────────────────────────────
function renderLogin(errorMsg) {
  app.innerHTML = `
    <div class="login-wrap">
      <img src="assets/gln-circle.png" alt="GLN" class="cases-logo" onerror="this.style.display='none'" />
      <h2>GLN 案件後台</h2>
      <input class="login-input" type="password" id="token-input" placeholder="請輸入管理員密碼" autocomplete="current-password" />
      <button class="login-btn" id="login-btn">進入</button>
      ${errorMsg ? `<p class="login-error">${errorMsg}</p>` : ''}
    </div>
  `;

  const input = document.getElementById('token-input');
  const btn = document.getElementById('login-btn');

  function tryLogin() {
    const val = input.value.trim();
    if (!val) return;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, val);
    loadCases(val);
  }

  btn.addEventListener('click', tryLogin);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });
  input.focus();
}

// ── 載入狀態 ──────────────────────────────────────
function renderLoading() {
  app.innerHTML = `
    <div class="cases-header">
      <img src="assets/gln-circle.png" alt="GLN" class="cases-logo" onerror="this.style.display='none'" />
      <h1>案件列表</h1>
    </div>
    <p class="muted" style="text-align:center; padding: 3rem 0; color: var(--gln-taupe);">載入中…</p>
  `;
}

// ── 案件列表 ──────────────────────────────────────
function renderCases(cases) {
  const headerActions = document.getElementById('header-actions');
  if (headerActions) {
    headerActions.innerHTML = `<button class="btn btn-ghost btn-sm" id="logout-btn">登出</button>`;
    document.getElementById('logout-btn').addEventListener('click', () => {
      sessionStorage.removeItem(ADMIN_TOKEN_KEY);
      renderLogin();
    });
  }

  let filtered = cases;

  function renderList() {
    const query = (document.getElementById('case-search')?.value || '').toLowerCase();
    filtered = query
      ? cases.filter(c =>
          c.caseId.toLowerCase().includes(query) ||
          (c.summary.member1 + c.summary.member1occ).toLowerCase().includes(query) ||
          c.timestamp.includes(query)
        )
      : cases;

    const count = document.getElementById('case-count');
    if (count) count.textContent = `共 ${filtered.length} 筆`;

    const list = document.getElementById('case-list');
    if (!list) return;

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <p>找不到符合的案件</p>
        </div>
      `;
      return;
    }

    list.innerHTML = filtered.map(c => {
      const s = c.summary;
      const memberStr = s.memberCount > 0 ? `${s.memberCount} 位成員` : '';
      const houseStr = [s.houseSize, s.houseAge].filter(Boolean).join('・');
      const budgetStr = s.budget ? `預算 ${s.budget}` : '';
      const detail = [memberStr, houseStr, budgetStr].filter(Boolean).join('　');

      const badgeMap = {
        success: ['badge-success', 'AI 分析完成'],
        failed:  ['badge-failed',  'AI 分析失敗'],
        none:    ['badge-none',    '未分析'],
      };
      const [badgeClass, badgeLabel] = badgeMap[c.analysisStatus] || badgeMap.none;

      return `
        <div class="case-card">
          <div class="case-meta">
            <p class="case-id">${c.caseId}</p>
            ${s.member1 ? `<p class="case-client">${s.member1}${s.member1occ ? '・' + s.member1occ : ''}</p>` : ''}
            ${detail ? `<p class="case-address">${detail}</p>` : ''}
            <p class="case-time">${c.timestamp}</p>
          </div>
          <div class="case-actions">
            <span class="case-badge ${badgeClass}">${badgeLabel}</span>
            <a class="btn-report btn-designer" href="${c.designerReportUrl}" target="_blank">設計師報告</a>
            <a class="btn-report btn-client" href="${c.clientReportUrl}" target="_blank">客戶版</a>
          </div>
        </div>
      `;
    }).join('');
  }

  app.innerHTML = `
    <div class="cases-header">
      <img src="assets/gln-circle.png" alt="GLN" class="cases-logo" onerror="this.style.display='none'" />
      <h1>案件列表</h1>
      <p>共 ${cases.length} 筆提交・點「設計師報告」查看完整分析</p>
    </div>

    ${cases.length === 0 ? `
      <div class="empty-state">
        <p>目前還沒有任何已提交的案件。</p>
      </div>
    ` : `
      <div class="cases-toolbar">
        <input class="cases-search" id="case-search" type="search" placeholder="搜尋案件編號、成員身份…" />
        <span class="cases-count" id="case-count">共 ${cases.length} 筆</span>
      </div>
      <div id="case-list"></div>
    `}
  `;

  if (cases.length > 0) {
    document.getElementById('case-search').addEventListener('input', renderList);
    renderList();
  }
}

// ── 從 GAS 拉資料 ──────────────────────────────────
async function loadCases(adminToken) {
  renderLoading();
  try {
    const url = `${GAS_ENDPOINT}?action=list_cases&admin_token=${encodeURIComponent(adminToken)}`;
    const res = await fetch(url);
    const result = await res.json();

    if (!result.ok) {
      if (result.error === 'unauthorized') {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        renderLogin('密碼錯誤，請再試一次。');
      } else {
        app.innerHTML = `<p style="text-align:center;padding:4rem;color:var(--gln-error)">載入失敗：${result.error}</p>`;
      }
      return;
    }

    // 補充摘要資訊（GAS 已回傳 analysisStatus，但 data 欄位在個別查詢才有）
    // 這裡直接用 GAS 回傳的摘要欄位
    const cases = result.cases.map(c => ({
      ...c,
      summary: {
        memberCount: 0,
        member1: c.clientName || '',
        member1occ: '',
        houseSize: '',
        houseAge: '',
        budget: '',
        moveIn: '',
      }
    }));

    renderCases(cases);
  } catch (err) {
    app.innerHTML = `<p style="text-align:center;padding:4rem;color:var(--gln-error)">網路錯誤，請重新整理。<br><small>${err.message}</small></p>`;
  }
}

// ── 初始化 ────────────────────────────────────────
(function init() {
  // URL 帶 ?t=xxx 直接嘗試登入（方便加書籤）
  const urlToken = getURLParam('t');
  const savedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  const token = urlToken || savedToken;

  if (token) {
    loadCases(token);
  } else {
    renderLogin();
  }
})();
