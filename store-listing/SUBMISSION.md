# 書野 Moorread 上架資料（Chrome Web Store 不公開項目）

更新：2026-10-27

## 要上傳的檔案

| 用途 | 檔案 |
| --- | --- |
| 擴充功能套件 | 以 `pnpm package` 產生的 0.1.12 套件 |
| 商店截圖（1280×800，5 張） | `screenshots-1280x800\` |
| 隱私權政策 | `privacy-policy.html`（已放上公開 HTTPS） |

截圖順序：1 總覽 → 2 搜尋 → 3 書籤組 → 4 批次管理 → 5 工作台。

## 一、後台操作順序

1. 開啟 <https://chrome.google.com/webstore/devconsole>，用已付費的開發者帳號登入。
2. 按「新增項目」，上傳 0.1.12 套件（`pnpm package` 產生）。
3. 填「商店資訊」：名稱、摘要、詳細說明、類別、語言、截圖。
4. 填「隱私權」：單一用途、權限理由、資料使用聲明、隱私權政策網址。
5. 發布地區選「所有地區」。
6. 可見性選 **不公開（Unlisted）**。
7. 提交審核。

> **Unlisted 的意義**：只有拿到項目連結的人能安裝；搜尋不到，但不需要 Google Workspace。真正的「Private」只限同網域 Workspace 使用者，不符合需求。

## 二、商店資訊

名稱：

```
書野 Moorread
```

英文 listing 名稱：

```
Moorread
```

摘要（繁體中文，132 字元內）：

```
把 Chrome 書籤放回每天都會經過的地方：搜尋、收藏、整理與備份，都在同一頁完成。
```

English 摘要：

```
Put Chrome bookmarks back where you pass every day: search, save, sort and back up from one new tab.
```

- 類別：生產力工具（Productivity）
- 預設語言：中文（繁體）
- English listing 為選填

**詳細說明**：完整中英文文案見 [`../docs/store-description.md`](../docs/store-description.md)，直接複製即可。

## 三、單一用途說明

```
在新分頁呈現 Chrome 既有書籤，並提供搜尋、分類、編輯、群組、原生書籤排序（受 Sortmark 啟發）、備份與還原。
```

## 四、權限理由

| 權限 | 填寫內容 |
| --- | --- |
| `storage` | 保存介面偏好、補充欄位、書籤組、垃圾桶與同步資料。 |
| `bookmarks` | 讀取與修改 Chrome 書籤及資料夾，這是主要功能。 |
| `tabs` | 還原分頁工作階段，開啟書籤時切換或建立分頁。 |
| `activeTab` | 只在你按下收藏時讀取目前頁面的標題與網址。 |
| `scripting` | 只在你啟用全域命令面板後，於目前頁面顯示面板。 |
| `contextMenus` | 提供「收藏此頁」右鍵選單。 |
| `favicon` | 透過瀏覽器內建介面取得網站圖示。 |
| `search` | 切換網頁搜尋時使用瀏覽器預設引擎。 |
| `https://www.google.com/*`、`https://*.gstatic.com/*` | 取得 Google Favicon 服務回傳的圖示。 |
| `http://*/*`、`https://*/*`（選用） | 只在你主動抓描述、檢查連結、執行 AI 分類，或連 WebDAV／GitHub Gist（含測試連線、讀取遠端列表與還原）時使用；可隨時撤銷。首次傳輸前需明確同意，上傳與讀取分開授權。 |
| 遠端程式碼 | 沒有，程式全部在套件內。 |

## 五、資料使用聲明

- 勾選**網站內容**：書籤的標題、網址、描述與標籤，只在你主動執行 AI 分類時，傳送到你自行設定的 OpenAI 相容服務。
- 勾選**網路記錄**：書籤網域可能傳送到 Google Favicon 以取得圖示。
- 不勾選廣告、出售資料、信用評估。
- 勾選「遵守 Limited Use 規範」。

說明欄：

```
資料只用於書籤顯示與整理。開發者不收集、不販售任何使用者資料，也沒有伺服器。書籤網域僅在取得圖示時送往 Google Favicon；AI 分類只送往使用者自行設定的服務；WebDAV 只送往使用者自行設定的位址；GitHub Gist 只送往 api.github.com。Gist 與 WebDAV 的上傳、測試連線、讀取遠端列表與還原，都需在首次傳輸前明確同意，且上傳與讀取分開授權，可隨時撤回；撤回後不再有任何自發傳輸。
```

## 六、隱私權政策網址

<https://falaisy.github.io/moorread-privacy/>（原始碼：<https://github.com/falaisy/moorread-privacy>，僅含 `index.html`）。

## 七、送出後

1. 審核期間項目為「待審核」，通常數個工作天。
2. 通過後在後台複製項目連結（`https://chromewebstore.google.com/detail/...`）。
3. 每台裝置用同一 Google 帳號開啟該連結安裝；擴充功能 ID 固定，`chrome.storage.sync` 才會互通。
4. 改版：後台「套件」上傳新 zip → 提交審核；已安裝的使用者會自動更新。

## 八、合規檢查（2026-10-25）

### 已通過

- **zip 結構**：`manifest.json` 位於根目錄，無 `./` 前綴、無反斜線路徑；已放入 `LICENSE`。
- **授權**：MIT 允許修改與再發布；保留原始 `LICENSE`（© KIWI），README 與「關於」頁標註來源。
- **文案原創**：商店說明、README 與文件不再逐句沿用上游，功能事實相同、敘述重寫。
- **遠端程式碼**：沒有，所有 JS 都在套件內。
- **品牌一致性**：建置產物與 7 個語系皆為「書野 Moorread」，無舊品牌殘留。
- **截圖**：由實際建置重新擷取，非合成或舊版畫面。
- **敏感檔案**：套件內無 `.env`、Token、私鑰或 source map。
- **權限**：皆對應單一用途；網站存取為選用權限，使用時才請求。
- **資料處理**：無開發者伺服器、無分析；AI、WebDAV、天氣、Favicon 皆由使用者主動觸發。

### 提交前必須完成

1. ~~把 `privacy-policy.html` 放到公開 HTTPS 網址~~ 已完成。
2. 後台資料使用表要與隱私政策一致（網站內容、網路記錄、Limited Use）。
3. 開發者身分選「非交易者（Non-trader）」。
4. 名稱不加「for Chrome」「Chrome 擴充」等字樣。

### 風險提示：名稱

2026-10-24 以網頁搜尋檢查「書野 / Moorread」，未發現同名商業產品或公司，也沒有同類書籤工具的 Chrome 擴充功能。它是自造複合字（book + mead），撞名機率低，但不代表商標資料庫一定沒有衝突；若要長期公開發布，上架前建議自行到 TIPO／USPTO 檢索。這一點無法代替律師做商標檢索。

### 其他可選項

- 商店「宣傳圖塊」440×280 為選填，目前未製作。
- 相依套件多為 MIT／ISC；若要更嚴謹，可再加一份 `THIRD_PARTY_NOTICES.txt`，不是上架必要條件。
