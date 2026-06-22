/**
 * GLN 客戶問卷系統 — Google Apps Script 後端（含 Claude API 自動分析）
 *
 * 部署方式：
 * 1. 開啟 Google Sheet（ID 由 Script Properties 提供）
 * 2. 擴充功能 → Apps Script，把本檔貼上
 * 3. 部署 → 新增部署 → 類型：網頁應用程式
 *    執行身分：我；存取權：任何人
 * 4. 複製 Web App URL，填到前端 app.js / report.js 的 GAS_ENDPOINT
 *
 * 需設定的 Script Properties（檔案 → 專案設定 → 指令碼屬性）：
 *   SHEET_ID            → 主 Sheet ID（必填）
 *   NOTIFY_EMAILS       → 通知 email（逗號分隔，必填）
 *   REPORT_BASE_URL     → GitHub Pages URL（部署後填，例 https://carol0614.github.io/gln-client-survey）
 *   ANTHROPIC_API_KEY   → Claude API key（自動 AI 分析必填，console.anthropic.com 取得）
 *   ANTHROPIC_MODEL     → 模型（預設 claude-sonnet-4-6；高品質改 claude-opus-4-6）
 *   KNOWLEDGE_BASE_URL  → 知識庫 JSON URL（建議 GitHub Pages 上的 data/knowledge-base.json）
 *   ANALYSIS_ENABLED    → 'true' 啟用自動分析，'false' 暫停（預設 true）
 *   FEELINGS_URL        → feelings.json URL（用於將感覺 key 翻譯成中文標籤）
 */

const SUBMISSIONS_SHEET = 'Submissions';
const TOKENS_SHEET = 'Tokens';
const ANALYSES_SHEET = 'Analyses';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// === 入口：POST 收問卷 ===
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    // 草稿同步路徑（不需 token 驗證，用 draftToken 自己識別）
    if (payload.action === 'save_draft') {
      return handleSaveDraft(payload);
    }

    // Admin：從丈量筆記自動產生客戶草稿連結
    if (payload.action === 'prefill_from_notes') {
      return handlePrefillFromNotes(payload);
    }

    // Admin：新增案件筆記
    if (payload.action === 'add_note') {
      return handleAddNote(payload);
    }

    // Admin：手動重跑 AI 分析（需要 adminKey；會再收一次 AI 費）
    if (payload.action === 'rerun_analysis') {
      const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
      if (payload.adminKey !== adminKey) return jsonResponse({ ok: false, error: 'unauthorized' });
      const caseId = (payload.caseId || '').trim();
      if (!caseId) return jsonResponse({ ok: false, error: 'missing_caseId' });
      try {
        const result = rerunAnalysis(caseId);
        return jsonResponse({ ok: true, caseId, analysisStatus: 'success', analysis: result });
      } catch (rerunErr) {
        console.error('Manual rerun failed for ' + caseId + ':', rerunErr);
        writeAnalysisRecord(caseId, null, 'failed', rerunErr.message);
        return jsonResponse({ ok: false, caseId, error: rerunErr.message });
      }
    }

    // Admin：產生新案件 Token（需要 adminKey 驗證）
    if (payload.action === 'create_token') {
      const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
      if (payload.adminKey !== adminKey) return jsonResponse({ ok: false, error: 'unauthorized' });
      const projectNumber = generateProjectNumber();
      const location = (payload.location || payload.note || '').trim();
      const brand = (payload.brand || 'GLN').toUpperCase();
      const note = projectNumber + (location ? ' ' + location : '');
      const prefill = payload.prefill || null;
      // 若有 prefill，將 brand 寫入草稿資料；空白流程則靠 Tokens 表的 Brand/Location 欄
      if (prefill) { prefill._brand = brand; }
      const { clientToken, designerToken } = generateTokenPair(projectNumber, prefill, brand, location);
      const baseUrl = getReportBaseUrl();
      return jsonResponse({
        ok: true,
        projectNumber,
        location,
        brand,
        note,
        clientToken,
        designerToken,
        clientUrl: baseUrl + '/?t=' + clientToken,
        designerReportUrl: baseUrl + '/report.html?v=designer',
      });
    }

    const { token, timestamp, data } = payload;

    if (!validateToken(token)) {
      return jsonResponse({ ok: false, error: 'invalid_token' });
    }

    // 檢查是否已有提交（修改重送）
    const existingCase = findCaseByToken(token);
    const caseId = existingCase ? existingCase.caseId : generateCaseId();
    const isResubmit = !!existingCase;

    // 提取上傳的參考圖（如有），存進 Drive 客戶資料夾，將 dataUrl 換成 Drive URL
    try {
      if (data._reference_photos) {
        const refPhotos = typeof data._reference_photos === 'string'
          ? JSON.parse(data._reference_photos)
          : data._reference_photos;
        if (Array.isArray(refPhotos) && refPhotos.length > 0) {
          const driveUrls = saveReferencePhotosToDrive(caseId, refPhotos);
          data._reference_photo_urls = driveUrls;
          data._reference_photos = `[已存進 Drive，共 ${refPhotos.length} 張]`;
        }
      }
    } catch (uploadErr) {
      console.error('Reference photo upload failed for ' + caseId + ':', uploadErr);
      data._reference_photo_upload_error = uploadErr.message;
    }

    if (isResubmit) {
      updateSubmission(existingCase.rowIndex, timestamp, data);
    } else {
      writeSubmission(caseId, token, timestamp, data);
      invalidateToken(token);
    }

    // 若有對應草稿，標記為已提交（不刪，留作 audit）
    if (payload.draftToken) {
      markDraftSubmitted(payload.draftToken);
    }

    // 注入 hub 當初存的品牌/地址（空白流程沒帶 _brand/_prefillLocation，靠 Tokens 表補上）
    const tokenInfo = getTokenInfo(token);
    if (tokenInfo) {
      if (!data._brand && tokenInfo.brand) data._brand = tokenInfo.brand;
      if (tokenInfo.location) data._tokenLocation = tokenInfo.location;
    }

    sendNotifications(caseId, data);

    // 自動觸發 AI 分析（同步、可能 10-30 秒）
    // 規則：一個案子只自動跑一次。已有成功分析（含重送 / 重複提交）→ 跳過，
    // 之後若要再分析，請在後台「案件列表」按手動重跑（rerun_analysis）。
    let analysisResult = null;
    let analysisStatus;
    const analysisEnabled = (PropertiesService.getScriptProperties().getProperty('ANALYSIS_ENABLED') || 'true') === 'true';
    const existingAnalysis = findAnalysisByCaseId(caseId);
    if (!analysisEnabled) {
      analysisStatus = 'skipped';
    } else if (existingAnalysis) {
      // 已分析過 → 不重跑、不收費；保留既有結果
      analysisResult = existingAnalysis;
      analysisStatus = 'already_analyzed';
    } else {
      try {
        analysisResult = runClaudeAnalysis(caseId, data);
        analysisStatus = 'success';
      } catch (analysisErr) {
        console.error('Analysis failed for ' + caseId + ':', analysisErr);
        writeAnalysisRecord(caseId, null, 'failed', analysisErr.message);
        analysisStatus = 'failed';
      }
    }

    const reportBase = getReportBaseUrl();
    const clientReportUrl = `${reportBase}/report.html?id=${caseId}&v=client`;
    const designerReportUrl = `${reportBase}/report.html?id=${caseId}&v=designer`;

    return jsonResponse({
      ok: true,
      caseId,
      clientReportUrl,
      designerReportUrl,
      analysisStatus,
    });

  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: err.message });
  }
}

