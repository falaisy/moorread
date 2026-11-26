# PRODUCT_SPEC.md — MoorRead（書野）產品規格

> 建立：2026-11-08。來源：`README.md`、`README.en.md`、`ARCHITECTURE.md`、`docs/zh-TW/*`、`docs/en/*`、現有程式碼。
> 標記規則：`[已實作]` 有程式證據；`[未驗證]` 尚無真實使用證據；`[未實作]` 明確缺功能。

## 1. 產品定位

Chrome 擴充功能（Manifest V3），把瀏覽器原生書籤變成可搜尋、可整理的新分頁工作臺。
主打「打開新分頁，先看見今天真的會用到的網站」，直接讀寫 Chrome 原生書籤，不匯入、不搬家。

- 品牌：書野 MoorRead（moor + read）。
- 來源：MIT fork 自 `kiwiflydream/yunji-tab`，原作 © KIWI；修改 © 2026 falaisy。
- 發行：Chrome Web Store 不公開（Unlisted），主要自用；商店連結 `https://chromewebstore.google.com/detail/eljjakdncoiphlbipgildicliklhmccl`。
- 主 repo：`falaisy/moorread`（public）；隱私政策網站：`https://falaisy.github.io/moorread/privacy/`（原始碼在本 repo 的 `docs/privacy/`）。

## 2. 目標使用者與使用情境

- 書籤很多、卻很少回頭打開的使用者。
- 需要「先收藏、之後再整理」的低摩擦流程。
- 想要新分頁同時是搜尋入口、常用網站面板與書籤整理工具。
- 目前唯一實際使用者＝產品決策者本人（自用版），因此**使用者實際操作感受即產品驗收標準**。

## 3. 核心功能（以現有程式碼為準）

### 3.1 新分頁與版面 `[已實作]`
- 入口：`src/newtab.tsx`（`chrome_url_overrides.newtab`）。
- 兩種首頁：居中首頁（時間、天氣、搜尋、最多十個置頂）、工作台版面。
- 分類欄位置：側欄（sidebar）或頂欄（top）；側欄可調寬（192–384px，預設 232px）與收合（56px）。
- 程式：`src/components/newtab/NewtabWorkspace.tsx`、`src/components/newtab/use-newtab-page.ts`、`src/lib/appearance.ts`。

### 3.2 搜尋 `[已實作]`
- 比對名稱、網址、描述、標籤、資料夾路徑；支援模糊比對與中文拼音首字母。
- 進階語法：`tag:`、`site:`、`folder:`；可存成篩選。
- 網頁模式使用瀏覽器預設搜尋引擎或 `g`／`b`／`ddg`／`gh` 關鍵詞。
- 程式：`src/lib/bookmark-search.ts`、`src/lib/search-engines.ts`、`src/components/SearchBar.tsx`。

### 3.3 收藏與整理 `[已實作]`
- 收件匣（Inbox）：先收藏，之後再決定資料夾與標籤。
- 書籤組：同組網站一起打開；可命名、換圖示、調順序；刪組不刪書籤。
- 批次管理：搬移、開啟、刪除、批次補描述。
- 補充欄位：描述、標籤、Emoji／圖片圖示、多個備用 URL（自動選最快入口）。
- 規則整理（auto-organize）：依標題／網址／網域／描述／標籤比對，套用資料夾與標籤；按下套用才執行；支援「儲存時自動套用」開關（預設開）。
- 健康檢查：重複、失效、重新導向連結；不自動刪除。
- 垃圾桶與歷史：刪除可復原，30 天內可找回；操作歷史與同步恢復點。
- 分頁工作階段：最多 50 組、每組 100 頁，只存在本機。
- 程式：`src/lib/bookmark-groups.ts`、`src/lib/auto-organize.ts`、`src/lib/bookmark-health.ts`、`src/lib/bookmark-deletion-safety.ts`、`src/lib/tab-sessions.ts`。

### 3.4 備份與同步 `[已實作]`／`[部分未驗證]`
| 方式 | 內容 | 狀態 |
|---|---|---|
| 瀏覽器同步 | 原生書籤由 Chrome 同步；描述、標籤、圖示、置頂、收件匣狀態走同步儲存 | 已實作 |
| JSON 備份 | 補充資料與設定 | 已實作；E2E 需真實環境 |
| 完整快照 | 書籤樹、目錄層級、補充資料、書籤組、使用記錄、設定 | 已實作 |
| WebDAV | 完整快照上傳、保留多版本、可選加密 | 已實作；真實 server E2E `NOT VERIFIED` |
| Gist 備份 | 透過 GitHub API | 已實作 |
| 跨裝置 metadata 同步 | 加密 metadata 文件 | 已實作；多裝置實測 `NOT VERIFIED` |
| Chrome 書籤回寫（Moorread → Chrome） | 一次性 export | 雙向自動同步 `[未實作]` |

