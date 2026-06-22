/* ============================================================
   GLN 客戶問卷 — 報告頁
   URL: /report.html?id=<caseId>&v=<client|designer>&demo=1
   ============================================================ */

const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzCpoKgXvana8_6cxxB1jrn0qCW8ulw7iX-vVrDJbqCQZ36KjAhHJRNAd489N_z564zsw/exec';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const params = new URLSearchParams(window.location.search);

const caseId = params.get('id') || 'GLN-DEMO';
const version = (params.get('v') || 'client').toLowerCase();
const demoMode = params.get('demo') === '1' || !GAS_ENDPOINT;

// === 載入資料 ===
let _cachedAnalysis = null; // GAS 一次回傳 case + analysis，loadAnalysis 直接讀此快取

async function loadCase() {
  if (demoMode) {
    return fetch('data/demo-case.json').then(r => r.json());
  }
  const url = `${GAS_ENDPOINT}?id=${encodeURIComponent(caseId)}&v=${version}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'load failed');
  _cachedAnalysis = json.analysis || null;
  return { caseId: json.data.caseId, timestamp: json.data.timestamp, data: json.data.data };
}

async function loadAnalysis() {
  if (demoMode) {
    return fetch('data/demo-analysis.json').then(r => r.ok ? r.json() : null).catch(() => null);
  }
  // 真實案件：GAS doGet 已把 analysis 回在同一個 response，loadCase 時已快取
  return _cachedAnalysis;
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

function extractPets(data) {
  const count = parseInt(data._petCount || 0, 10);
  const pets = [];
  for (let i = 1; i <= count; i++) {
    const p = { id: i };
    const prefix = `pet-${i}_`;
    Object.keys(data).forEach(k => {
      if (k.startsWith(prefix)) {
        p[k.slice(prefix.length)] = data[k];
      }
    });
    if (p.name || p.species) pets.push(p);
  }
  return pets;
}

function extractReferencePhotos(data) {
  // GAS 上傳成功後會放 _reference_photo_urls = [{name, url, id}]
  const urls = data._reference_photo_urls;
  if (!urls) return [];
  if (Array.isArray(urls)) return urls;
  try { return JSON.parse(urls); } catch (e) { return []; }
}

// 所有材質 (10 個)：固定順序 + 中文 label
const ALL_MATERIALS = [
  ['木紋', 'material_wood'],
  ['金屬', 'material_metal'],
  ['石材', 'material_stone'],
  ['玻璃', 'material_glass'],
  ['皮革', 'material_leather'],
  ['織品', 'material_fabric'],
  ['藤編', 'material_rattan'],
  ['水泥', 'material_concrete'],
  ['磁磚', 'material_tile'],
  ['灰泥', 'material_plaster'],
];

function val(v, fallback = '—') {
  if (v === undefined || v === null || v === '') return fallback;
  if (Array.isArray(v)) return v.length ? v.join(' · ') : fallback;
  return v;
}

// ============================================================
// === 空間人格：計算 + 渲染 ===
// ============================================================

function computePersonality(spectrum, feelingsData, topN = 3) {
  if (!spectrum || !feelingsData) return null;
  const topItems = spectrum.filter(s => s.pct > 0).slice(0, topN);
  if (topItems.length === 0) return null;

  // 人格原型匹配固定用 top 3
  const top3ForArchetype = topItems.slice(0, 3);
  const top3Keys = top3ForArchetype.map(s => s.key);

  // 補齊 profile + design_brief（全部 topN 項）
  const topFull = topItems.map(s => {
    const f = (feelingsData.feelings || []).find(f => f.key === s.key) || {};
    return { ...s, profile: f.profile || '', design_brief: f.design_brief || [], axis: s.axis || f.axis || '' };
  });

  // 匹配人格原型（固定用 top 3）
  const archetypes = feelingsData.archetypes || [];
  let bestArchetype = null;
  let bestScore = 0;
  for (const arch of archetypes) {
    if (arch.key === 'explorer') continue;
    const score = arch.triggers.filter(t => top3Keys.includes(t)).length;
    if (score > bestScore) { bestScore = score; bestArchetype = arch; }
  }
  if (bestScore < 2) bestArchetype = archetypes.find(a => a.key === 'explorer') || archetypes[archetypes.length - 1];

  // 脆弱點偵測（固定用 top 3）
  let fragility = null;
  const fragilityTypes = feelingsData.fragility || [];
  const spread = top3ForArchetype.length >= 3 ? top3ForArchetype[0].pct - top3ForArchetype[2].pct : 100;
  const axes = topFull.slice(0, 3).map(s => s.axis);
  const axisConflict = (axes.includes('temperature') && axes.includes('light_dark')) ||
                       (axes.includes('light') && axes.includes('light_dark'));
  const allScene = topFull.slice(0, 3).every(s => s.axis === 'scene');
  const topLiked = topItems[0].liked || 0;

  if (spread < 10) fragility = fragilityTypes.find(f => f.key === 'exploring');
  else if (axisConflict) fragility = fragilityTypes.find(f => f.key === 'layered');
  else if (allScene) fragility = fragilityTypes.find(f => f.key === 'atmosphere');
  else if (topLiked <= 5) fragility = fragilityTypes.find(f => f.key === 'precise');

  // 軸向矛盾點（用於兩版報告，掃描全部 topN 項）
  const contradictions = [];
  for (let i = 0; i < topFull.length; i++) {
    for (let j = i + 1; j < topFull.length; j++) {
      const a = topFull[i], b = topFull[j];
      if ((a.axis === 'temperature' && b.axis === 'light_dark') ||
          (a.axis === 'light_dark' && b.axis === 'temperature') ||
          (a.axis === 'light' && b.axis === 'light_dark') ||
          (a.axis === 'light_dark' && b.axis === 'light')) {
        contradictions.push({ a: a.label, b: b.label });
      }
    }
  }

  return { archetype: bestArchetype, topItems: topFull, fragility, contradictions };
}

function renderPersonalitySection(spectrum, feelingsData, version) {
  const isDesigner = version === 'designer';
  // 客戶版：top 3 + 圓餅 top 3；設計師版：top 5 + 圓餅 top 5
  const displayTopN = isDesigner ? 5 : 3;
  const p = computePersonality(spectrum, feelingsData, displayTopN);
  if (!p || !p.archetype) return '';
  const { archetype, topItems, fragility, contradictions } = p;

  // 圓餅圖：客戶版 top 3 + 其他，設計師版 top 5 + 其他
  const pieHtml = renderFeelingPie(spectrum, { topN: displayTopN });

  // 長條圖：顯示全部 topN 項
  const barsHtml = topItems.map(s => `
    <div class="personality-bar-row">
      <span class="personality-bar-label">${s.label}</span>
      <div class="personality-bar-track">
        <div class="personality-bar-fill" style="width:${s.pct}%;background:${s.color}"></div>
      </div>
      <span class="personality-bar-pct">${s.pct}%</span>
    </div>
  `).join('');

  // 心理側寫（客戶版 top 3，設計師版 top 5）
  const profilesHtml = topItems.filter(s => s.profile).map(s => `
    <div class="profile-item">
      <span class="profile-dot" style="background:${s.color}"></span>
      <div class="profile-content">
        <div class="profile-label">${s.label}</div>
        <div class="profile-text">${s.profile}</div>
      </div>
    </div>
  `).join('');

  // 矛盾點（客戶版：正向描述；設計師版：加設計行動）
  const contHtml = contradictions.length ? `
    <div class="personality-contradiction">
      <div class="cont-title">你的多層次面向</div>
      <div class="cont-body">
        你對 <strong>${contradictions.map(c => `${c.a}與${c.b}`).join('、')}</strong> 同時有共鳴——這兩種感覺在視覺溫度上屬於不同方向。這不是矛盾，而是說明你的空間需要夠細膩的設計語言，才能容納你全部的自己。
        ${isDesigner ? `<div class="designer-action">⚠️ 設計建議：以其中一個感覺為主調，另一個作為局部點綴，初次提案時請與客戶確認主從關係。</div>` : ''}
      </div>
    </div>
  ` : '';

  // 脆弱點（客戶版：只顯示正向 client_note；設計師版：顯示警示）
  const fragilityHtml = fragility ? `
    <div class="personality-fragility ${isDesigner ? 'is-designer' : ''}">
      ${isDesigner
        ? `<div class="fragility-alert">⚠️ ${fragility.designer_alert}</div>`
        : `<div class="fragility-note">${fragility.client_note}</div>`
      }
    </div>
  ` : '';

  // 設計方向（只在設計師版顯示）
  const allBriefs = [...new Set(topItems.flatMap(s => s.design_brief || []))].slice(0, 8);
  const briefsHtml = isDesigner && allBriefs.length ? `
    <div class="design-direction-block">
      <div class="design-direction-title">Top ${displayTopN} 交叉設計方向</div>
      <div class="design-brief-list">
        ${allBriefs.map(b => `<div class="brief-item">· ${b}</div>`).join('')}
      </div>
    </div>
  ` : '';

  const topLabel = isDesigner ? `你最有共鳴的 ${displayTopN} 種感覺` : '你最有共鳴的三種感覺';

  return `
    <section class="report-section personality-hero">
      <div class="personality-opening">
        「這是你對好感生活直覺的具體描繪，我們會專業陪伴一起探索屬於你的好感生活」
      </div>

      <div class="archetype-block">
        <div class="archetype-eyebrow">你的空間人格</div>
        <div class="archetype-name">${archetype.name}</div>
        <div class="archetype-tagline">${archetype.tagline}</div>
      </div>

      <div class="spectrum-summary-block">
        ${pieHtml}
        <div class="top3-block">
          <div class="top3-title">${topLabel}</div>
          ${barsHtml}
          <div class="top3-note">每個 % 代表你對那類照片的共鳴率，數字越高代表這個感覺對你越重要</div>
        </div>
      </div>

      <div class="archetype-cross-note">${archetype.cross_note}</div>

      <div class="personality-profiles">
        ${profilesHtml}
      </div>

      ${contHtml}
      ${fragilityHtml}
      ${briefsHtml}
    </section>
  `;
}

// === 感覺光譜：解析 + 渲染 ===
function parseSpectrum(d) {
  try {
    const raw = d._feeling_spectrum;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch { return null; }
}

function renderFeelingSpectrum(spectrum, opts = {}) {
  if (!spectrum || spectrum.length === 0) return '';
  const maxBars = opts.maxBars ?? 8;
  const topN = opts.topN ?? 6;
  const showPie = opts.showPie !== false;
  const showSummary = opts.showSummary !== false;

  const bars = spectrum.filter(s => s.pct > 0).slice(0, maxBars);
  if (bars.length === 0) {
    return `<p class="muted">客戶感覺偏好分散，未形成明顯光譜。</p>`;
  }

  const dominant = bars.slice(0, 3).map(s => s.label).join('、');
  const elements = Array.from(new Set(bars.flatMap(s => (s.desc || '').split(/[、，]/)))).filter(Boolean).slice(0, 6).join('、');

  return `
    ${showPie ? renderFeelingPie(spectrum, { topN }) : ''}
    <div class="feeling-spectrum" ${showPie ? 'style="margin-top:1.5rem;"' : ''}>
      ${bars.map(s => `
        <div class="feeling-bar-row">
          <div class="feeling-bar-label">${s.label}</div>
          <div class="feeling-bar-track"><div class="feeling-bar-fill" style="width:${s.pct}%; background:${s.color};"></div></div>
          <div class="feeling-bar-pct">${s.pct}%</div>
        </div>
      `).join('')}
    </div>
    ${showSummary ? `
      <div class="feeling-summary">
        <strong>核心感覺：</strong>${dominant}<br />
        <strong>共同元素：</strong>${elements}
      </div>
    ` : ''}
  `;
}

// === 圓餅圖（與 app.js 同步）===
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
      <text x="120" y="116" text-anchor="middle" font-family="'Noto Serif TC', serif" font-size="11" fill="#8E877D" letter-spacing="0.1em">感覺光譜</text>
      <text x="120" y="138" text-anchor="middle" font-family="'Noto Serif TC', serif" font-size="22" fill="#5E5347">${slices[0].label}</text>
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

function donutSlicePath(cx, cy, outerR, innerR, startAngle, endAngle, isFullCircle) {
  if (isFullCircle) {
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

// === 實際預算分配（提案版）===
// 資料來源：設計師於丈量提案後依實際報價單填入（designer.html）。
// 沒填 → 不顯示（不再回退預設比例）。
// 課稅（計入工程費 → 監工費 + 稅金基礎）：taxable=true 的群組（基礎/裝修）
// 另計 / 已含稅：taxable=false 的群組（設備/軟裝/設計費）
const BUDGET_GROUP_COLORS = ['#7C837B', '#A67C52', '#8E877D', '#B8A98F', '#9DA89A', '#6E7B73', '#C2A878'];
const fmtBudgetNT = n => 'NT$ ' + (Number(n) || 0).toLocaleString('en-US');

function computeBudgetAllocation(state) {
  let engineering = 0;
  const groupTotals = state.groups.map(g => {
    const sub = (g.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
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

function renderBudgetBreakdown(d) {
  const state = d.budget_allocation;
  if (!state || !Array.isArray(state.groups)) return '';
  const hasData = state.groups.some(g => (g.items || []).some(it => (Number(it.amount) || 0) > 0));
  if (!hasData) return ''; // 設計師沒填 → 不顯示

  const c = computeBudgetAllocation(state);

  // 大欄位 stacked bar（用各群組小計 + 監工費 + 稅金占比）
  const barParts = [];
  state.groups.forEach((g, i) => {
    if (c.groupTotals[i] > 0) barParts.push({ name: g.name, amount: c.groupTotals[i], color: BUDGET_GROUP_COLORS[i % BUDGET_GROUP_COLORS.length] });
  });
  if (c.supervision > 0) barParts.push({ name: '監工費', amount: c.supervision, color: '#9A8C7A' });
  if (c.tax > 0) barParts.push({ name: '稅金', amount: c.tax, color: '#B0A693' });
  const barTotal = barParts.reduce((s, p) => s + p.amount, 0) || 1;
  const barSegs = barParts.map(p => {
    const pct = (p.amount / barTotal * 100);
    return `<div class="bb-seg" style="width:${pct}%;background:${p.color};" title="${p.name} ${fmtBudgetNT(p.amount)}（${pct.toFixed(1)}%）">${pct >= 8 ? p.name : ''}</div>`;
  }).join('');

  // 各群組明細表
  const groupTables = state.groups.map((g, gi) => {
    const items = (g.items || []).filter(it => (Number(it.amount) || 0) > 0);
    if (!items.length) return '';
    return `
      <div class="ba-rpt-group">
        <div class="ba-rpt-group-head">
          <span class="bb-swatch" style="background:${BUDGET_GROUP_COLORS[gi % BUDGET_GROUP_COLORS.length]};"></span>
          <span class="ba-rpt-group-name">${g.name}</span>
          <span class="ba-rpt-group-sub">${fmtBudgetNT(c.groupTotals[gi])}</span>
        </div>
        ${items.map(it => `
          <div class="ba-rpt-row">
            <span class="ba-rpt-item">${it.name || '—'}</span>
            <span class="ba-rpt-amt">${fmtBudgetNT(it.amount)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  return `
    <section class="report-section">
      <h2>💰 實際預算分配（提案版）</h2>
      <div class="budget-breakdown">
        <div class="budget-breakdown-header">
          <div><span class="bb-figure-label">含稅後總合計</span><span class="bb-figure">${fmtBudgetNT(c.withTax)}</span></div>
        </div>
        <div class="budget-breakdown-bar" role="img" aria-label="預算分配長條圖">
          ${barSegs}
        </div>
        <div class="ba-rpt-tables">
          ${groupTables}
        </div>
        <div class="ba-rpt-summary">
          <div class="ba-rpt-sum-row"><span>工程費合計（基礎＋裝修）</span><span>${fmtBudgetNT(c.engineering)}</span></div>
          <div class="ba-rpt-sum-row"><span>監工費管理費（${state.supervision_pct}%）</span><span>${fmtBudgetNT(c.supervision)}</span></div>
          <div class="ba-rpt-sum-row"><span>稅金（${state.tax_pct}%）</span><span>${fmtBudgetNT(c.tax)}</span></div>
          <div class="ba-rpt-sum-row"><span>其他（設備／軟裝／設計費，已含稅）</span><span>${fmtBudgetNT(c.otherTotal)}</span></div>
          <div class="ba-rpt-sum-row total"><span>總合計（未稅）</span><span>${fmtBudgetNT(c.preTax)}</span></div>
          <div class="ba-rpt-sum-row total final"><span>含稅後總合計</span><span>${fmtBudgetNT(c.withTax)}</span></div>
        </div>
        <div class="budget-breakdown-note">
          此為丈量提案後設計師依實際報價單填列之金額，供設計師／客戶／總監三方對齊。實際以正式合約報價單為準。
        </div>
      </div>
    </section>
  `;
}

// === 統一報告渲染（客戶版 + 設計師版）===
function renderReport(caseData, analysis, feelingsData, version) {
  const isDesigner = version === 'designer';
  const d = caseData.data;
  const members = extractMembers(d);
  const pets = extractPets(d);
  const refPhotos = extractReferencePhotos(d);
  const spectrum = parseSpectrum(d);

  const equipmentChoices = Object.keys(d)
    .filter(k => k.startsWith('eq_') && k.endsWith('_brand') && d[k])
    .map(k => {
      const itemKey = k.slice(3, -6);
      return { item: itemKey, brand: d[k], note: d[k.replace('_brand', '_note')] || '' };
    });

  const powerItems = Object.keys(d)
    .filter(k => k.startsWith('st_') && k.endsWith('_model') && d[k])
    .map(k => ({ key: k.slice(3, -6), model: d[k] }));

  // Header
  const headerHtml = isDesigner ? `
    <header class="report-header designer-header">
      <div class="case-row">
        <span class="case-id">${caseData.caseId}</span><span>·</span>
        <span>${val(d.case_type)}</span><span>·</span>
        <span>${val(d.house_size)} 坪 ${val(d.house_type)}</span><span>·</span>
        <span>預算 ${val(d.budget)}</span><span>·</span>
        <span>入住 ${val(d.move_in_date)}</span>
      </div>
    </header>
  ` : `
    <header class="report-header">
      <div class="case-id">${caseData.caseId}</div>
      <h1>你的家，從這裡開始</h1>
      <p class="muted">提交時間：${new Date(caseData.timestamp).toLocaleString('zh-TW')}</p>
    </header>
  `;

  // Section A: 家庭成員（兩版都完整顯示所有客戶填寫欄位）
  const membersHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '家庭結構' : '你的家庭'}</h2>
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
  `;

  // Section A: 寵物
  const petsHtml = pets.length ? (isDesigner ? `
    <section class="report-section">
      <h2>🐾 毛小孩、寵物（影響地板/動線/材質判斷）</h2>
      <table class="report-table">
        <thead><tr>
          <th>名字</th><th>物種</th><th>體型</th><th>年齡</th><th>活動區域</th>
          <th>飲食/如廁位置</th><th>掉毛/抓咬</th><th>環境需求</th><th>其他</th>
        </tr></thead>
        <tbody>
          ${pets.map(p => `
            <tr>
              <td><strong>${val(p.name)}</strong></td>
              <td>${val(p.species)}</td>
              <td>${val(p.size)}</td>
              <td>${val(p.age)}</td>
              <td>${val(p.activity_area)}</td>
              <td>${val(p.feeding_spot)}</td>
              <td>${val(p.damage)}</td>
              <td>${val(p.env_need)}</td>
              <td>${val(p.other_need)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>
  ` : `
    <section class="report-section">
      <h2>🐾 毛小孩、寵物</h2>
      <div class="pet-grid">
        ${pets.map(p => `
          <div class="pet-tile">
            <div class="pet-name">${val(p.name)} <span class="pet-species">${val(p.species)}</span></div>
            <div class="pet-meta">${val(p.size, '')} · ${val(p.age, '')}</div>
            <div class="pet-detail"><strong>活動：</strong>${val(p.activity_area)}</div>
            <div class="pet-detail"><strong>飲食/如廁：</strong>${val(p.feeding_spot)}</div>
            <div class="pet-detail"><strong>環境需求：</strong>${val(p.env_need)}</div>
          </div>
        `).join('')}
      </div>
    </section>
  `) : '';

  // Section B: 房屋基本資料（兩版都顯示預算 + 彈性）
  const houseHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '房屋資料' : '房屋基本資料'}</h2>
      <div class="metric-grid">
        <div class="metric"><div class="metric-label">屋齡</div><div class="metric-value">${val(d.house_age)} 年</div></div>
        <div class="metric"><div class="metric-label">坪數</div><div class="metric-value">${val(d.house_size)} 坪</div></div>
        <div class="metric"><div class="metric-label">形態</div><div class="metric-value">${val(d.house_type)}</div></div>
        <div class="metric"><div class="metric-label">預算</div><div class="metric-value">${val(d.budget)}</div></div>
        <div class="metric"><div class="metric-label">預算彈性</div><div class="metric-value">${val(d.budget_flex)}</div></div>
        <div class="metric"><div class="metric-label">入住</div><div class="metric-value">${val(d.move_in_date)}</div></div>
        <div class="metric"><div class="metric-label">分類</div><div class="metric-value">${val(d.case_type)}</div></div>
      </div>
    </section>
  `;

  // 預算分配視覺化（兩版都顯示，依 GLN 預設比例自動拆分）
  const budgetBreakdownHtml = renderBudgetBreakdown(d);

  // Section C: 風格偏好 + 材質 + 參考圖
  const styleHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '風格 / 色調 / 材質' : '你的風格偏好'}</h2>
      <div class="report-paragraph">
        <strong>空間色調：</strong>${val(d.color_space)}<br />
        <strong>地板色調：</strong>${val(d.color_floor)}<br />
        <strong>櫃子色調：</strong>${val(d.color_cabinet)}
      </div>
      <div class="material-bars">
        ${ALL_MATERIALS.map(([label, key]) => {
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
    ${refPhotos.length ? `
      <section class="report-section">
        <h2>📷 ${isDesigner ? `客戶上傳的參考圖（${refPhotos.length} 張）` : '你上傳的參考圖'}</h2>
        <p class="muted" style="margin-bottom: 1rem;">${isDesigner ? '客戶心目中的居住氛圍。點圖開大圖（存於 Drive 客戶資料夾）。' : '這些是你心目中理想的居住氛圍，我們會仔細看。'}</p>
        <div class="ref-photos-grid">
          ${refPhotos.map(p => `
            <a href="${p.url}" target="_blank" rel="noopener" class="ref-photo-link">
              <img src="${p.url.replace(/\/view$/, '/preview') || p.url}" alt="${p.name}" loading="lazy" />
              <div class="ref-photo-name">${p.name}</div>
            </a>
          `).join('')}
        </div>
      </section>
    ` : ''}
    ${d._reference_link ? `
      <section class="report-section">
        <h2>🔗 ${isDesigner ? '客戶提供的參考連結' : '你提供的參考連結'}</h2>
        <p class="muted" style="margin-bottom: 0.75rem;">${isDesigner ? '客戶提供的圖片相簿或資料夾，點擊開啟瀏覽。' : '你提供的圖片連結，設計師會仔細看。'}</p>
        <a href="${d._reference_link}" target="_blank" rel="noopener" class="ref-external-link">${d._reference_link}</a>
      </section>
    ` : ''}
  `;

  // Section D: 生活樣貌（兩版都完整顯示所有客戶填寫欄位）
  const habitsHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '生活習慣' : '你的生活樣貌'}</h2>
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
  `;

  // 樓層 × 空間規劃
  let floorPlanRows = '';
  try {
    const floors = typeof d._floor_plan === 'string'
      ? JSON.parse(d._floor_plan || '[]')
      : (Array.isArray(d._floor_plan) ? d._floor_plan : []);
    floorPlanRows = (floors || [])
      .map(f => {
        // 相容舊格式 {name, desc}
        const rooms = Array.isArray(f.rooms)
          ? f.rooms.filter(r => r && (r.room || r.desc))
          : (f.desc ? [{ room: '', desc: f.desc }] : []);
        const floorName = f.floor || f.name || '';
        if (!floorName && !rooms.length) return '';
        const roomRows = rooms.length
          ? rooms.map(r => `<tr><th>${val(r.room)}</th><td>${val(r.desc)}</td></tr>`).join('')
          : `<tr><td colspan="2" class="muted">—</td></tr>`;
        return `
          <tr class="floor-row"><td colspan="2"><strong>${val(floorName, '（未標樓層）')}</strong></td></tr>
          ${roomRows}
        `;
      })
      .join('');
  } catch (e) { floorPlanRows = ''; }
  const floorPlanHtml = floorPlanRows ? `
    <div class="report-floor-plan">
      <strong>樓層 × 空間規劃</strong>
      <table class="report-table"><tbody>${floorPlanRows}</tbody></table>
      ${d.floor_priority ? `<p class="muted" style="margin-top:0.5rem;"><strong>整體優先順序：</strong>${val(d.floor_priority)}</p>` : ''}
    </div>
  ` : '';

  // Section E: 空間需求
  const needsHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '空間需求 / 期待' : '你最重視的'}</h2>
      <ol class="priority-list">
        <li>${val(d.priority_1)}</li>
        <li>${val(d.priority_2)}</li>
        <li>${val(d.priority_3)}</li>
      </ol>
      ${floorPlanHtml}
      <div class="report-paragraph">
        <strong>痛點：</strong>${val(d.pain_points)}<br />
        <strong>翻新原因：</strong>${val(d.renovation_reason)}<br />
        <strong>空間許願清單：</strong>${val(d.wishlist)}<br />
        <strong>想討論的主題：</strong>${val(d.discussion_topics)}<br />
        <strong>對設計師的期待：</strong>${val(d.designer_expectations)}<br />
        <strong>容易亂的地方：</strong>${val(d.messy_areas)}<br />
        <strong>設計態度：</strong>${val(d.design_attitude)}
      </div>
    </section>
  `;

  // 設備品牌選擇
  const equipmentHtml = `
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
      ` : '<p class="muted">尚未選擇設備品牌。</p>'}
    </section>
  `;

  // 配電清單（兩版都顯示客戶填寫的內容，空白提示語依版本不同）
  const powerHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '配電清單（待補）' : '你的家電配置'}</h2>
      ${powerItems.length ? `
        <table class="report-table">
          <thead><tr><th>項目</th><th>型號 / 電壓</th></tr></thead>
          <tbody>
            ${powerItems.map(p => `<tr><td>${p.key}</td><td>${p.model}</td></tr>`).join('')}
          </tbody>
        </table>
      ` : `<p class="muted">${isDesigner ? '尚未填入家電型號。設計師可在 designer.html 補完。' : '尚未填入家電型號。'}</p>`}
    </section>
  `;

  // 背景資料
  const backgroundHtml = `
    <section class="report-section">
      <h2>${isDesigner ? '背景資料（Section E · 總監）' : '其他資訊'}</h2>
      <div class="kv-grid">
        <div><strong>產權：</strong>${val(d.ownership)}</div>
        <div><strong>第一次購屋：</strong>${val(d.first_home)}</div>
        <div><strong>其他房屋：</strong>${val(d.other_homes)}</div>
        <div><strong>找 GLN 來源：</strong>${val(d.referral)}</div>
        <div><strong>未來用途：</strong>${val(d.house_use)}</div>
        <div><strong>人口組成：</strong>${val(d.household_type)}</div>
      </div>
    </section>
  `;

  return `
    <article class="report ${isDesigner ? 'designer-version' : 'client-version'}">
      ${headerHtml}
      ${spectrum ? renderPersonalitySection(spectrum, feelingsData, version) : ''}
      ${membersHtml}
      ${petsHtml}
      ${houseHtml}
      ${budgetBreakdownHtml}
      ${styleHtml}
      ${habitsHtml}
      ${needsHtml}
      ${equipmentHtml}
      ${powerHtml}
      ${backgroundHtml}
      ${!isDesigner ? '<section id="client-meeting-notes" class="report-section"><p class="muted">載入會議紀錄中…</p></section>' : ''}
      ${renderAnalysis(analysis, version)}
      <footer class="report-footer no-print">
        <p class="muted">${isDesigner ? 'GLN 設計師桌面速查版' : '資料無誤嗎？如需修改，請聯絡 GLN 設計團隊。'}</p>
      </footer>
    </article>
  `;
}

// === AI 分析渲染（分級版：客戶版只顯示 Level A，設計師版顯示全部）===
function renderAnalysis(analysis, version) {
  const isDesigner = version === 'designer';

  if (!analysis) {
    if (!isDesigner) return ''; // 客戶版不顯示 AI 區塊
    return `
      <section class="report-section ai-analysis">
        <h2>🧠 AI 隱性需求分析</h2>
        <p class="muted">尚未生成此案件的 AI 分析。將來啟用 Claude API 後，會在客戶提交時自動產生。</p>
      </section>
    `;
  }

  // 判斷 design_response 是新格式（object with feasibility_level）還是舊格式（string）
  const isNewFormat = analysis.implicit_needs && analysis.implicit_needs.length > 0
    && analysis.implicit_needs[0].design_response
    && analysis.implicit_needs[0].design_response.length > 0
    && typeof analysis.implicit_needs[0].design_response[0] === 'object';

  // 工具：渲染單個 design_response item
  const levelLabel = { A: '✅ 預算內可行', B: '⚠️ 超預算但可行', C: '🚫 不建議' };
  const levelColor = { A: '#7B9070', B: '#A67C52', C: '#B85450' };

  function renderDesignResponseItem(item, showLevel) {
    if (typeof item === 'string') {
      // 舊格式：純文字
      return `<li>${item}</li>`;
    }
    // 新格式：object
    const levelTag = showLevel && item.feasibility_level
      ? `<span class="level-tag" style="background:${levelColor[item.feasibility_level] || '#8E877D'};color:#fff;padding:2px 8px;border-radius:3px;font-size:0.75em;margin-right:0.5em;">${levelLabel[item.feasibility_level] || item.feasibility_level}</span>`
      : '';
    const budgetNote = item.budget_note && showLevel
      ? `<div class="budget-note" style="color:#A67C52;font-size:0.85em;margin-top:0.3em;">💰 ${item.budget_note}</div>`
      : '';
    const rejectionNote = item.rejection_reason && showLevel
      ? `<div class="rejection-note" style="color:#B85450;font-size:0.85em;margin-top:0.3em;">🚫 ${item.rejection_reason}</div>`
      : '';
    const blankWarning = item.blank_trade_warning && showLevel
      ? `<div class="blank-trade-warning" style="color:#8E877D;font-size:0.85em;margin-top:0.3em;">⚠️ ${item.blank_trade_warning}：需設計師現場估價</div>`
      : '';
    const siteWarning = item.requires_site_survey && showLevel
      ? `<div style="color:#8E877D;font-size:0.85em;">📍 需現場丈量確認</div>`
      : '';
    return `<li>${levelTag}${item.action}${budgetNote}${rejectionNote}${blankWarning}${siteWarning}</li>`;
  }

  // 過濾 design_response：客戶版只保留 Level A
  function filterResponses(responses) {
    if (!isNewFormat) return responses; // 舊格式全部顯示
    if (isDesigner) return responses; // 設計師版全部顯示
    // 客戶版：只保留 Level A
    return responses.filter(r => typeof r === 'string' || r.feasibility_level === 'A');
  }

  // 過濾 needs：客戶版排除全部 response 都不是 Level A 的 need
  function filterNeeds(needs) {
    if (!isNewFormat || isDesigner) return needs;
    return needs.filter(need => {
      const filtered = filterResponses(need.design_response || []);
      return filtered.length > 0;
    });
  }

  // === 預算上下文區塊（設計師版專用）===
  const bc = analysis.budget_context;
  const budgetContextHtml = isDesigner && bc ? `
    <section class="report-section budget-context">
      <h2>📊 預算護欄計算</h2>
      <div class="metric-grid" style="margin-bottom:1rem;">
        <div class="metric"><div class="metric-label">粗估總預算</div><div class="metric-value">${bc.estimated_total_10k} 萬</div></div>
        <div class="metric"><div class="metric-label">基礎工程可用</div><div class="metric-value">${bc.available_foundation_10k} 萬</div></div>
        <div class="metric"><div class="metric-label">裝修工程可用</div><div class="metric-value">${bc.available_renovation_10k} 萬</div></div>
        <div class="metric"><div class="metric-label">客戶期待預算</div><div class="metric-value">${bc.client_budget_10k != null ? bc.client_budget_10k + ' 萬' : '未填'}</div></div>
        <div class="metric"><div class="metric-label">採用預算上限</div><div class="metric-value" style="color:#B85450;font-weight:bold;">${bc.effective_budget_10k} 萬</div></div>
      </div>
      ${bc.calculation_note ? `<p class="muted" style="font-size:0.85em;">${bc.calculation_note}</p>` : ''}
    </section>
  ` : '';

  // AI 生成的感覺矛盾點（補充在空間人格版塊後、隱性需求前）
  const sp = analysis.space_personality;
  const spHtml = sp ? `
    <section class="report-section ai-personality-supplement">
      <h2>🧠 AI 空間人格深度分析</h2>
      <div class="ai-archetype-name">${sp.archetype_name || ''}</div>
      ${sp.cross_analysis ? `<div class="ai-cross-analysis">${sp.cross_analysis}</div>` : ''}
      ${isDesigner && sp.feeling_contradictions && sp.feeling_contradictions.length ? `
        <h3 style="margin-top:1.5rem;">感覺矛盾點</h3>
        ${sp.feeling_contradictions.map(fc => `
          <div class="personality-contradiction">
            <div class="cont-title">${fc.feeling_a} × ${fc.feeling_b}</div>
            <div class="cont-body">
              <p>${fc.insight}</p>
              <p><strong>客戶溝通版：</strong>${fc.client_version}</p>
              <div class="designer-action"><strong>設計策略：</strong>${fc.design_strategy}</div>
            </div>
          </div>
        `).join('')}
      ` : ''}
    </section>
  ` : '';

  const priorityColor = (p) => ({ P0: '#B85450', P1: '#A67C52', P2: '#7B9070', P3: '#8E877D' }[p] || '#8E877D');

  // 過濾後的 needs
  const filteredNeeds = filterNeeds(analysis.implicit_needs || []);

  // 計算各 Level 統計（設計師版顯示）
  let levelStats = { A: 0, B: 0, C: 0 };
  if (isNewFormat) {
    (analysis.implicit_needs || []).forEach(need => {
      (need.design_response || []).forEach(r => {
        if (r.feasibility_level) levelStats[r.feasibility_level] = (levelStats[r.feasibility_level] || 0) + 1;
      });
    });
    (analysis.opportunities || []).forEach(o => {
      const dr = o.design_response;
      if (dr && dr.feasibility_level) levelStats[dr.feasibility_level] = (levelStats[dr.feasibility_level] || 0) + 1;
    });
  }

  const statsHtml = isDesigner && isNewFormat ? `
    <div class="level-stats" style="display:flex;gap:1.5rem;margin:1rem 0;padding:0.75rem 1rem;background:#FAF8F4;border-radius:8px;">
      <span style="color:${levelColor.A}">✅ Level A：${levelStats.A} 項</span>
      <span style="color:${levelColor.B}">⚠️ Level B：${levelStats.B} 項</span>
      <span style="color:${levelColor.C}">🚫 Level C：${levelStats.C} 項</span>
    </div>
  ` : '';

  const sectionTitle = isDesigner ? '🧠 AI 隱性需求分析' : '✨ 為你的家量身打造的設計洞察';
  const sectionDesc = isDesigner
    ? '交叉比對客戶答案與 GLN 機能設計知識庫 V4（93 條設計知識），自動產生客戶未明說的隱性需求洞察。'
    : '根據你的問卷回答，我們發現了以下幾個讓你的家更貼近理想生活的設計方向。';

  return `
    ${budgetContextHtml}
    ${spHtml}
    <section class="report-section ai-analysis">
      <h2>${sectionTitle}</h2>
      <p class="muted">${sectionDesc}</p>
      ${statsHtml}

      <div class="analysis-summary">
        <strong>${isDesigner ? '案件摘要' : '整體印象'}：</strong>${analysis.summary}
      </div>

      <h3 style="margin-top: 2rem;">${isDesigner ? `隱性需求清單（${filteredNeeds.length} 項${!isNewFormat ? '' : '，顯示' + (isDesigner ? '全部' : '預算內可行') + '建議'}）` : `我們為你準備的設計方向（${filteredNeeds.length} 項）`}</h3>
      ${filteredNeeds.map(need => {
        const responses = filterResponses(need.design_response || []);
        return `
        <div class="insight-card">
          <div class="insight-header">
            ${isDesigner ? `<span class="priority-tag" style="background:${priorityColor(need.priority)}">${need.priority}</span>` : ''}
            <h4>${need.title}</h4>
          </div>
          <div class="insight-body">
            ${isDesigner ? `
              <div class="insight-block">
                <strong>觀察訊號：</strong>
                <ul>${need.signals.map(s => `<li>${s}</li>`).join('')}</ul>
              </div>
              <div class="insight-block">
                <strong>推論：</strong>${need.inference}
              </div>
            ` : ''}
            <div class="insight-block">
              <strong>${isDesigner ? '設計回應' : '建議做法'}：</strong>
              <ul>${responses.map(r => renderDesignResponseItem(r, isDesigner)).join('')}</ul>
            </div>
            ${isDesigner ? `
              <div class="insight-meta">
                <span>📚 知識庫參考：${(need.knowledge_refs || []).join(' · ') || '—'}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `}).join('')}

      ${isDesigner && analysis.contradictions && analysis.contradictions.length ? `
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
        <h3 style="margin-top: 2rem;">${isDesigner ? '💡 機會點（提案差異化）' : '💡 額外的驚喜可能'}</h3>
        ${analysis.opportunities.filter(o => {
          if (isDesigner) return true;
          // 客戶版：只顯示 Level A 的機會點
          const dr = o.design_response;
          if (!dr || typeof dr === 'string') return true;
          return dr.feasibility_level === 'A';
        }).map(o => {
          const dr = o.design_response;
          const drText = typeof dr === 'string' ? dr : (dr ? dr.action : '');
          const drMeta = isDesigner && typeof dr === 'object' && dr ? `
            ${dr.feasibility_level ? `<span class="level-tag" style="background:${levelColor[dr.feasibility_level]};color:#fff;padding:2px 8px;border-radius:3px;font-size:0.75em;">${levelLabel[dr.feasibility_level]}</span>` : ''}
            ${dr.budget_note ? `<div style="color:#A67C52;font-size:0.85em;margin-top:0.3em;">💰 ${dr.budget_note}</div>` : ''}
            ${dr.blank_trade_warning ? `<div style="color:#8E877D;font-size:0.85em;">⚠️ ${dr.blank_trade_warning}：需設計師現場估價</div>` : ''}
          ` : '';
          return `
          <div class="opportunity-card">
            <h4>${o.title}</h4>
            <p>${o.description}</p>
            <p class="muted"><strong>${isDesigner ? '設計回應' : '建議做法'}：</strong>${drText} ${drMeta}</p>
          </div>
        `}).join('')}
      ` : ''}
    </section>
  `;
}


// === 客戶會議紀錄（只顯示客戶會議筆記的重點條列 + 備註，客戶可留言）===
const RPT_AUTHOR_LABEL = { director: '總監', designer: '設計師', client: '您' };

const RPT_NOTES_DEMO = {
  meetings: [
    { timestamp: '2026-06-21 11:00', author: 'designer', summary: ['確認開放式廚房，中島含電陶爐', '主臥更衣室改獨立小房（約 1.5 坪）', '玄關增設鞋櫃 + 穿鞋椅'] },
    { timestamp: '2026-06-21 18:40', author: 'client', summary: ['主臥更衣室希望保留開放式，不要改成獨立小房'] },
  ],
  comments: [
    { timestamp: '2026-06-21 15:30', author: 'client', text: '中島想再大一點，可以坐 3 個人嗎？' },
    { timestamp: '2026-06-21 16:10', author: 'director', text: '已記下，下次提案會評估中島加大到 240cm。' },
  ],
};

function renderClientMeetingNotes(payload) {
  const root = $('#client-meeting-notes');
  if (!root) return;
  const meetings = payload.meetings || [];
  const comments = payload.comments || [];

  const meetingHtml = meetings.length
    ? meetings.map(m => `
        <div class="cmn-meeting${m.author === 'client' ? ' cmn-meeting-client' : ''}">
          <div class="cmn-meeting-ts">${m.timestamp}${m.author ? ' · ' + (RPT_AUTHOR_LABEL[m.author] || m.author) : ''}</div>
          <ul class="cmn-summary">${(m.summary || []).map(s => `<li>${s}</li>`).join('')}</ul>
        </div>`).join('')
    : '<p class="muted">目前還沒有會議紀錄。設計師完成會議後會整理在這裡。</p>';

  const commentHtml = comments.length
    ? comments.map(c => `
        <div class="cmn-comment ${c.author}">
          <span class="cmn-comment-author">${RPT_AUTHOR_LABEL[c.author] || c.author}</span>
          <span class="cmn-comment-text">${(c.text || '').replace(/\n/g, '<br>')}</span>
          <span class="cmn-comment-ts">${c.timestamp}</span>
        </div>`).join('')
    : '<p class="muted" style="font-size:.85rem;">尚無備註，有任何想補充的都可以寫在下方。</p>';

  root.innerHTML = `
    <h2>會議紀錄</h2>
    <p class="section-meta">以下是與設計師討論後整理的重點。設計師若有記錄錯誤或遺漏，您可以在下方自行補充會議重點。</p>
    ${meetingHtml}
    <div class="cmn-note-add no-print">
      <div class="cmn-note-head">✏️ 補充會議重點</div>
      <p class="muted" style="font-size:.8rem;margin:.2rem 0 .5rem;">記錄有誤或漏掉的，補在這裡，會直接列入上方會議重點（標示為「您」）。</p>
      <textarea id="cmn-note-input" rows="2" placeholder="例：主臥更衣室希望保留，不要改成獨立小房…"></textarea>
      <button type="button" class="btn btn-primary" id="cmn-note-send">補充會議重點</button>
      <p class="muted" id="cmn-note-status" style="font-size:.8rem;margin-top:.3rem;"></p>
    </div>
    <div class="cmn-comment-thread">
      <div class="cmn-comment-head">💬 備註（想問設計師的問題、其他補充）</div>
      ${commentHtml}
      <div class="cmn-comment-add no-print">
        <input id="cmn-comment-input" type="text" placeholder="輸入您的備註 / 補充…" />
        <button type="button" class="btn btn-primary" id="cmn-comment-send">送出</button>
      </div>
      <p class="muted" id="cmn-comment-status" style="font-size:.8rem;margin-top:.3rem;"></p>
    </div>
  `;
  $('#cmn-comment-send')?.addEventListener('click', submitClientComment);
  $('#cmn-note-send')?.addEventListener('click', submitClientNote);
}

async function loadClientMeetingNotes() {
  const root = $('#client-meeting-notes');
  if (!root) return;
  if (demoMode) { renderClientMeetingNotes(RPT_NOTES_DEMO); return; }
  try {
    const url = `${GAS_ENDPOINT}?action=get_client_notes&case_id=${encodeURIComponent(caseId)}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    renderClientMeetingNotes(json);
  } catch (err) {
    root.innerHTML = `<h2>會議紀錄</h2><p class="muted">載入失敗：${err.message}</p>`;
  }
}

async function submitClientComment() {
  const statusEl = $('#cmn-comment-status');
  const input = $('#cmn-comment-input');
  const text = (input?.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = '請先輸入備註內容'; return; }
  if (demoMode) { if (statusEl) statusEl.textContent = '（demo 模式）實際送出會寫入資料庫。'; return; }
  if (statusEl) statusEl.textContent = '送出中…';
  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'add_comment', caseId, commentText: text }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    input.value = '';
    if (statusEl) statusEl.textContent = '✅ 已送出，謝謝您的補充！';
    await loadClientMeetingNotes();
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ 送出失敗：' + err.message;
  }
}

async function submitClientNote() {
  const statusEl = $('#cmn-note-status');
  const input = $('#cmn-note-input');
  const text = (input?.value || '').trim();
  if (!text) { if (statusEl) statusEl.textContent = '請先輸入要補充的會議重點'; return; }
  if (demoMode) { if (statusEl) statusEl.textContent = '（demo 模式）實際送出會寫入會議紀錄。'; return; }
  if (statusEl) statusEl.textContent = '送出中…';
  try {
    const res = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'add_note', caseId, noteText: text, noteType: 'client' }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    input.value = '';
    if (statusEl) statusEl.textContent = '✅ 已補充到會議重點，謝謝！';
    await loadClientMeetingNotes();
  } catch (err) {
    if (statusEl) statusEl.textContent = '❌ 送出失敗：' + err.message;
  }
}

// === 載入並渲染 ===
async function init() {
  try {
    const [caseData, feelingsData] = await Promise.all([
      loadCase(),
      fetch('data/feelings.json').then(r => r.json()).catch(() => null),
    ]);
    const analysis = await loadAnalysis();
    const html = renderReport(caseData, analysis, feelingsData, version);
    $('#report-root').innerHTML = html;
    updateToggle();
    if (version !== 'designer') loadClientMeetingNotes();
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