// === 入口：GET 查報告資料（含 AI 分析）===

// ============================================================
// === 預填資料：從 Tokens sheet 讀取 admin 預填的客戶基本資料 ===
// ============================================================
function handleGetPrefill(token) {
  if (!token || token === 'test') return jsonResponse({ ok: true, prefill: null });
  try {
    const sh = getOrCreateSheet(TOKENS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === token) {
        const prefillJson = rows[i][6] || '';
        const prefill = prefillJson ? JSON.parse(prefillJson) : null;
        // 若 token 已使用（曾送出），也回傳已提交的完整答案供修改
        const isUsed = !!rows[i][3];
        let submittedData = null;
        if (isUsed) {
          const sub = findSubmissionByToken(token);
          if (sub) submittedData = sub.data;
        }
        return jsonResponse({ ok: true, prefill, submittedData, isResubmit: isUsed });
      }
    }
    return jsonResponse({ ok: true, prefill: null });
  } catch (e) {
    return jsonResponse({ ok: false, error: e.message });
  }
}

function doGet(e) {
  try {
    // 草稿載入路徑
    if (e.parameter.action === 'load_draft') {
      return handleLoadDraft(e.parameter.t);
    }
    // 預填資料載入
    if (e.parameter.action === 'get_prefill') {
      return handleGetPrefill(e.parameter.t);
    }
    // 後台案件列表
    if (e.parameter.action === 'list_cases') {
      return handleListCases(e.parameter.admin_token);
    }
    // 後台案件筆記列表
    if (e.parameter.action === 'get_notes') {
      return handleGetNotes(e.parameter.case_id, e.parameter.admin_token);
    }

    const caseId = e.parameter.id;
    const version = e.parameter.v || 'client'; // client | designer
    if (!caseId) return jsonResponse({ ok: false, error: 'missing_id' });

    const submission = findSubmissionByCaseId(caseId);
    if (!submission) return jsonResponse({ ok: false, error: 'not_found' });

    const response = { ok: true, version, data: submission };

    // 設計師版額外回傳分析結果
    if (version === 'designer') {
      const analysis = findAnalysisByCaseId(caseId);
      if (analysis) response.analysis = analysis;
    }

    return jsonResponse(response);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function handleListCases(adminToken) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
  if (adminToken !== expected) return jsonResponse({ ok: false, error: 'unauthorized' });

  const subSh = getOrCreateSheet(SUBMISSIONS_SHEET, ['CaseID', 'Timestamp', 'Token', 'DataJSON']);
  const subRows = subSh.getDataRange().getValues();

  const anaSh = getOrCreateSheet(ANALYSES_SHEET, ['CaseID', 'GeneratedAt', 'Status', 'Model', 'InputTokens', 'OutputTokens', 'AnalysisJSON', 'Error']);
  const anaRows = anaSh.getDataRange().getValues();

  const anaMap = {};
  for (let i = 1; i < anaRows.length; i++) {
    const id = anaRows[i][0];
    if (!anaMap[id]) anaMap[id] = anaRows[i][2];
  }

  const baseUrl = getReportBaseUrl();
  const cases = [];
  for (let i = 1; i < subRows.length; i++) {
    const row = subRows[i];
    const caseId = row[0];
    if (!caseId) continue;
    let clientName = '';
    try {
      const data = JSON.parse(row[3]);
      // 抓預填的客戶姓名，或第一位成員身份
      clientName = data.client_name || data['member-1_role'] || '';
      if (data['member-1_occupation']) clientName += (clientName ? '・' : '') + data['member-1_occupation'];
    } catch (e) {}
    cases.push({
      caseId,
      timestamp: row[1] ? new Date(row[1]).toLocaleString('zh-TW') : '',
      clientName,
      analysisStatus: anaMap[caseId] || 'none',
      designerReportUrl: baseUrl + '/report.html?id=' + caseId + '&v=designer',
      clientReportUrl: baseUrl + '/report.html?id=' + caseId + '&v=client',
    });
  }
  cases.reverse();
  return jsonResponse({ ok: true, cases });
}

// ============================================================
// === Claude API 整合：自動隱性需求分析 ===
// ============================================================

/**
 * 跑 Claude 分析，回傳結構化 JSON
 * 失敗會 throw error（呼叫端要包 try/catch）
 */
function runClaudeAnalysis(caseId, data) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set in Script Properties');
  }

  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || DEFAULT_MODEL;
  const knowledgeBase = fetchKnowledgeBase(); // 可能為 null
  const feelingsMap = fetchFeelingsMap();      // key → 中文 label

  // 把感覺光譜的 key 翻譯成中文，幫 Claude 理解
  const dataForPrompt = enrichDataWithFeelingLabels(data, feelingsMap);

  const systemPrompt = buildSystemPrompt(knowledgeBase);
  const userPrompt = buildUserPrompt(caseId, dataForPrompt);

  const body = {
    model,
    max_tokens: 8192,  // 提高，避免長分析被截斷導致 JSON parse 失敗
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ],
  };

  const response = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  const respText = response.getContentText();
  if (status !== 200) {
    // 401 = API key 無效，402 = 餘額不足 → 寄警告信給 Carol
    if (status === 401 || status === 402) {
      const alertMsg = status === 401
        ? '⚠️ Anthropic API Key 無效或已過期，請到 console.anthropic.com 確認。'
        : '⚠️ Anthropic 帳戶餘額不足，AI 分析已停止，請儘快至 console.anthropic.com 儲值。';
      try {
        const notifyEmails = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || '';
        if (notifyEmails) {
          MailApp.sendEmail(notifyEmails.split(',')[0].trim(), '[GLN] AI 分析停止警告', alertMsg + '\n\n案件：' + caseId);
        }
      } catch (mailErr) { /* ignore */ }
    }
    throw new Error('Anthropic API ' + status + ': ' + respText.substring(0, 500));
  }

  const respJson = JSON.parse(respText);
  const text = (respJson.content && respJson.content[0] && respJson.content[0].text) || '';

  // 模型輸出可能包 ```json ... ``` 標籤，先剝除
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  let analysis;
  try {
    analysis = JSON.parse(cleaned);
  } catch (parseErr) {
    throw new Error('Model returned non-JSON output: ' + cleaned.substring(0, 500));
  }

  // 補充 metadata
  analysis._meta = analysis._meta || {};
  analysis._meta.case_id = caseId;
  analysis._meta.generated_at = new Date().toISOString();
  analysis._meta.generated_by = 'Claude API (' + model + ') + GLN 機能設計知識庫';
  analysis._meta.model = model;
  analysis._meta.usage = respJson.usage || null;

  writeAnalysisRecord(caseId, analysis, 'success', '');
  return analysis;
}

