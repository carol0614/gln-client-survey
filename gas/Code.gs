/**
 * GLN 客戶問卷系統 — Google Apps Script 後端
 *
 * 部署方式：
 * 1. 開啟 Google Sheet（ID 由 Script Properties 提供）
 * 2. 擴充功能 → Apps Script，把本檔貼上
 * 3. 部署 → 新增部署 → 類型：網頁應用程式
 *    執行身分：我；存取權：任何人
 * 4. 複製 Web App URL，填到前端 app.js 的 GAS_ENDPOINT
 *
 * 需設定的 Script Properties：
 *   SHEET_ID      → 主 Sheet ID
 *   NOTIFY_EMAILS → 通知 email（逗號分隔）
 *   TOKEN_SECRET  → 簽 token 用（隨機 32 字元）
 */

const SUBMISSIONS_SHEET = 'Submissions';
const TOKENS_SHEET = 'Tokens';

// === 入口：POST 收問卷 ===
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { token, timestamp, data } = payload;

    if (!validateToken(token)) {
      return jsonResponse({ ok: false, error: 'invalid_token' });
    }

    const caseId = generateCaseId();
    writeSubmission(caseId, token, timestamp, data);
    invalidateToken(token);
    sendNotifications(caseId, data);

    const baseUrl = ScriptApp.getService().getUrl().replace('/exec', '');
    const clientReportUrl = `${getReportBaseUrl()}/report.html?id=${caseId}&v=client`;
    const designerReportUrl = `${getReportBaseUrl()}/report.html?id=${caseId}&v=designer`;

    return jsonResponse({
      ok: true,
      caseId,
      clientReportUrl,
      designerReportUrl,
    });

  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: err.message });
  }
}

// === 入口：GET 查報告資料 ===
function doGet(e) {
  try {
    const caseId = e.parameter.id;
    const version = e.parameter.v || 'client'; // client | designer
    if (!caseId) return jsonResponse({ ok: false, error: 'missing_id' });

    const submission = findSubmissionByCaseId(caseId);
    if (!submission) return jsonResponse({ ok: false, error: 'not_found' });

    // 客戶版隱藏部分總監後台欄位（v1 簡化：全顯示）
    return jsonResponse({ ok: true, version, data: submission });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

// === Helper ===
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
// Tokens sheet schema: Token | CaseSeed | CreatedAt | UsedAt | DesignerToken
function generateTokenPair() {
  const ss = getSheet();
  const sh = getOrCreateSheet(TOKENS_SHEET, ['Token', 'CaseSeed', 'CreatedAt', 'UsedAt', 'DesignerToken']);
  const clientToken = randomHex(16);
  const designerToken = randomHex(16);
  const seed = randomHex(8);
  sh.appendRow([clientToken, seed, new Date().toISOString(), '', designerToken]);
  return { clientToken, designerToken };
}

function validateToken(token) {
  if (token === 'test') return true; // dev mode
  const sh = getOrCreateSheet(TOKENS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token && !rows[i][3]) return true; // unused client token
  }
  return false;
}

function invalidateToken(token) {
  if (token === 'test') return;
  const sh = getOrCreateSheet(TOKENS_SHEET);
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token) {
      sh.getRange(i + 1, 4).setValue(new Date().toISOString());
      return;
    }
  }
}

function randomHex(bytes) {
  const arr = [];
  for (let i = 0; i < bytes; i++) {
    arr.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return arr.join('');
}

// === Email 通知 ===
function sendNotifications(caseId, data) {
  const emails = (PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!emails.length) return;

  const subject = `[GLN] 新客戶問卷 — ${caseId}`;
  const body = `
新客戶問卷已提交：

案件編號：${caseId}
提交時間：${new Date().toLocaleString('zh-TW')}

主要資訊：
- 房屋形態：${data.house_type || '—'}
- 房屋坪數：${data.house_size || '—'}
- 預算範圍：${data.budget || '—'}
- 案子分類：${data.case_type || '—'}
- 為何找 GLN：${data.referral || '—'}

請至 Google Sheet 查看完整資料：
${SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl()}

— GLN 客戶問卷系統自動通知
`.trim();

  emails.forEach(to => {
    try {
      MailApp.sendEmail({ to, subject, body });
    } catch (e) {
      console.error('Mail to', to, 'failed:', e);
    }
  });
}

function getReportBaseUrl() {
  // 部署到 GitHub Pages 後填入
  return PropertiesService.getScriptProperties().getProperty('REPORT_BASE_URL') || '';
}

// === 管理員工具：手動產生新案件 token pair ===
// 在 Apps Script 編輯器執行 createNewCaseTokens() 即可印出兩個 token
function createNewCaseTokens() {
  const { clientToken, designerToken } = generateTokenPair();
  const baseUrl = getReportBaseUrl();
  Logger.log('Client URL: ' + baseUrl + '/?t=' + clientToken);
  Logger.log('Designer URL: ' + baseUrl + '/designer.html?t=' + designerToken);
  return { clientToken, designerToken };
}
