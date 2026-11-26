<p align="center">
  <img src="./assets/brand-mark.png" width="88" alt="Moorread">
</p>

<h1 align="center">書野 Moorread</h1>

<p align="center">打開新分頁，先看見今天真的會用到的網站。</p>

<p align="center">
  <a href="./README.en.md">English</a> ·
  <a href="https://falaisy.github.io/moorread/privacy/">隱私</a> ·
  <a href="./LICENSE">授權</a>
</p>

---

> **來源與致謝**
> 本專案是 [kiwiflydream/yunji-tab](https://github.com/kiwiflydream/yunji-tab)（MIT）的個人修改版，原作 © KIWI。謝謝原作者願意公開分享。原生書籤排序功能受 [Sortmark](https://chromewebstore.google.com/detail/sortmark/nmhnlemdhjjebiklhbjmpkiekgjjbnfc) 啟發，感謝作者提供這款工具與靈感。原始授權條款完整保留於 [LICENSE](./LICENSE)。

## 為什麼有這個版本

書籤存得越多，打開得越少。真要找一個網站，只記得它「好像存在過」。

Moorread 把新分頁當成那個資料夾的門口：常用的先出現，臨時存下的有地方暫放，累積很久的再慢慢補上描述、標籤與位置。它直接讀寫 Chrome 原生書籤，不匯入、不搬家；在這裡改名或搬移，書籤管理員也同步改變。

目前以不公開（Unlisted）方式上架，主要供自己安裝。沒有支援窗口，也不接受功能許願。

## 這個版本和上游的差別

介面與流程依個人習慣調整，預設語言為繁體中文（台灣）。文件與商店文案重新撰寫，不沿用上游的行銷文字。授權與致謝不變：MIT，原作 © KIWI，修改 © 2026 falaisy。

## 安裝

從原始碼建置：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

開啟 `chrome://extensions`，打開「開發者模式」，選擇「載入已解壓的擴充功能」，指向 `build/chrome-mv3-prod`。

## 日常使用

### 新分頁的兩種樣子

居中首頁只留必要的東西：時間、天氣、搜尋，以及最多十個置頂項目。書籤與書籤組可混排。

工作台版面把搜尋與時間天氣收進頂欄，其餘留給書籤。分類欄可固定或浮動，資料夾數量可顯示或隱藏。

### 找東西

搜尋同時比對名稱、網址、描述、標籤與資料夾路徑，支援模糊比對與中文拼音首字母。需要縮小範圍時，加上 `tag:`、`site:` 或 `folder:`；常查的組合可存成篩選。

同一個框可切到網頁模式，使用瀏覽器預設引擎，或 `g`、`b`、`ddg`、`gh` 關鍵詞。`Ctrl/Cmd + K` 叫出命令面板。

### 收藏與整理

- **收件匣**：先收藏，之後再逐筆決定資料夾與標籤；不確定可跳過。
- **書籤組**：把會一起打開的網站放在同組，可另取名字、換圖示、調順序；刪組不刪書籤。
- **批次管理**：一次搬移、開啟、刪除多筆，或批次補描述。
- **補充欄位**：描述、標籤、Emoji 或圖片圖示，以及多個備用 URL；開啟時自動選最快回應的入口。
- **規則整理**：依標題、網址、網域、描述或標籤比對，套用資料夾與標籤；按下套用才執行。
- **健康檢查**：列出重複、失效與重新導向的連結，不自動刪除。
- **垃圾桶與歷史**：刪除可立即復原，三十天內可找回；另有操作歷史與同步恢復點。
- **分頁工作階段**：最多五十組、每組一百個頁面，只存在本機。

### 備份與同步

| 方式 | 內容 |
| --- | --- |
| 瀏覽器同步 | 原生書籤由 Chrome 同步；描述、標籤、圖示、置頂與收件匣狀態透過同步儲存 |
| JSON | 補充資料與設定 |
| 完整快照 | 書籤樹、目錄層級、補充資料、書籤組、使用記錄與設定 |
| WebDAV | 完整快照上傳到自己的空間，保留多個版本，可選加密 |

書籤組使用獨立的同步儲存，不受同步欄位選擇與口令加密保護。還原完整快照前會先預覽；確認後書籤樹匯入新資料夾，既有書籤不受影響。

### 外觀與天氣

五種風格：晴空、簡潔、平衡、緊湊、柔和；六種配色：預設、晴空、石墨、草地、晨光、莓果，每種皆可切換淺色、深色或跟隨系統。

寬度、密度、圓角、圖示尺寸與顯示欄位皆可調整。時間與天氣可分開關閉，支援 12／24 小時制、攝氏／華氏與手動選城市，不讀取裝置位置。

### 選用的 AI 分類

填入 OpenAI 相容服務的 Base URL、Token 與模型，先產生分類預覽，確認後才移動書籤；可暫停、繼續或終止，二十四小時內可撤銷最近一次結果。Token 不寫入同步資料或備份。

## 隱私

沒有帳號，沒有分析追蹤。網站圖示按需向 Google Favicon 傳送網域。天氣、網頁資訊、健康檢查、AI 與 WebDAV 只在使用對應功能時連線。WebDAV 帳密與備份口令只留在本機。

完整說明見 [隱私政策](https://falaisy.github.io/moorread/privacy/)。

## 開發

Plasmo、React 19、TypeScript、Tailwind CSS、Zustand。需要 Node.js 22 以上與 pnpm 10.34.4。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

- `pnpm verify`：型別檢查、lint、單元測試
- `pnpm release`：建置並打包
- `pnpm docs:screenshots`：重拍文件截圖

其他文件：[備份與還原](./docs/zh-TW/backup.md)、[隱私與權限](./docs/zh-TW/privacy.md)、[開發指南](./docs/zh-TW/development.md)、[設計規範](./docs/zh-TW/design.md)。

## 授權

[MIT](./LICENSE)。原作 © KIWI；本版修改 © 2026 falaisy。原始授權條款完整保留。