function buildSystemPrompt(knowledgeBase) {
  let kbSection = '';
  if (knowledgeBase) {
    kbSection = `

你可使用以下 GLN 機能設計知識庫做交叉比對（每條知識有 id、problem、applies_to、severity、solution）：

\`\`\`json
${JSON.stringify(knowledgeBase).substring(0, 12000)}
\`\`\`

引用知識時把 id（如 K-02、L-04）填入 knowledge_refs 欄位。
`;
  }

  return `你是 GLN 好感生活提案（Good Living Notes）室內設計公司的資深設計總監。
你的工作是從客戶問卷資料中，識別客戶「沒明說但顯然需要」的隱性需求，並將所有設計建議依預算可行性分級。

分析原則：
1. 用 McKinsey #問對問題框架（Goal → Obstacle → Strategic Recommendation → KPI）
2. 識別「客戶沒說、但設計師專業上知道必須處理」的需求
3. 識別「客戶自述風格 vs 實際感覺光譜」的矛盾點
4. 識別「客戶現有條件可以額外發揮」的機會點
5. 給每個洞察一個明確的設計回應（不只是診斷）
6. 嚴格輸出 JSON，不要其他文字

**絕對禁止（違反這些規則 = 輸出無效）：**
7. 禁止結構不可行建議：中段樓層住宅不能「開天井」「開採光罩」；不要建議任何需要建築師執照的結構變更（移柱、打掉承重牆等）；所有設計回應必須在室內裝修許可（非建照）範圍內可執行。
8. 設計回應必須具體且可落地：不要寫「可以考慮」「建議討論」等模糊語，要寫實際設計動作（「將廚房動線改為 L 型」「在鞋櫃旁增設 60cm 寬穿鞋椅」）。

**結構性不可建議清單（出現 = 自動判定 Level C）：**
- 開天井（非頂樓住宅）
- 拆除或移動承重牆/承重柱
- 樓板開洞/樓板穿孔
- 增建違建（頂樓加蓋、陽台外推等）
- 變更建築外觀（外牆材質變更、加設採光罩需建照）
- 新增或移動電梯
- 結構性挑高（拆除夾層樓板）
- 任何需要「建造執照」而非「室內裝修許可」的工程

═══════════════════════════════════════════
📊 GLN 預算護欄系統 v1.0（2026-05）
═══════════════════════════════════════════

**案型參數（影響每坪單價）：**
| 案型 | 倍率 | 預算結構（基礎/裝修/設計監管稅） |
|------|------|-------------------------------|
| 新成屋/預售客變 | ×0.80 | 基礎 20% / 裝修 75% / 其餘 5% |
| 中古屋 5-25 年 | ×0.90 | 基礎 45% / 裝修 40% / 其餘 15% |
| 老屋 25+ 年（大樓） | ×1.10 | 基礎 60% / 裝修 30% / 其餘 10% |
| 透天 5-25 年 | ×1.15 | 基礎 50% / 裝修 35% / 其餘 15% |
| 透天老屋 25+ 年 | ×1.20 | 基礎 60% / 裝修 25% / 其餘 15% |

**每坪基準價：7 萬/坪**（乘以上表倍率 × 風格倍率 × 區域加成）

**風格倍率：** 簡約 ×0.85 / 局部設計感 ×1.15 / 強調精緻 ×1.30

**你必須執行的預算計算（讀取客戶的案型、坪數、風格、預算後）：**
1. 粗估工程總預算 = 坪數 × 7萬 × 案型倍率 × 風格倍率
2. 可用基礎工程預算 = 粗估總預算 × 基礎工程%
3. 可用裝修工程預算 = 粗估總預算 × 裝修工程%
4. 若客戶有填期待預算，以「客戶期待預算 vs 粗估預算」取較低者為預算上限
5. 每個設計建議必須評估是否在可用預算內

**天書基準價參考表（已驗證的 50 項單價，單位：新台幣元）：**

假設工程：大門保護 3,400/式、室內保護 8,000/式、磁磚保護 6,000/式、臨時給水 5,500/式、臨時馬桶 5,500/式
拆除工程：清運 56,000/式
泥作工程：砌半B磚牆 7,000/坪、粗胚打底 4,000/坪、人造石門檻 3,800/支、地坪打底 40,000/式、壁癌處理 85,313/式
水電工程：總開關箱 11,500/式、專用迴路110V 3,350/迴、專用迴路220V 4,700/迴、插座110V 850/處、網路點 100,000/式、電視點 2,500/處、單切開關 1,100/迴、雙切開關 2,200/迴、燈具出線 850/口、冷水主管 15,000/式、冷水支管 1,700/口、熱水主管 23,500/式、熱水支管 2,700/口、臨時水 8,000/式
木作工程：平釘天花 4,250/坪、造型天花 6,500/坪、包樑 800/尺、窗簾盒 430/尺、單面隔間 2,560/尺、雙面隔間 2,560/尺、冷氣出風口 600/尺、房門 21,500/樘、浴室門 22,000/樘、隱藏門 34,800/樘
系統櫃：安裝工資 4,000/式
油漆工程：舊牆上漆 1,250/坪、新水泥牆上漆 2,000/坪、新木作牆上漆 1,875/坪、平頂天花上漆 3,000/坪、立體天花上漆 3,000/坪、司曼特藝術漆 7,500/坪、室外漆 3,750/坪、未改色修補 39,635/式、矽利康收邊 21,000/式
玻璃工程：矽利康施打 36,030/式、安裝工資 8,000/式
空調工程：室內外機 25,800/臺
清潔工程：全室清潔 27,500/式、廢棄物清運 12,500/式

**空白工種（無天書基準價，建議涉及時標註「⚠️ 需設計師現場估價」）：**
化糞池、防水、地坪、隔間、鐵件、鋁門窗、磁磚材料、打除、窗簾、石材

**加項固定單價（params.json v3.3）：**
- 冷氣：(房數+1) × 4.5萬/台
- 廚房翻新（屋齡≥15年）：2房 27萬 / 3房 35萬 / 4房 45萬
- 衛浴翻新（屋齡≥15年）：翻新 15萬/間、新增 25萬/間
- 窗戶：一般窗 0.8萬/扇、落地窗 3.5萬/扇
- 監工費 10%、稅金 5%

═══════════════════════════════════════════
📋 設計建議分級規則（Level A / B / C）
═══════════════════════════════════════════

每個設計建議（design_response）必須標註 feasibility_level：

**Level A — 預算內可行：**
- 該建議所涉及的工種/項目，在計算出的可用預算內可執行
- 或屬於設計手法調整（動線重新規劃、開放式廚房、收納優化等），不需額外大筆費用
- 客戶報告只顯示這一級

**Level B — 超預算但技術可行：**
- 該建議需要追加預算才能實現
- 必須標註 budget_note 說明超出原因和概略差額範圍（用天書基準價推算）
- 只在設計師報告顯示

**Level C — 不建議：**
- 結構不可行（在不可建議清單上）
- 法規限制（需建照、違反消防法規等）
- 技術上在該屋況下不可能
- 必須標註 rejection_reason
- 只在設計師報告顯示，作為「已排除」的決策紀錄

特別注意以下資料欄位（容易被忽略，但對設計判斷影響大）：
- **寵物資料**（data 內以 pet-N_ 為 prefix）：體型影響走道/門寬、活動區域影響地板材質、
  飲食/如廁位置影響水點/通風規劃、掉毛/抓咬狀況影響沙發/牆面材質選擇
- **客戶上傳的參考圖 URLs**（data._reference_photo_urls）：客戶心中真正的家，
  如果與自述風格不一致，是重要矛盾訊號（contradictions）
- **10 個材質喜好評分**（material_wood/metal/stone/glass/leather/fabric/rattan/concrete/tile/plaster）
  高分（4-5）= 偏好；低分（1-2）= 排斥，建議避開
- **痛點 19 項分 4 群**（環境/空間/品質/族群），勾選多者代表問題嚴重${kbSection}

輸出 JSON schema（嚴格遵守）：
{
  "summary": "string，案件 1 段話總結（200 字內）",
  "budget_context": {
    "estimated_total_10k": "number，粗估工程總預算（萬）",
    "available_foundation_10k": "number，可用基礎工程預算（萬）",
    "available_renovation_10k": "number，可用裝修工程預算（萬）",
    "client_budget_10k": "number|null，客戶期待預算（萬），未填則 null",
    "effective_budget_10k": "number，實際採用的預算上限（萬）= min(粗估, 客戶期待)",
    "calculation_note": "string，計算過程簡述（案型×坪數×風格=多少）"
  },
  "space_personality": {
    "archetype_name": "從感覺光譜 Top 3 交叉分析出的空間人格名稱（例：溫柔的生活守護者）",
    "cross_analysis": "string，150-250 字，結合 Top 3 感覺的心理側寫，第二人稱「你」，溫暖且有洞察力，說明這個客戶對生活和空間的直覺是什麼。不要提及設計師，只聚焦在「你是怎樣的人」。",
    "feeling_contradictions": [
      {
        "feeling_a": "感覺 A 標籤",
        "feeling_b": "感覺 B 標籤",
        "insight": "這兩個感覺同時出現說明了什麼，以及設計上如何兼顧",
        "client_version": "給客戶看的正向框架版本（「你的品味有層次…」）",
        "design_strategy": "給設計師的具體策略（主調/點綴建議）"
      }
    ]
  },
  "implicit_needs": [
    {
      "id": "IN-01",
      "title": "🔴/🟠/🟡 + 一句話標題",
      "signals": ["客戶答案中觀察到的訊號（可多條）"],
      "inference": "推論的隱性需求，為什麼客戶沒說但需要",
      "design_response": [
        {
          "action": "具體設計動作",
          "feasibility_level": "A|B|C",
          "budget_note": "Level B 時必填：超出原因和概略差額",
          "rejection_reason": "Level C 時必填：為什麼不建議",
          "requires_site_survey": false,
          "blank_trade_warning": "若涉及空白工種（無天書基準價），填工種名稱，否則 null"
        }
      ],
      "knowledge_refs": ["K-02", "L-04"],
      "priority": "P0|P1|P2"
    }
  ],
  "contradictions": [
    {
      "id": "CONT-01",
      "title": "矛盾點標題",
      "description": "問題描述",
      "resolution": "建議解法",
      "knowledge_refs": []
    }
  ],
  "opportunities": [
    {
      "id": "OPP-01",
      "title": "✨ 機會點標題",
      "description": "為什麼是機會",
      "design_response": {
        "action": "如何把握",
        "feasibility_level": "A|B|C",
        "budget_note": "Level B 時必填",
        "rejection_reason": "Level C 時必填",
        "blank_trade_warning": null
      }
    }
  ]
}

目標：
- budget_context 必填（讀取客戶案型/坪數/風格後計算）
- space_personality 必填（依感覺光譜 Top 3 分析）
- 5-8 個 implicit_needs，每個 design_response 都必須標註 feasibility_level
- contradictions 含感覺光譜矛盾（CONT 系列）和行為矛盾
- feeling_contradictions 只填感覺軸向有衝突時（如溫潤×靜謐）
- 2-4 個 opportunities，每個 design_response 都必須標註 feasibility_level
- Level A 建議應佔多數（≥60%），Level C 應極少（結構不可行才標）
- 涉及空白工種的建議，blank_trade_warning 必填工種名稱
`;
}

