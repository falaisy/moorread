# 開發指南

[English](./development.en.md) · [返回 README](../README.md)

書野 Moorread 以 Plasmo 開發，建置與測試的目標是 Chrome Manifest V3。這份文件從第一次跑起來開始，再談測試、打包與幾個容易踩到的實作細節。

## 環境

- Node.js 22 以上
- pnpm 10.34.4
- Chrome 或 Chromium

```bash
corepack enable
pnpm install --frozen-lockfile
```

## 第一次跑起來

```bash
pnpm dev
```

執行後，到 `chrome://extensions` 開啟「開發者模式」，選「載入已解壓的擴充功能」，指向 `build/chrome-mv3-dev/`。Plasmo 會監看原始碼，重新建置並重新載入擴充功能。

請使用獨立的瀏覽器設定與示例書籤。擴充功能直接管理原生書籤，測試新增、搬移或刪除時，瀏覽器裡的真實資料也會跟著改變。

## 建置與打包

```bash
pnpm build
pnpm package
```

`pnpm build` 產生 `build/chrome-mv3-prod/`，可載入該目錄驗證生產版本。`pnpm package` 產生 ZIP。

本版的 `pnpm release` 會依序建置、把 `LICENSE` 複製進產物、再打包，避免上架包漏掉授權。沒有對外 Releases，安裝包只在需要時本機產生。

Chrome 是主要驗證目標；其他 Chromium 瀏覽器沒有獨立相容性保證，Firefox 與 Safari 也沒有正式流程。

## 驗證改動

```bash
pnpm typecheck
pnpm lint
pnpm test

# 第一次跑端到端測試前，先安裝 Chromium
pnpm exec playwright install chromium
pnpm test:e2e
```

端到端測試會建置並載入真實擴充功能，涵蓋書籤管理、書籤組、鍵盤導航、主題、設定重置、WebDAV 備份與還原、AI 分類、網站圖示、記憶體與無障礙檢查。功能改動應跑對應測試；提交前跑完上述檢查。

## 國際化

介面支援 `zh-TW` 與 `en`。

執行時文案集中在 `src/lib/i18n.ts` 與 `src/lib/i18n-*.ts`。元件透過 `useI18n()` 取得 `t` 與當前 `language`，訊息鍵由 `MessageKey` 約束。`locales/` 只存擴充功能名稱、描述與瀏覽器快捷鍵等後設資料，不代替執行時詞典。

新增使用者可見文案時，兩種語言要一次補齊，包括錯誤、狀態、佔位提示、確認操作與 `aria-label`。各語言保留相同的插值參數名稱；日期與數字依當前介面語言格式化。使用者自己填的書籤標題與目錄名保持原樣。WebDAV 的設定、同步記錄、加密與還原提示在 `src/lib/i18n-webdav.ts`。

先跑相關檢查，再走「驗證改動」：

```bash
pnpm exec vitest run src/lib/i18n.test.ts src/lib/i18n-hardcoded.test.ts
pnpm typecheck
```

國際化測試校驗插值參數一致性；AST 檢查防止中文文案直接寫進元件與業務程式碼。這些檢查不代替譯文審閱與介面驗證；改動較長的文案後，還要看窄屏換行、按鈕與彈窗版面。

## 實作備註

### 時間與天氣

設定記在同步的 `headerWidget` 欄位裡。舊版資料交給 `normalizeHeaderWidget` 補上預設值；備份與一般設定重置都會帶到它。

天氣只使用手選城市的座標；城市搜尋時申請 Open-Meteo 兩個網域的可選存取權限。結果在 local 快取 15 分鐘。元件關閉或解除安裝時，清理計時器並取消進行中的請求。驗證見 `e2e/header-widget.spec.ts` 與 `src/lib/weather.test.ts`。

### 外觀預設

首次安裝與缺少外觀設定時，使用完整的晴空預設（`DEFAULT_APPEARANCE_SETTINGS`）；平衡風格使用 `BALANCED_APPEARANCE_SETTINGS`，讓預設風格的變動不影響既有設定。

首頁版面存在 `appearance.homeLayout`：沒有外觀設定時為 `centered`；已有外觀設定但缺少該欄位時為 `workspace`，避免升級後改變老使用者的首頁。它與分類欄位置同屬一般設定重置；外觀重置不影響。視覺規範見 [design.md](./design.md)。

### 建置配置