### 3.5 外觀與天氣 `[已實作]`
- 5 種版面風格（晴空／簡潔／平衡／緊湊／柔和）、6 種配色（default／sky／graphite／meadow／dawn／berry）× 淺色／深色／跟隨系統。
- **待確認**：`COLOR_THEMES` 與 `colorThemeVars` 仍在 `src/lib/appearance.ts`，但現行「設定 → 書籤外觀／視覺」面板實測（Playwright 快照）未見獨立的「主題配色」選單；配色是否只能經版面風格連動，需產品確認後才可對外描述為可獨立選擇。
- 寬度、密度、圓角、圖示尺寸、顯示欄位可調；設定分頁實測為 11 個（一般／版面／書籤外觀／視覺／快速鍵／搜尋／內容補全／AI／資料與隱私／原生書籤／關於）。
- 時間與天氣可分開關閉；12／24 小時制、攝氏／華氏、手動選城市；不讀取裝置位置。
- 品牌色 `--brand`（sky 淺色）由 `221 87% 55%` 調為 `221 87% 50%`，使 `--background` 上文字對比由 4.2:1 提升至 5.0:1（axe color-contrast）。
- 視覺驗證 `[未驗證]`（本環境無 GUI 截圖）。

### 3.6 選用 AI 分類 `[已實作]`／`[未驗證]`
- 支援 OpenAI 相容服務（Base URL、Token、模型）。
- 先產生分類預覽，確認後才移動；可暫停／繼續／終止；24 小時內可撤銷最近一次。
- Token 不寫入同步資料或備份。
- 真實 API 端到端 `[未驗證]`（僅單元測試與 mock）。

### 3.7 命令面板與快速收藏 `[已實作]`
- 全域命令面板：任何網頁以快捷鍵開啟（iframe + `web_accessible_resources`），可搜尋、存本頁到指定組、切換預設組、回首頁。
- 快速收藏：`Alt+Shift+B`（Mac `Command+Shift+B`）與右鍵選單。
- 程式：`src/background.ts`、`src/tabs/global-command-palette.tsx`、`src/lib/global-command-palette.ts`。

## 4. 資料與隱私

- 無帳號、無分析追蹤。
- 網站圖示按需向 Google Favicon 傳送網域；天氣、網頁資訊、健康檢查、AI、WebDAV 只在對應功能使用時連線。
- WebDAV 帳密與備份口令只留本機。
- `chrome.storage` key 與 `navigator.locks` 名稱屬相容性邊界，**不得更名**（見 `ARCHITECTURE.md`）。

## 5. 非目標（現階段）

- 不做跨瀏覽器（Firefox／Safari）版本。
- 不做雲端帳號、社群、協作。
- 不自動刪除書籤（健康檢查只列出）。
- 不以大型新功能優先於 P0 穩定與第一版可用性。

## 6. 驗收標準（產品層，需使用者實際操作）

### 6.1 預設資料夾選單
- 使用者可在「設定 → 一般 → 預設資料夾」開啟樹狀選單並看到所有虛擬分類與資料夾。
- 選取後立即生效，關閉再開仍保留；新分頁預設分類正確。
- 使用者本人確認「可以正常選擇且不會跳回全部」。

### 6.2 側欄收合
- 收合後仍可辨識每個圖示（tooltip／aria-label）。
- 每個分類圖示可獨立點擊切換，不被外層容器攔截。
- 有明顯的展開按鈕可還原；重新載入後狀態保留。
- 使用者本人確認「收合後可以正常使用」。

### 6.3 第一版可用（Release Candidate）
- 真實 Chrome／Edge 載入 `build/chrome-mv3-prod/` 後：新分頁正常、收藏成功、重開瀏覽器資料仍在、備份可匯出／還原一次。
- 安裝包 SHA256 與 `CHANGELOG.md` 記載一致。

> 以上均為驗收的必要條件；工程測試通過不等於已驗收。

## 7. Roadmap（未來方向，尚未實作）

> 本章只記錄方向與前置規劃，不代表已排程或已實作。**0.1.12 仍只有 Chrome → MoorRead 單向同步**（原生書籤為來源，MoorRead 只讀取並建立自己的補充資料）。

### 7.1 Chrome ↔ MoorRead 雙向同步（未來產品方向）

使用者已確認：未來希望 MoorRead 的變更也能回寫 Chrome 書籤。此方向在實作前必須先完成下列規劃，缺一項都不應開始寫程式：

| 前置項目 | 必須先定義的內容 |
|---|---|
| 新增 | MoorRead 建立的書籤要寫入哪個 Chrome 資料夾；資料夾不存在時的處理。 |
| 修改 | 哪些欄位可回寫（標題、URL、所屬資料夾），哪些（標籤、描述、釘選、收件匣）只留在 MoorRead。 |
| 移動 | 虛擬分類與 Chrome 資料夾的對應；跨資料夾移動時的 id 穩定性。 |
| 刪除 | MoorRead 刪除（含垃圾桶 30 天保留）與 Chrome 端刪除的對應；是否刪除原生書籤需另外取得使用者明確同意。 |
| 衝突解決 | 兩端同時修改同一書籤時的優先規則，以及最後寫入時間的可靠來源。 |
| 循環防護 | 回寫觸發 `chrome.bookmarks.onChanged` 再次進入同步的回授迴圈防護（需來源標記或抑制窗口）。 |
| 重複資料防護 | 同一 URL 在兩端重複建立時的識別與合併規則。 |
| 多裝置同步一致性 | 多台裝置同時回寫同一 Chrome 同步帳號時的順序與收斂規則。 |

限制：在上述規則確定前，不得在 UI、商店文案或 `package.json` 宣稱已支援雙向同步；也不得提前實作部分回寫。