function buildUserPrompt(caseId, data) {
  return `案件編號：${caseId}

請分析以下客戶問卷資料，輸出嚴格符合 schema 的 JSON（不要包 markdown code block，直接純 JSON）：

\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\``;
}

/**
 * 把 _feeling_spectrum 中的 key 轉成中文 label，避免 Claude 看到 'warm' 不知道是什麼
 */
function enrichDataWithFeelingLabels(data, feelingsMap) {
  if (!feelingsMap || !data._feeling_spectrum) return data;
  const clone = JSON.parse(JSON.stringify(data));
  try {
    const spectrum = typeof clone._feeling_spectrum === 'string'
      ? JSON.parse(clone._feeling_spectrum) : clone._feeling_spectrum;
    if (Array.isArray(spectrum)) {
      clone._feeling_spectrum_readable = spectrum.map(s => ({
        感覺: feelingsMap[s.key] || s.label || s.key,
        百分比: s.pct + '%',
        喜歡張數: s.liked + '/' + s.total,
      }));
    }
  } catch (e) { /* ignore */ }
  return clone;
}

function fetchKnowledgeBase() {
  const url = PropertiesService.getScriptProperties().getProperty('KNOWLEDGE_BASE_URL');
  if (!url) return null;
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (e) {
    console.warn('fetchKnowledgeBase failed:', e);
    return null;
  }
}

function fetchFeelingsMap() {
  const url = PropertiesService.getScriptProperties().getProperty('FEELINGS_URL');
  if (!url) return {};
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return {};
    const data = JSON.parse(res.getContentText());
    const map = {};
    (data.feelings || []).forEach(f => { map[f.key] = f.label; });
    return map;
  } catch (e) { return {}; }
}

// ============================================================
// === Analyses Sheet：分析結果儲存 ===
// ============================================================

function writeAnalysisRecord(caseId, analysisJson, status, errorMsg) {
  const sh = getOrCreateSheet(ANALYSES_SHEET, ['CaseID', 'GeneratedAt', 'Status', 'Model', 'InputTokens', 'OutputTokens', 'AnalysisJSON', 'Error']);
  const usage = analysisJson && analysisJson._meta && analysisJson._meta.usage;
  sh.appendRow([
    caseId,
    new Date().toISOString(),
    status,
    (analysisJson && analysisJson._meta && analysisJson._meta.model) || '',
    usage ? usage.input_tokens : '',
    usage ? usage.output_tokens : '',
    analysisJson ? JSON.stringify(analysisJson) : '',
    errorMsg || '',
  ]);
}

function findAnalysisByCaseId(caseId) {
  const sh = getOrCreateSheet(ANALYSES_SHEET, ['CaseID', 'GeneratedAt', 'Status', 'Model', 'InputTokens', 'OutputTokens', 'AnalysisJSON', 'Error']);
  const rows = sh.getDataRange().getValues();
  // 從後往前找最新一筆 success
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][0] === caseId && rows[i][2] === 'success' && rows[i][6]) {
      try {
        return JSON.parse(rows[i][6]);
      } catch (e) { return null; }
    }
  }
  return null;
}