生產建置透過根目錄 `.parcelrc`，以 Parcel 預設 bundler 抽取共用依賴，其餘 Plasmo 外掛照舊。配置路徑依賴目前 pnpm 的 `node_modules/.pnpm/node_modules` 佈局；升級 Plasmo、Parcel 或修改 node-linker 後，要重新驗證各入口與共用資源。以檔案路徑形式寫 `extends` 會觸發 Plasmo 的設定提示，但仍會繼承完整配置。

### WebDAV

連線設定與自動檢查狀態使用獨立的 local 儲存，不進同步設定或快照。

啟動成功後非同步檢查自動備份，不阻塞首屏，初始化失敗時也不上傳。所有頁面透過同一個 Web Lock 協調儲存、清除、目錄查詢、讀取與上傳；取得鎖之後才讀設定與檢查間隔。

指紋忽略兩層 `exportedAt`，穩定物件鍵順序，並保留原生樹與陣列順序。每次備份只 PUT 一個帶 UTC 毫秒時間戳與 UUID 的 JSON，使用 `If-None-Match: *` 避免覆蓋。成功後才更新檢查點；失敗時保留上次成功時間與指紋，並限制自動重試。手動備份不受間隔與內容去重限制。目標或憑據變更時清除檢查點。

可選的 `encryptionPassphrase` 隨 WebDAV 設定只存 local，預設空字串，不重用瀏覽器同步口令。填寫後重用 `metadata-crypto.ts` 的 PBKDF2-SHA-256（150,000 次）與 AES-256-GCM，以新的隨機鹽與 IV 加密完整快照。外層為 `kind: yunji-tab-encrypted-full-snapshot`、`schemaVersion: 1` 與 `payload` 的加密信封，檔名規則不變。

指紋只從明文快照算，免得隨機密文讓去重失準。開啟、更改或清空口令都會清掉檢查點，下一次自動備份便重新上傳。讀取不分普通檔或加密檔：先檢查信封版本、鹽與 IV 長度、KDF 迭代次數是否落在 100,000 至 1,000,000，通過才解密，解密後再驗一次完整快照。口令缺少或錯誤時，會請你輸入當初建立的那一個，既不覆寫已存設定，也不跳過預覽確認。

記錄以 PROPFIND Depth 1 查詢，解析 DAV 命名空間的 207 XML，只讀成功 propstat 的屬性，過濾目錄、其他來源、目錄外路徑、無效檔名與重複 href。時間戳檔依檔名中的 UTC 時間排序；舊版固定檔與 UUID 檔用 `getlastmodified`；沒有時間的排最後。

介面分批顯示，可手動重新整理。列表只在記憶體中，不持久保存、不上傳索引、不自動刪遠端檔。載入設定時清理舊的本機記錄。還原時在鎖內核對所選檔案的目錄與帳號，使用可用的強 ETag 發 `If-Match` 條件請求，校驗格式後重用匯入預覽與確認。清除連線只刪本機設定與檢查狀態。WebDAV 瀏覽器測試以模擬協定回應覆蓋真實流程與目錄解析，不連真實雲端帳號。

### 完整快照還原

由 `restoreFullBackup` 統一處理：原生樹匯入新資料夾；同網址的補充資料與使用記錄取快照值；書籤組以 `replace` 策略按 ID 還原（替換同 ID、保留其他既有組）；應用設定由快照取代。還原後的資料繼續參與正常的瀏覽器與擴充功能同步。WebDAV 加密只包裝上傳內容，不改變 `exportBackup` 與 `exportFullBackup` 的本機明文格式。

### 書籤與分類的物件重用

書籤與分類使用不可變物件快照：更新某一項時保留其他項的引用；完整原生重新整理也重用未變化的物件。搜尋索引按書籤物件與分類路徑重用；分類改名或搬移會讓受影響的路徑失效。一般檢視的排序不看開啟次數，搜尋評分也不會因開啟次數變動而重算。原生標題事件優先做區域更新；未知節點、URL 變化與結構變動仍以完整重新整理核對；重新整理期間收到標題事件時，丟棄舊樹快照再讀一次。

### 書籤組的渲染

預設每批渲染 50 個，一般組檢視與置頂混排共用此規則。導航計數與搜尋匹配數仍包含完整列表。搜尋或檢視模式改變時重置批次；拖放位置仍取完整排序列表中的索引。組的「載入更多」按鈕使用獨立可存取名稱，避免與一般書籤分頁混淆。

