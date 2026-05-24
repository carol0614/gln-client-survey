/* ============================================================
   GLN 客戶問卷 — 報告頁
   URL: /report.html?id=<caseId>&v=<client|designer>&demo=1
   ============================================================ */

const GAS_ENDPOINT = '';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const caseId = params.get('id') || 'GLN-DEMO';
const version = (params.get('v') || 'client').toLowerCase();
const demoMode = params.get('demo') === '1' || !GAS_ENDPOINT;

// === 載入資料 ===
async function loadCase() {
  if (demoMode) {
    return fetch('data/demo-case.json').then(r => r.json());
  }
  const url = `${GAS_ENDPOINT}?id=${encodeURIComponent(caseId)}&v=${version}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'load failed');
  return { caseId: json.data.caseId, timestamp: json.data.timestamp, data: json.data.data };
}

async function loadAnalysis() {
  if (demoMode) {
    return fetch('data/demo-analysis.json').then(r => r.ok ? r.json() : null).catch(() => null);
  }
  // 未來：從 GAS 取已產生的分析（或現場觸發 Claude API）
  return null;
}

// === 工具：把成員資料展開成陣列 ===
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

function val(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  if (Array.isArray(v)) return v.length ? v.join(' · ') : fallback;
  return v;
}

// === 客戶版渲染 ===
function renderClientReport(caseData) {
  const d = caseData.data;
  const members = extractMembers(d);

  return `
    <article class="report client-version">

      <header class="report-header">
        <div class="case-id">${caseData.caseId}</div>
        <h1>你的家，從這裡開始</h1>
        <p class="muted">提交時間：${new Date(caseData.timestamp).toLocaleString('zh-TW')}</p>
      </header>

      <section class="report-section">
        <h2>你的家庭</h2>
        <div class="member-grid">
          ${members.map(m => `
            <div class="member-tile">
              <div class="member-name">${val(m.role)}</div>
              <div class="member-meta">${val(m.age)} 歲 · ${val(m.occupation)}</div>
              <div class="member-need">${val(m.main_need, '（尚未填寫）')}</div>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="report-section">
        <h2>你的生活樣貌</h2>
        <div class="metric-grid">
          <div class="metric"><div class="metric-label">開伙頻率</div><div class="metric-value">${val(d.cooking_frequency)}</div></div>
          <div class="metric"><div class="metric-label">用餐人數</div><div class="metric-value">${val(d.dining_count)}</div></div>
          <div class="metric"><div class="metric-label">訪客頻率</div><div class="metric-value">${val(d.visitor_frequency)}</div></div>
          <div class="metric"><div class="metric-label">書籍量</div><div class="metric-value">${val(d.books)}</div></div>
        </div>
        <div class="report-paragraph">
          <strong>料理偏好：</strong>${val(d.cooking_styles)}<br />
          <strong>大型物品：</strong>${val(d.large_items)}<br />
          <strong>收藏：</strong>${val(d.collections)}
        </div>
      </section>

      <section class="report-section">
        <h2>你的風格偏好</h2>
        <div class="report-paragraph">
          <strong>空間色調：</strong>${val(d.color_space)}<br />
          <strong>地板色調：</strong>${val(d.color_floor)}<br />
          <strong>櫃子色調：</strong>${val(d.color_cabinet)}
        </div>
        <div class="material-bars">
          ${[['木紋','material_wood'],['金屬','material_metal'],['石材','material_stone'],['玻璃','material_glass']].map(([label, key]) => {
            const score = parseInt(d[key] || 0, 10);
            return `
              <div class="bar-row">
                <div class="bar-label">${label}</div>
                <div class="bar-track"><div class="bar-fill" style="width:${score * 20}%"></div></div>
                <div class="bar-score">${score}/5</div>
              </div>
            `;
          }).join('')}
        </div>
      </section>

      <section class="report-section">
        <h2>你最重視的</h2>
        <ol class="priority-list">
          <li>${val(d.priority_1)}</li>
          <li>${val(d.priority_2)}</li>
          <li>${val(d.priority_3)}</li>
        </ol>
        <div class="report-paragraph">
          <strong>痛點：</strong>${val(d.pain_points)}<br />
          <strong>翻新原因：</strong>${val(d.renovation_reason)}<br />
          <strong>許願清單：</strong>${val(d.wishlist)}
        </div>
      </section>

      <section class="report-section">
        <h2>房屋基本資料</h2>
        <div class="metric-grid">
          <div class="metric"><div class="metric-label">屋齡</div><div class="metric-value">${val(d.house_age)} 年</div></div>
          <div class="metric"><div class="metric-label">坪數</div><div class="metric-value">${val(d.house_size)} 坪</div></div>
          <div class="metric"><div class="metric-label">形態</div><div class="metric-value">${val(d.house_type)}</div></div>
          <div class="metric"><div class="metric-label">預算</div><div class="metric-value">${val(d.budget)}</div></div>
          <div class="metric"><div class="metric-label">入住</div><div class="metric-value">${val(d.move_in_date)}</div></div>
          <div class="metric"><div class="metric-label">分類</div><div class="metric-value">${val(d.case_type)}</div></div>
        </div>
      </section>

      <footer class="report-footer no-print">
        <p class="muted">資料無誤嗎？如需修改，請聯絡 GLN 設計團隊。</p>
      </footer>

    </article>
  `;
}

// === AI 分析渲染（設計師版專用）===
function renderAnalysis(analysis) {
  if (!analysis) {
    return `
      <section class="report-section ai-analysis">
        <h2>🧠 AI 隱性需求分析</h2>
        <p class="muted">尚未生成此案件的 AI 分析。將來啟用 Claude API 後，會在客戶提交時自動產生。</p>
      </section>
    `;
  }
  const priorityColor = (p) => ({ P0: '#B85450', P1: '#A67C52', P2: '#7B9070', P3: '#8E877D' }[p] || '#8E877D');
  return `
    <section class="report-section ai-analysis">
      <h2>🧠 AI 隱性需求分析</h2>
      <p class="muted">交叉比對客戶答案與 GLN 機能設計知識庫 V3（58 條設計知識），自動產生客戶未明說的隱性需求洞察。</p>

      <div class="analysis-summary">
        <strong>案件摘要：</strong>${analysis.summary}
      </div>

      <h3 style="margin-top: 2rem;">隱性需求清單（${analysis.implicit_needs.length} 項）</h3>
      ${analysis.implicit_needs.map(need => `
        <div class="insight-card">
          <div class="insight-header">
            <span class="priority-tag" style="background:${priorityColor(need.priority)}">${need.priority}</span>
            <h4>${need.title}</h4>
          </div>
          <div class="insight-body">
            <div class="insight-block">
              <strong>觀察訊號：</strong>
              <ul>${need.signals.map(s => `<li>${s}</li>`).join('')}</ul>
            </div>
            <div class="insight-block">
              <strong>推論：</strong>${need.inference}
            </div>
            <div class="insight-block">
              <strong>設計回應：</strong>
              <ul>${need.design_response.map(r => `<li>${r}</li>`).join('')}</ul>
            </div>
            <div class="insight-meta">
              <span>📚 知識庫參考：${need.knowledge_refs.join(' · ')}</span>
              ${need.estimated_cost_signal ? `<span>💰 ${need.estimated_cost_signal}</span>` : ''}
            </div>
          </div>
        </div>
      `).join('')}

      ${analysis.contradictions && analysis.contradictions.length ? `
        <h3 style="margin-top: 2rem;">⚠️ 矛盾點（需要與客戶討論的決策）</h3>
        ${analysis.contradictions.map(c => `
          <div class="contradiction-card">
            <h4>${c.title}</h4>
            <p><strong>問題：</strong>${c.description}</p>
            <p><strong>建議：</strong>${c.resolution}</p>
          </div>
        `).join('')}
      ` : ''}

      ${analysis.opportunities && analysis.opportunities.length ? `
        <h3 style="margin-top: 2rem;">💡 機會點（提案差異化）</h3>
        ${analysis.opportunities.map(o => `
          <div class="opportunity-card">
            <h4>${o.title}</h4>
            <p>${o.description}</p>
            <p class="muted"><strong>設計回應：</strong>${o.design_response}</p>
          </div>
        `).join('')}
      ` : ''}
    </section>
  `;
}

// === 設計師版渲染 ===
function renderDesignerReport(caseData, analysis) {
  const d = caseData.data;
  const members = extractMembers(d);

  // 抓所有設備品牌選擇
  const equipmentChoices = Object.keys(d)
    .filter(k => k.startsWith('eq_') && k.endsWith('_brand') && d[k])
    .map(k => {
      const itemKey = k.slice(3, -6);
      return { item: itemKey, brand: d[k], note: d[k.replace('_brand', '_note')] || '' };
    });

  // 抓所有有 model/voltage 的收納項（配電清單）
  const powerItems = Object.keys(d)
    .filter(k => k.startsWith('st_') && k.endsWith('_model') && d[k])
    .map(k => ({
      key: k.slice(3, -6),
      model: d[k],
    }));

  return `
    <article class="report designer-version">

      <header class="report-header designer-header">
        <div class="case-row">
          <span class="case-id">${caseData.caseId}</span>
          <span>·</span>
          <span>${val(d.case_type)}</span>
          <span>·</span>
          <span>${val(d.house_size)} 坪 ${val(d.house_type)}</span>
          <span>·</span>
          <span>預算 ${val(d.budget)}</span>
          <span>·</span>
          <span>入住 ${val(d.move_in_date)}</span>
        </div>
      </header>

      <section class="report-section">
        <h2>家庭結構</h2>
        <table class="report-table">
          <thead><tr>
            <th>稱謂</th><th>年齡</th><th>職業</th><th>身高</th><th>型態</th><th>睡眠</th><th>主要需求</th><th>負責</th>
          </tr></thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td><strong>${val(m.role)}</strong></td>
                <td>${val(m.age)}</td>
                <td>${val(m.occupation)}</td>
                <td>${val(m.height)}</td>
                <td>${val(m.lifestyle)}</td>
                <td>${val(m.sleep)}</td>
                <td>${val(m.main_need)}</td>
                <td>${val(m.responsibilities)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </section>

      <section class="report-section three-col">
        <div>
          <h3>風格</h3>
          <p><strong>空間：</strong>${val(d.color_space)}</p>
          <p><strong>地板：</strong>${val(d.color_floor)}</p>
          <p><strong>櫃子：</strong>${val(d.color_cabinet)}</p>
          <p><strong>材質偏好：</strong>木 ${val(d.material_wood)}/5 · 金 ${val(d.material_metal)}/5 · 石 ${val(d.material_stone)}/5 · 玻 ${val(d.material_glass)}/5</p>
        </div>
        <div>
          <h3>痛點 / 動機</h3>
          <p><strong>痛點：</strong>${val(d.pain_points)}</p>
          <p><strong>翻新原因：</strong>${val(d.renovation_reason)}</p>
          <p><strong>容易亂的地方：</strong>${val(d.messy_areas)}</p>
        </div>
        <div>
          <h3>期待</h3>
          <p><strong>許願清單：</strong>${val(d.wishlist)}</p>
          <p><strong>重視 Top 3：</strong>${val(d.priority_1)} / ${val(d.priority_2)} / ${val(d.priority_3)}</p>
          <p><strong>預算彈性：</strong>${val(d.budget_flex)}</p>
          <p><strong>設計態度：</strong>${val(d.design_attitude)}</p>
        </div>
      </section>

      <section class="report-section">
        <h2>生活習慣</h2>
        <div class="kv-grid">
          <div><strong>開伙：</strong>${val(d.cooking_frequency)} · 用餐 ${val(d.dining_count)} 人 · ${val(d.cooking_styles)}</div>
          <div><strong>訪客：</strong>${val(d.visitor_frequency)} · 常 ${val(d.visitor_count)} 人</div>
          <div><strong>書籍：</strong>${val(d.books)}</div>
          <div><strong>收藏：</strong>${val(d.collections)}</div>
          <div><strong>大型物品：</strong>${val(d.large_items)}</div>
          <div><strong>行李：</strong>大 ${val(d.luggage_large)} 個 · 登機 ${val(d.luggage_carry)} 個</div>
          <div class="full-row"><strong>插座需求：</strong>${val(d.outlets)}</div>
          <div class="full-row"><strong>希望改善：</strong>${val(d.habits_improve)}</div>
          <div class="full-row"><strong>希望培養：</strong>${val(d.habits_cultivate)}</div>
        </div>
      </section>

      <section class="report-section">
        <h2>設備品牌選擇</h2>
        ${equipmentChoices.length ? `
          <table class="report-table">
            <thead><tr><th>項目</th><th>選擇品牌</th><th>備註 / 型號</th></tr></thead>
            <tbody>
              ${equipmentChoices.map(e => `
                <tr>
                  <td>${e.item}</td>
                  <td><strong>${e.brand}</strong></td>
                  <td>${e.note || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p class="muted">客戶尚未選擇設備品牌。</p>'}
      </section>

      <section class="report-section">
        <h2>配電清單（待補）</h2>
        ${powerItems.length ? `
          <table class="report-table">
            <thead><tr><th>項目</th><th>型號 / 電壓</th></tr></thead>
            <tbody>
              ${powerItems.map(p => `<tr><td>${p.key}</td><td>${p.model}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : '<p class="muted">尚未填入家電型號。設計師可在 <code>designer.html</code> 補完。</p>'}
      </section>

      <section class="report-section">
        <h2>背景資料（Section E · 總監）</h2>
        <div class="kv-grid">
          <div><strong>產權：</strong>${val(d.ownership)}</div>
          <div><strong>第一次購屋：</strong>${val(d.first_home)}</div>
          <div><strong>其他房屋：</strong>${val(d.other_homes)}</div>
          <div><strong>找 GLN 來源：</strong>${val(d.referral)}</div>
          <div><strong>未來用途：</strong>${val(d.house_use)}</div>
          <div><strong>人口組成：</strong>${val(d.household_type)}</div>
        </div>
      </section>

      <section class="report-section">
        <h2>總監備註</h2>
        <div class="director-notes">
          ${val(d.designer_notes, '<span class="muted">尚無備註。請在 designer.html 後台填寫。</span>')}
        </div>
      </section>

      ${renderAnalysis(analysis)}

    </article>
  `;
}

// === 載入並渲染 ===
async function init() {
  try {
    const caseData = await loadCase();
    let html;
    if (version === 'designer') {
      const analysis = await loadAnalysis();
      html = renderDesignerReport(caseData, analysis);
    } else {
      html = renderClientReport(caseData);
    }
    $('#report-root').innerHTML = html;
    updateToggle();
  } catch (err) {
    $('#report-root').innerHTML = `<div class="status-banner error">載入失敗：${err.message}</div>`;
  }
}

function updateToggle() {
  $$('.toggle-btn').forEach(btn => {
    const v = btn.dataset.version;
    btn.classList.toggle('active', v === version);
    const newParams = new URLSearchParams(window.location.search);
    newParams.set('v', v);
    btn.href = '?' + newParams.toString();
  });
}

$('#print-btn').addEventListener('click', () => window.print());

init();