// === 手動重跑分析（在 Apps Script 編輯器執行）===
function rerunAnalysis(caseId) {
  const sub = findSubmissionByCaseId(caseId);
  if (!sub) throw new Error('Case not found: ' + caseId);
  const result = runClaudeAnalysis(caseId, sub.data);
  Logger.log('Analysis done for ' + caseId);
  return result;
}

// === 跑最新一個 case 的分析（測試用）===
function rerunLatestAnalysis() {
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET);
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) throw new Error('No submissions');
  const latest = rows[rows.length - 1];
  return rerunAnalysis(latest[0]);
}

// === 估算 API 成本（給 Carol 參考）===
function estimateMonthlyCost(casesPerMonth) {
  // Sonnet 4.6: input $3/M, output $15/M
  // 估每案 input 6000 tokens, output 3000 tokens
  const inputCost = (casesPerMonth * 6000 / 1000000) * 3;
  const outputCost = (casesPerMonth * 3000 / 1000000) * 15;
  const totalUSD = inputCost + outputCost;
  Logger.log('估每月 ' + casesPerMonth + ' 案 ≈ $' + totalUSD.toFixed(2) + ' USD（NT$ ' + (totalUSD * 31).toFixed(0) + '）');
  return totalUSD;
}

// ============================================================
// === Helper ===
// ============================================================
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('SHEET_ID not set');
  return SpreadsheetApp.openById(sheetId);
}

function getOrCreateSheet(name, headers) {
  const ss = getSheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) sh.appendRow(headers);
  }
  return sh;
}

function generateCaseId() {
  const now = new Date();
  const yyyymm = Utilities.formatDate(now, 'Asia/Taipei', 'yyyyMM');
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET, ['CaseID', 'Timestamp', 'Token', 'DataJSON']);
  const existing = sh.getDataRange().getValues().slice(1).filter(r => r[0].startsWith(`GLN-${yyyymm}`)).length;
  const seq = String(existing + 1).padStart(3, '0');
  return `GLN-${yyyymm}-${seq}`;
}

function writeSubmission(caseId, token, timestamp, data) {
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET, ['CaseID', 'Timestamp', 'Token', 'DataJSON']);
  sh.appendRow([caseId, timestamp, token, JSON.stringify(data)]);
}

function findSubmissionByCaseId(caseId) {
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === caseId) {
      return {
        caseId: rows[i][0],
        timestamp: rows[i][1],
        data: JSON.parse(rows[i][3] || '{}'),
      };
    }
  }
  return null;
}

// === Token 機制（每案一組）===
function generateTokenPair(projectNumber, prefill, brand, location) {
  const sh = getOrCreateSheet(TOKENS_SHEET, ['Token', 'CaseSeed', 'CreatedAt', 'UsedAt', 'DesignerToken', 'ProjectNumber', 'Prefill', 'ClientName', 'Brand', 'Location']);
  const clientToken = randomHex(16);
  const designerToken = randomHex(16);
  const prefillJson = prefill ? JSON.stringify(prefill) : '';
  const clientName = prefill ? (prefill.client_name || '') : '';
  // 第 9、10 欄存 hub 輸入的品牌與地址，讓空白表單流程送出時也能正確分流通知
  sh.appendRow([clientToken, projectNumber || randomHex(8), new Date().toISOString(), '', designerToken, projectNumber || '', prefillJson, clientName, (brand || 'GLN'), (location || '')]);
  return { clientToken, designerToken };
}

// 以 clientToken 讀回 hub 當初存的品牌與地址（給 sendNotifications 分流用）
function getTokenInfo(token) {
  if (!token || token === 'test') return null;
  const sh = getOrCreateSheet(TOKENS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token) {
      return { brand: (rows[i][8] || '').toString(), location: (rows[i][9] || '').toString() };
    }
  }
  return null;
}

// 自動遞增案件編號：YYYY-NNN（每年從 001 重算）
function generateProjectNumber() {
  const year = new Date().getFullYear();
  const sh = getOrCreateSheet(TOKENS_SHEET, ['Token', 'CaseSeed', 'CreatedAt', 'UsedAt', 'DesignerToken', 'ProjectNumber']);
  const rows = sh.getDataRange().getValues().slice(1);
  const count = rows.filter(r => {
    if (!r[2]) return false;
    const d = (r[2] instanceof Date) ? r[2] : new Date(r[2]);
    return !isNaN(d) && d.getFullYear() === year;
  }).length;
  return year + '-' + String(count + 1).padStart(3, '0');
}

function validateToken(token) {
  if (token === 'test') return true;
  const sh = getOrCreateSheet(TOKENS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token) return true; // 允許已使用的 token 重新送出（修改功能）
  }
  return false;
}

function invalidateToken(token) {
  // 僅在第一次送出時記錄 UsedAt，不阻止重複送出
  if (token === 'test') return;
  const sh = getOrCreateSheet(TOKENS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token && !rows[i][3]) { // 只在尚未記錄時才寫
      sh.getRange(i + 1, 4).setValue(new Date().toISOString());
      return;
    }
  }
}

// 以 token 查找已提交的案件
function findCaseByToken(token) {
  if (!token || token === 'test') return null;
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === token) {
      return { rowIndex: i + 1, caseId: rows[i][0] };
    }
  }
  return null;
}

// 以 token 查找已提交的案件資料
function findSubmissionByToken(token) {
  if (!token || token === 'test') return null;
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === token) {
      return {
        caseId: rows[i][0],
        timestamp: rows[i][1],
        data: JSON.parse(rows[i][3] || '{}'),
      };
    }
  }
  return null;
}

// 更新已存在的提交（客戶修改後重送）
function updateSubmission(rowIndex, timestamp, data) {
  const sh = getOrCreateSheet(SUBMISSIONS_SHEET);
  sh.getRange(rowIndex, 2).setValue(timestamp);
  sh.getRange(rowIndex, 4).setValue(JSON.stringify(data));
}