書籤組頁面非同步載入時，用網格骨架呈現，不蓋一層彈窗。成員列表不管往上或往下展開，都不能壓到卡片上的操作按鈕。懸停 100ms 才展開；在卡片裡移動滑鼠只會更新位置，計時不會重來；移出後留 200ms 緩衝再收。

成員選單裡，按鈕要鋪滿邊框內側，文字留白做在按鈕自己身上。容器不要留點不到的內距，按下時按鈕也不縮小，否則邊緣的點擊會落空。

## 目錄

```text
src/
├── newtab.tsx                 # 新分頁入口
├── popup.tsx                  # 工具列彈窗
├── background.ts              # 背景事件、快捷鍵與訊息處理
├── tabs/
│   └── global-command-palette.tsx
├── components/                # 書籤、目錄、搜尋與對話框元件
│   ├── bookmark-grid/         # 書籤網格元件與 hooks
│   ├── settings/              # 設定頁各分頁
│   └── ui/                    # 通用 UI 元件
└── lib/                       # 書籤、搜尋、備份、同步與狀態邏輯

e2e/                           # Playwright 端到端測試
locales/                       # 擴充功能後設資料翻譯
assets/                        # 品牌圖示與裝飾素材
docs/                          # 使用配圖、開發與隱私說明
```

## 技術棧

- Plasmo：擴充功能建置與開發
- React 19、TypeScript：介面與型別檢查
- Tailwind CSS、shadcn/ui、Radix UI：樣式與互動元件
- Zustand、@plasmohq/storage：狀態與瀏覽器儲存
- dnd-kit：拖放
- Vitest、Playwright、axe-core：單元測試、端到端測試與無障礙檢查

## 與原生書籤的關係

擴充功能直接操作原生書籤樹，並監聽新增、修改、搬移、刪除與順序變化。在書籤管理員或其他裝置修改後，主頁會隨事件更新。

| 操作 | 瀏覽器 API |
| --- | --- |
| 新增書籤或目錄 | `chrome.bookmarks.create` |
| 編輯名稱或網址 | `chrome.bookmarks.update` |
| 搬移書籤或目錄 | `chrome.bookmarks.move` |
| 刪除書籤 | `chrome.bookmarks.remove` |
| 刪除目錄 | `chrome.bookmarks.removeTree` |

描述、標籤、圖示、備用 URL 等補充欄位由擴充功能儲存；儲存與同步邊界見[隱私與權限](./privacy.md)。

## 文件與配圖

改動使用者可見的功能後，同步更新 README 的使用說明與 `docs/store-description.md` 的產品介紹，並保持 README、開發指南與隱私說明的中英文一致。

涉及資料、網路請求或權限時，更新隱私說明；新增設定、儲存或測試限制時，更新開發指南。

配圖放在 `docs/images/`，只用測試環境與公開網站，避免暴露真實書籤、帳號或憑據。

```bash
# 第一次使用時安裝截圖所需的瀏覽器
pnpm exec playwright install chromium
pnpm docs:screenshots
```

指令會先重新建置，再由 `scripts/capture-docs.mjs` 在臨時 Chromium 設定中載入真實擴充功能，建立公開示例書籤、書籤組與收件匣項目。

時間固定為 2026-10-15 10:08，天氣固定為台北晴天 26°C。這些是截圖用的夾具，不是產品預設值。指令碼不連日常瀏覽器，不使用真實帳號與憑據，結束後關閉瀏覽器並清理臨時設定。

跑完之後，`docs/images/` 會有 12 張 WebP：居中首頁、工作台、搜尋、書籤組、命令面板、收件匣整理、書籤編輯、批次管理、外觀、時間天氣、資料備份與 WebDAV 各一張。

指令碼會等書籤、天氣與圖示載入，檢查橫向溢位，並以減少動態效果設定關閉截圖動畫；全部成功才替換文件圖片。發生錯誤時，診斷截圖存到系統暫存目錄的 `yunji-docs-error.png`。完成後仍要逐張檢查內容、裁切與文字；配圖採集不等於完整回歸。指令碼輸出的是 PNG，跑完後請把 `docs/images/` 的 PNG 轉成同名 WebP 並刪除 PNG，文件連結一律指向 `.webp`，否則會顯示舊圖，檔案也會持續變大。

中英文 README 共用中文介面截圖。新增或重新命名圖片時，同步更新兩份 README 與相關指南的引用。備份操作見[備份與還原](./backup.md)。
