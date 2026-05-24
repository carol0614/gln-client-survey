# GLN 客戶問卷系統

> 客戶填寫家庭結構、生活習慣、風格偏好、設備需求、收納清單 → GAS 寫入 Google Sheet → 產出兩版報告（客戶版 + 設計師版）

**Schema 文件**：見上一層 `../客戶問卷_schema.md`

---

## 技術棧

- **前端**：純 HTML/CSS/JS（無框架），部署到 GitHub Pages
- **後端**：Google Apps Script Web App
- **儲存**：Google Sheet（既有檔 ID `1mgZlJJzzW7QtSBonBMzFfHNdtyDLHUWpOdS468mbG2U`）
- **品牌字典**：`1y9R0Hbij58vP7ni4mO_l0DUxW8kZQMe17Z0T8MHft8Q`（v2，設計師參考用，前端不依賴）
- **VI**：GLN 暖色系（`#7C837B` Olive Gray + Taupe Clay `#8E877D` + Soft Mist White `#E7E4DF`）
- **字體**：Noto Serif TC + Ibarra Real Nova

---

## 檔案結構

```
gln-client-survey/
├── README.md              ← 本檔
├── index.html             ← 客戶問卷主表單（5 段 + 設備 + 收納）
├── designer.html          ← 設計師補填頁
├── report.html            ← 兩版報告切換頁
├── styles.css             ← GLN VI 樣式
├── app.js                 ← 表單邏輯（動態家庭成員、進度條、自動存草稿）
├── data/
│   ├── areas.json         ← 12 區域 × 物品清單
│   └── brands.json        ← 品牌池（autocomplete 用，當前未啟用）
└── gas/
    └── Code.gs            ← Google Apps Script 後端
```

---

## 部署步驟（首次上線）

### 1. 建立 GitHub repo

```bash
# 本機 clone 路徑（沿用 AI 訓練營慣例）
cd ~/Documents/GitHub/
mkdir gln-client-survey && cd gln-client-survey

# 把 iCloud 內這個資料夾的檔案 cp 進來
cp -r "/Users/carol/Library/Mobile Documents/com~apple~CloudDocs/Claude-Code-Sync/Projects/02-GLN/客戶問卷系統/gln-client-survey/" .

git init
git add .
git commit -m "Initial: GLN client survey system"

# 在 GitHub 建 repo 後
git remote add origin git@github.com:carol0614/gln-client-survey.git
git branch -M main
git push -u origin main
```

### 2. 啟用 GitHub Pages

- Settings → Pages → Source: `main` branch, `/root`
- 取得 URL：`https://carol0614.github.io/gln-client-survey/`

### 3. 部署 Google Apps Script

1. 開 Google Sheet（既有客戶問卷檔）
2. 工具 → 指令碼編輯器
3. 把 `gas/Code.gs` 內容貼進去
4. 部署 → 新增部署 → 類型：**網頁應用程式**
5. 執行身分：**我**；存取權：**任何人**
6. 複製產生的 Web App URL
7. 把這個 URL 填到 `app.js` 的 `GAS_ENDPOINT` 常數

### 4. Apps Script Properties（設定密鑰）

指令碼編輯器 → 專案設定 → 指令碼屬性，新增：

| Key | Value |
|---|---|
| `SHEET_ID` | `1mgZlJJzzW7QtSBonBMzFfHNdtyDLHUWpOdS468mbG2U` |
| `NOTIFY_EMAILS` | `總監email,設計師email`（逗號分隔） |
| `TOKEN_SECRET` | （隨機 32 字元 hex，用於簽 token） |

---

## 開發本機預覽

```bash
cd gln-client-survey/
python3 -m http.server 8080
# 開 http://localhost:8080/?t=test_token
```

或直接用 Claude Preview MCP（這個專案符合 web 開發範圍）。

---

## URL 規則

| 角色 | URL 範本 | 用途 |
|---|---|---|
| 客戶填表 | `/?t=<client_token>` | 填 5 段問卷 + 設備 + 收納 |
| 客戶看報告 | `/report.html?id=<case_id>&v=client` | 一頁式回顧 |
| 設計師補填 | `/designer.html?t=<designer_token>` | 補品牌/型號/位置 |
| 設計師看報告 | `/report.html?id=<case_id>&v=designer` | 含後台備註 |
| 總監後台 | `/designer.html?t=<designer_token>&admin=1` | override 全欄位 |

---

## 待辦（上線前）

- [ ] 補完 `data/areas.json` 完整 310 物品清單
- [ ] GAS Notion API 接線（Carol 之後再啟用）
- [ ] 客戶版報告 PDF 匯出（v2 功能）
- [ ] mobile 響應式測試
- [ ] 客戶 token 過期機制（30 天）
