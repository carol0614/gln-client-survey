# GLN 客戶生活習慣討論表

> 好感生活提案（Good Living Notes）客戶問卷系統 — 收集客戶生活習慣、家庭結構、感覺光譜偏好，產出兩版報告（客戶確認版 + 設計師深度版，含 AI 隱性需求分析）。

## 📋 系統組成

| 頁面 | 用途 |
|---|---|
| `index.html` | 客戶填寫問卷（5 大區塊 + 設備品牌 + 收納清單 + 感覺光譜左右滑）|
| `designer.html` | 設計師補填頁（補品牌、型號、配電位置）|
| `report.html` | 兩版報告（client / designer toggle）|
| `admin.html` | 照片管理工具（管理員專用，掃描照片 + 標感覺 tag + 匯出 photos.json）|

## 🎯 核心特色

- **感覺光譜系統**：15 個感覺維度 × 65 張參考照片，Tinder 左右滑 UX，自動計算個人感覺偏好光譜（圓餅圖 + 長條圖）
- **AI 隱性需求分析**：交叉比對客戶問卷 + GLN 機能設計知識庫 V3（58 條），自動識別客戶未明說的設計需求、矛盾點、機會點
- **GLN VI**：Wabi-Sabi 暖色系（Olive Gray + Taupe Clay + Soft Mist White）+ Noto Serif TC

## 🚫 訪問控制

- **noindex meta + robots.txt**：阻擋搜尋引擎索引
- **Token 機制**：客戶需要專屬連結（`?t=XXX`）才能填寫
- **內部分享用**：不公開推廣，僅 GLN 內部與授權客戶使用

## 📦 部署

### 本機開發
```bash
npx http-server -p 8770 -c-1
# 開 http://localhost:8770/?t=test
```

### GitHub Pages
推到 `main` 分支根目錄即自動部署，URL：
`https://carol0614.github.io/gln-client-survey/?t=test`

### GAS 後端
詳見 `../DEPLOY-GAS.md`。

## ⚖️ 著作權

`assets/photos/` 內的參考照片來自 Pinterest 等公開圖庫，僅作 GLN 內部設計研究與客戶溝通使用。如有版權方來信，立即下架替換。

## 🛠 技術棧

純 HTML/CSS/JS（無框架）+ Google Apps Script + Anthropic Claude API。

## 📐 完整規格

詳見上層目錄的 `客戶問卷_schema.md` 與 `STATUS.md`。