function randomHex(bytes) {
  const arr = [];
  for (let i = 0; i < bytes; i++) {
    arr.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return arr.join('');
}

// === Email 通知 ===
/**
 * 依地址區域 + 品牌分流通知。
 *
 * 固定收到（全區）：
 *   carol@goodlivingnotes.com
 *   hankchen@goodlivingnotes.com
 *
 * 南區（高雄/台南/屏東/嘉義/雲林/澎湖）：
 *   george@goodlivingnotes.com
 *
 * 中區 + 北區（台北/新北/基隆/桃園/新竹/苗栗/台中/彰化/南投/宜蘭/花蓮/台東/嘉義縣市（非南區）等）：
 *   jacklin@goodlivingnotes.com
 *
 * GLV 品牌（全屋訂製系統櫃）：
 *   wayne@goodlivingnotes.com
 */
function sendNotifications(caseId, data) {
  const location = (data._prefillLocation || data._tokenLocation || data.house_location || '').toLowerCase();
  const brand    = (data._brand || '').toUpperCase();

  // 固定通知
  const recipients = new Set(['carol@goodlivingnotes.com', 'hankchen@goodlivingnotes.com']);

  // 南區關鍵字
  const southKeywords = ['高雄', '台南', '臺南', '屏東', '嘉義', '雲林', '澎湖'];
  if (southKeywords.some(k => location.includes(k))) {
    recipients.add('george@goodlivingnotes.com');
  }

  // 中北區（非南區）
  const northCentralKeywords = [
    '台北', '臺北', '新北', '基隆', '桃園', '新竹', '苗栗',
    '台中', '臺中', '彰化', '南投', '宜蘭', '花蓮', '台東', '臺東', '連江', '金門'
  ];
  if (northCentralKeywords.some(k => location.includes(k))) {
    recipients.add('jacklin@goodlivingnotes.com');
  }

  // GLV 品牌
  if (brand === 'GLV') {
    recipients.add('wayne@goodlivingnotes.com');
  }

  const brandLabel = brand === 'GLV' ? 'GLV（全屋訂製）' : 'GLN（好感生活提案）';
  const subject = `[${brand || 'GLN'}] 新客戶問卷 — ${caseId}`;
  const body = `
新客戶問卷已提交：

案件編號：${caseId}
品牌：${brandLabel}
提交時間：${new Date().toLocaleString('zh-TW')}

主要資訊：
- 房屋形態：${data.house_type || '—'}
- 房屋坪數：${data.house_size || '—'}
- 預算範圍：${data.budget || '—'}
- 案子分類：${data.case_type || '—'}
- 為何找我們：${data.referral || '—'}

請至 Google Sheet 查看完整資料：
${SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl()}

設計師版報告（含 AI 分析）：
${getReportBaseUrl()}/report.html?id=${caseId}&v=designer

— GLN 客戶問卷系統自動通知
`.trim();

  recipients.forEach(to => {
    try {
      MailApp.sendEmail({ to, subject, body });
    } catch (e) {
      console.error('Mail to', to, 'failed:', e);
    }
  });
}

function getReportBaseUrl() {
  return PropertiesService.getScriptProperties().getProperty('REPORT_BASE_URL') || '';
}

// ============================================================
// === 一次性初始化（首次部署跑這個就好）===
// 在 Apps Script 編輯器選 init → 執行 → 授權
// ============================================================
function init() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    SHEET_ID: '1yNZnmfzB5gxQpANj-pmfbdkiuGceK3FhuOUsyjGiUZ0',
    NOTIFY_EMAILS: 'carol@goodlivingnotes.com',
    ANALYSIS_ENABLED: 'false',  // 預設關閉 AI 分析；加 API key 後改 true
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    KNOWLEDGE_BASE_URL: 'https://carol0614.github.io/gln-client-survey/data/knowledge-base.json',
    FEELINGS_URL: 'https://carol0614.github.io/gln-client-survey/data/feelings.json',
    REPORT_BASE_URL: 'https://carol0614.github.io/gln-client-survey',
    // ANTHROPIC_API_KEY: 'sk-ant-api03-...',  // 想啟用 AI 分析時手動加
  });
  Logger.log('✅ Properties 已設定完成。目前值：');
  const current = props.getProperties();
  Object.keys(current).sort().forEach(k => {
    const v = current[k];
    const display = v.length > 60 ? v.substring(0, 60) + '...' : v;
    Logger.log('  ' + k + ' = ' + display);
  });
  Logger.log('');
  Logger.log('下一步：右上角「部署 → 新增部署 → 網頁應用程式」');
  Logger.log('  執行身分：我 / 存取權限：任何人');
}

// ============================================================
// === 雲端草稿同步（跨裝置續填）===
// ============================================================

const DRAFTS_SHEET = 'Drafts';

function handleSaveDraft(payload) {
  const { draftToken, originalToken, email, data } = payload;
  if (!draftToken) return jsonResponse({ ok: false, error: 'missing_draft_token' });

  const sh = getOrCreateSheet(DRAFTS_SHEET,
    ['DraftToken', 'OriginalToken', 'Email', 'CreatedAt', 'UpdatedAt', 'DataJSON', 'Status']);
  const rows = sh.getDataRange().getValues();
  const now = new Date().toISOString();

  // 找既有 row
  let rowIdx = -1;
  let existingEmail = '';
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === draftToken) {
      rowIdx = i + 1; // Sheet 1-indexed
      existingEmail = rows[i][2];
      break;
    }
  }

  if (rowIdx > 0) {
    // Update updatedAt + data
    sh.getRange(rowIdx, 5).setValue(now);
    sh.getRange(rowIdx, 6).setValue(JSON.stringify(data || {}));
    if (email && email !== existingEmail) {
      sh.getRange(rowIdx, 3).setValue(email);
    }
  } else {
    sh.appendRow([
      draftToken,
      originalToken || '',
      email || '',
      now,
      now,
      JSON.stringify(data || {}),
      'active'
    ]);
  }

  // 有給 email 就寄（重複按也會重寄，方便使用者；GAS quota 每日 100 封應該夠）
  let emailSent = false;
  let emailError = null;
  if (email) {
    try {
      sendDraftLinkEmail(email, draftToken);
      emailSent = true;
    } catch (mailErr) {
      console.error('Draft email failed:', mailErr);
      emailError = String(mailErr.message || mailErr);
    }
  }

  return jsonResponse({ ok: true, draftToken, emailSent, emailError });
}

function handleLoadDraft(draftToken) {
  if (!draftToken) return jsonResponse({ ok: false, error: 'missing_token' });
  const sh = getOrCreateSheet(DRAFTS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === draftToken && rows[i][6] !== 'submitted') {
      try {
        return jsonResponse({ ok: true, data: JSON.parse(rows[i][5] || '{}') });
      } catch (e) {
        return jsonResponse({ ok: false, error: 'parse_failed' });
      }
    }
  }
  return jsonResponse({ ok: false, error: 'not_found' });
}

function markDraftSubmitted(draftToken) {
  if (!draftToken) return;
  try {
    const sh = getOrCreateSheet(DRAFTS_SHEET);
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === draftToken) {
        sh.getRange(i + 1, 7).setValue('submitted');
        return;
      }
    }
  } catch (e) {
    console.warn('markDraftSubmitted failed', e);
  }
}

// 診斷工具：測試寄信到指定 email（模擬「保存進度」的完整路徑）
// 用法：在 Apps Script 編輯器把 TO_EMAIL 換成客戶 email → 執行
function testSaveDraftEmailTo() {
  const TO_EMAIL = 'carol@goodlivingnotes.com'; // ← 改成要測試的 email
  const testToken = 'test-' + Date.now().toString(36);
  Logger.log('=== 測試寄信到: ' + TO_EMAIL + ' ===');
  Logger.log('Draft token: ' + testToken);
  Logger.log('MailApp 每日剩餘配額: ' + MailApp.getRemainingDailyQuota());
  try {
    sendDraftLinkEmail(TO_EMAIL, testToken);
    Logger.log('✅ 寄出成功！請到 ' + TO_EMAIL + ' 收件匣（含垃圾信件夾）確認');
  } catch (e) {
    Logger.log('❌ 寄出失敗: ' + e.message);
    Logger.log('完整錯誤: ' + (e.stack || ''));
  }
}

// 診斷工具：手動跑這個確認 MailApp 能否寄信
function testEmailSending() {
  const myEmail = Session.getActiveUser().getEmail();
  Logger.log('=== Email 診斷 ===');
  Logger.log('目前帳號: ' + myEmail);
  Logger.log('Gmail 每日剩餘配額: ' + MailApp.getRemainingDailyQuota());
  Logger.log('');
  Logger.log('=== 試寄信給自己 ===');
  try {
    MailApp.sendEmail(myEmail, '[GLN 測試] Draft email 診斷', '這是測試信。如果你收到代表 MailApp 沒問題。');
    Logger.log('✅ 寄出成功，請檢查 ' + myEmail + ' 的收件匣（含垃圾信箱）');
  } catch (e) {
    Logger.log('❌ 寄出失敗: ' + e.message);
    Logger.log('完整錯誤: ' + e.stack);
  }
}

function sendDraftLinkEmail(email, draftToken) {
  const base = getReportBaseUrl();
  const link = `${base}/?d=${draftToken}`;
  const subject = '[GLN] 你的生活習慣討論表 — 草稿連結';
  const body = `感謝你開始填寫 GLN 生活習慣討論表。

你目前的進度已存進雲端。可在任何裝置（手機、平板、電腦）開啟以下連結繼續填寫：

${link}

填寫完成後，按頁面底部的「送出問卷」即可。

連結請妥善保管。在未送出前可重複使用，不會過期。

GLN 設計團隊敬上
Good Living Notes`;
  MailApp.sendEmail(email, subject, body);
}

// === 客戶上傳參考圖：存進 Drive 「GLN_生活習慣整理表_客戶上傳/{caseId}/」===
const REFERENCE_ROOT_FOLDER = 'GLN_生活習慣整理表_客戶上傳';

function saveReferencePhotosToDrive(caseId, photos) {
  const rootFolder = getOrCreateFolder(REFERENCE_ROOT_FOLDER);
  const caseFolder = getOrCreateChildFolder(rootFolder, caseId);
  const urls = [];

  photos.forEach((p, idx) => {
    if (!p.dataUrl) return;
    const base64 = p.dataUrl.split(',')[1];
    if (!base64) return;

    const mimeType = p.mimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1] || 'jpg';
    const safeName = (p.name || `reference-${idx + 1}`).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');
    const filename = `${String(idx + 1).padStart(2, '0')}-${safeName}.${ext}`;

    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, filename);
    const file = caseFolder.createFile(blob);
    urls.push({
      name: filename,
      url: file.getUrl(),
      id: file.getId(),
    });
  });

  return urls;
}

function getOrCreateFolder(name) {
  const it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function getOrCreateChildFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// === 清測試資料（執行一次就好；刪所有 token='test' 的 row + 對應 Analyses）===
function cleanTestData() {
  const ss = getSheet();
  const subSh = ss.getSheetByName(SUBMISSIONS_SHEET);
  const anaSh = ss.getSheetByName(ANALYSES_SHEET);
  const tokSh = ss.getSheetByName(TOKENS_SHEET);

  let deletedSub = 0, deletedAna = 0, deletedTok = 0;
  const testCaseIds = new Set();

  // 1. 從 Submissions 找出 token='test' 的 CaseID（從後往前刪）
  if (subSh) {
    const rows = subSh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][2] === 'test') {
        testCaseIds.add(rows[i][0]);
        subSh.deleteRow(i + 1);
        deletedSub++;
      }
    }
  }

  // 2. 從 Analyses 刪除對應 CaseID
  if (anaSh && testCaseIds.size > 0) {
    const rows = anaSh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (testCaseIds.has(rows[i][0])) {
        anaSh.deleteRow(i + 1);
        deletedAna++;
      }
    }
  }

  // 3. 從 Tokens 刪除 'test' 紀錄（若有）
  if (tokSh) {
    const rows = tokSh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0] === 'test') {
        tokSh.deleteRow(i + 1);
        deletedTok++;
      }
    }
  }

  Logger.log('✅ 清理完成');
  Logger.log('  Submissions 刪 ' + deletedSub + ' 列');
  Logger.log('  Analyses 刪 ' + deletedAna + ' 列');
  Logger.log('  Tokens 刪 ' + deletedTok + ' 列（test token 紀錄）');
  Logger.log('  刪除的 CaseID: ' + Array.from(testCaseIds).join(', '));
  return { deletedSub, deletedAna, deletedTok };
}

// === 診斷：檢查 API key 設定狀態（不會把 key 暴露在 log）===
function debugApiKey() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('=== Script Properties 清單 ===');
  Object.keys(props).sort().forEach(k => {
    const v = props[k];
    if (k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')) {
      Logger.log('  ' + k + ' = ' + v.substring(0, 12) + '...' + v.substring(v.length - 4) + ' (長度 ' + v.length + ')');
    } else {
      Logger.log('  ' + k + ' = ' + v);
    }
  });

  const key = props.ANTHROPIC_API_KEY;
  if (!key) {
    Logger.log('❌ ANTHROPIC_API_KEY 不存在！屬性名稱可能拼錯。');
    return;
  }
  Logger.log('');
  Logger.log('=== Key 健康檢查 ===');
  Logger.log('開頭: ' + key.substring(0, 12));
  Logger.log('結尾: ' + key.substring(key.length - 4));
  Logger.log('長度: ' + key.length + ' (正常應為 ~108)');
  Logger.log('開頭正確 (sk-ant-)? ' + key.startsWith('sk-ant-'));
  Logger.log('有開頭空格? ' + (key !== key.trimStart()));
  Logger.log('有結尾空格? ' + (key !== key.trimEnd()));
  Logger.log('有換行字元? ' + /[\r\n]/.test(key));

  Logger.log('');
  Logger.log('=== 實測呼叫 Anthropic API ===');
  try {
    const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Say hi in 3 words.' }]
      }),
      muteHttpExceptions: true,
    });
    const status = res.getResponseCode();
    const body = res.getContentText().substring(0, 300);
    Logger.log('HTTP ' + status);
    Logger.log('回應: ' + body);
    if (status === 200) Logger.log('✅ Key 有效！');
    else Logger.log('❌ Key 無效。對照錯誤訊息修正。');
  } catch (e) {
    Logger.log('呼叫失敗: ' + e.message);
  }
}

// === 管理員工具：手動產生新案件 token pair ===
function createNewCaseTokens() {
  const { clientToken, designerToken } = generateTokenPair();
  const baseUrl = getReportBaseUrl();
  Logger.log('Client URL: ' + baseUrl + '/?t=' + clientToken);
  Logger.log('Designer URL: ' + baseUrl + '/designer.html?t=' + designerToken);
  return { clientToken, designerToken };
}

// ============================================================
// === 代填模式：從丈量筆記自動產生客戶草稿連結 ===
// ============================================================

/**
 * 接收丈量筆記文字，用 Claude API 解析成表單欄位，
 * 自動建立 token + 草稿，回傳客戶可直接開啟補充的連結。
 *
 * Payload:
 *   action    : 'prefill_from_notes'
 *   adminKey  : string（同 create_token 的 adminKey）
 *   notes     : string（丈量筆記全文）
 *   location  : string（案件地址/簡稱，例 "屏東市明中新村"）
 */
function handlePrefillFromNotes(payload) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
  if (payload.adminKey !== adminKey) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  const notes = (payload.notes || '').trim();
  const location = (payload.location || '').trim();
  const brand = (payload.brand || 'GLN').toUpperCase();
  if (!notes) return jsonResponse({ ok: false, error: 'missing_notes' });

  // 用 Claude API 把筆記解析成表單 JSON
  let prefillData;
  try {
    prefillData = extractFormDataFromNotes(notes, location);
  } catch (err) {
    return jsonResponse({ ok: false, error: 'claude_parse_failed', detail: err.message });
  }

  // 產生案件 token
  const projectNumber = generateProjectNumber();
  const { clientToken, designerToken } = generateTokenPair(projectNumber, null, brand, location);

  // 產生 draftToken
  const draftToken = 'prefill-' + randomHex(12);

  // 手填欄位蓋過 AI 解析結果（有填的優先）
  const override = payload.prefillOverride || {};
  Object.keys(override).forEach(k => { if (override[k]) prefillData[k] = override[k]; });

  // 補充 admin 標記
  prefillData._adminPrefill = true;
  prefillData._adminNote = '由 GLN 設計師根據丈量會談筆記預填。請確認標有「＊」的欄位，並補充其餘空白項目。';
  prefillData._prefillLocation = location;
  prefillData._prefillProjectNumber = projectNumber;
  prefillData._brand = brand;

  // 儲存草稿
  handleSaveDraft({
    draftToken,
    originalToken: clientToken,
    data: prefillData,
  });

  const baseUrl = getReportBaseUrl();
  return jsonResponse({
    ok: true,
    projectNumber,
    location,
    draftToken,
    clientToken,
    designerToken,
    clientUrl: baseUrl + '/?d=' + draftToken,
    designerReportUrl: baseUrl + '/report.html?v=designer',
  });
}

/**
 * 呼叫 Claude API，從丈量筆記中提取表單欄位 JSON
 */
function extractFormDataFromNotes(notes, location) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || DEFAULT_MODEL;

  const systemPrompt = `你是 GLN 好感室內設計公司的助理，負責從設計師的丈量筆記中提取結構化資料，填入客戶生活習慣問卷的對應欄位。

輸出格式：嚴格的 JSON 物件，只包含能從筆記中確認的欄位，無法確認的欄位不要輸出（讓客戶自填）。

可填欄位清單（只填能從筆記中確認的）：
- house_type: "老屋" | "中古屋" | "新成屋" | "透天" | "透天老屋"
- case_type: "老屋翻新" | "全室翻新" | "局部翻新" | "新成屋裝修"
- house_location: 地址或地區
- house_use: "自住" | "出租" | "自住兼出租"
- floor_plan: 樓層配置描述
- _memberCount: 人數（數字）
- member-N_role: 第 N 位成員稱謂（如 "王先生", "梁小姐"）
- member-N_main_need: 第 N 位成員主要需求
- _petCount: 寵物數量
- pet-N_role: 第 N 隻寵物種類（如 "狗（拉布拉多）", "貓", "鸚鵡"）
- pet-N_weight: 體重（如 "15kg"）
- pet-N_note: 寵物特殊需求說明
- wishlist: 心願清單（從筆記中整理出客戶明確說想要的東西）
- pain_points: 陣列，從 ["採光不足","動線不順","收納不夠","潮濕","噪音","老舊設備","格局不佳","空間太小"] 中選
- renovation_reason: 改造原因（一句話）
- designer_notes: 設計師備註（把整理好的丈量重點放這裡，逐樓層條列）

回應只輸出 JSON，不要其他文字。`;

  const userPrompt = `地址：${location || '未提供'}

丈量筆記：
${notes}`;

  const body = {
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  const response = UrlFetchApp.fetch(ANTHROPIC_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error('Anthropic API ' + status + ': ' + response.getContentText().substring(0, 300));
  }

  const respJson = JSON.parse(response.getContentText());
  const text = (respJson.content && respJson.content[0] && respJson.content[0].text) || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Claude 回傳非 JSON：' + cleaned.substring(0, 300));
  }
}

// ============================================================
// 案件筆記系統
// Sheet: Notes  欄位: CaseId | Timestamp | NoteText | ParsedFields(JSON)
// ============================================================

const NOTES_SHEET = 'Notes';

function getOrCreateNotesSheet() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  let sheet = ss.getSheetByName(NOTES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(NOTES_SHEET);
    sheet.appendRow(['CaseId', 'Timestamp', 'NoteText', 'ParsedFields']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 新增筆記到指定案件，並用 AI 重新解析所有筆記回傳更新的 prefill
 * Payload: { action, adminKey, caseId, noteText }
 */
function handleAddNote(payload) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
  if (payload.adminKey !== adminKey) return jsonResponse({ ok: false, error: 'unauthorized' });
  const caseId = (payload.caseId || '').trim();
  const noteText = (payload.noteText || '').trim();
  if (!caseId || !noteText) return jsonResponse({ ok: false, error: 'missing_params' });

  const sheet = getOrCreateNotesSheet();
  const ts = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

  // AI 解析這筆筆記
  let parsedJson = '{}';
  try {
    const parsed = extractFormDataFromNotes(noteText, caseId);
    parsedJson = JSON.stringify(parsed);
  } catch (e) { /* 解析失敗也繼續存筆記 */ }

  sheet.appendRow([caseId, ts, noteText, parsedJson]);

  // 取得此案件全部筆記，合併 AI 解析結果
  const allNotes = getNotesForCase(sheet, caseId);
  const mergedPrefill = mergeNoteParsedFields(allNotes);

  return jsonResponse({ ok: true, caseId, timestamp: ts, mergedPrefill, totalNotes: allNotes.length });
}

/**
 * 取得指定案件的所有筆記
 */
function handleGetNotes(caseId, adminToken) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || 'gln-admin-2026';
  if (adminToken !== adminKey) return jsonResponse({ ok: false, error: 'unauthorized' });
  if (!caseId) return jsonResponse({ ok: false, error: 'missing_case_id' });

  const sheet = getOrCreateNotesSheet();
  const notes = getNotesForCase(sheet, caseId);
  return jsonResponse({ ok: true, caseId, notes });
}

function getNotesForCase(sheet, caseId) {
  const data = sheet.getDataRange().getValues();
  const notes = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === caseId) {
      notes.push({ timestamp: data[i][1], noteText: data[i][2], parsedFields: data[i][3] });
    }
  }
  return notes;
}

function mergeNoteParsedFields(notes) {
  const merged = {};
  notes.forEach(n => {
    try {
      const p = JSON.parse(n.parsedFields || '{}');
      Object.keys(p).forEach(k => { if (p[k] && !merged[k]) merged[k] = p[k]; });
    } catch (e) {}
  });
  return merged;
}
