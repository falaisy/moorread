# 書野 Moorread 商店文案

更新：2026-11-15

商店只送繁體中文；English 為選填。其餘後台欄位（單一用途、權限理由、資料使用、截圖）見 `store-listing/SUBMISSION.md`。

---

## 繁體中文

### 摘要（132 字元內）

```
把 Chrome 書籤放回每天都會經過的地方：搜尋、收藏、整理與備份，都在同一頁完成。
```

### 詳細說明

```
書野 Moorread 是 Chrome 書籤的新分頁工作檯。直接使用 Chrome 既有的書籤與資料夾——不匯入、不搬家、不註冊帳號。


■ 首頁與版面
・預設首頁：時間、天氣、搜尋框 + 最多十個置頂項目
・工作台版面：搜尋與天氣收進頂欄，空間留給書籤
・分類欄可固定或浮動；資料夾數量可顯示或隱藏


■ 搜尋
・同時比對名稱、網址、描述、標籤與資料夾路徑
・中文拼音首字母、英文前幾個字母即可命中
・tag:、site:、folder: 條件精準篩選；常用查詢存成篩選
・Ctrl/Cmd + K 命令面板：新增書籤、清空搜尋、檢查連結、切換明暗


■ 收藏與分類
・收件匣：看到一半的頁面先收著，之後逐筆選資料夾與標籤
・重複收藏自動提醒，避免同網址多份入口
・書籤組：把會一起打開的網站放在同組，組內可命名、換圖示、調順序


■ 整理
・批次管理：搬移、開啟、刪除，或批次補描述
・規則整理：比對標題、網址、網域、描述或標籤，指定資料夾並追加標籤
・原生書籤排序：按標題、網址、新增或最近使用時間，升/降序，可多欄位依序套用；可手動執行或設定成新增/改名/移動時自動重排
・健康檢查：列出重複、失效與被重新導向的網址
・垃圾桶 + 操作歷史 + 同步恢復點，後悔有路可退


■ 備份與還原
・Chrome 同步描述、標籤、圖示與置頂狀態
・匯出 JSON 或完整快照（書籤樹、目錄圖示、補充資料、書籤組、使用記錄與設定）
・WebDAV（選用，需自備支援 WebDAV 的服務並自行建立目錄）：手動或自動上傳，遠端多版本，可加密
・WebDAV 應用程式密碼只保留在目前瀏覽器工作階段；備份加密口令存於本機。更新擴充功能或重新啟動瀏覽器後，需重新輸入密碼才會恢復自動備份。書籤與既有遠端備份檔不受影響
・此功能尚未對所有 WebDAV 服務完成驗證；不同服務的相容性可能不同，連線失敗時請確認服務支援 WebDAV、目錄已存在且網址使用 HTTPS
・GitHub Gist（選用，需自備 GitHub Token）：上傳完整快照到你的私人 Gist，固定檔名 moorread-backup.json，每次更新同一份；支援瀏覽器端加密。Token、Gist ID 與備份密碼存於 Chrome 同步儲存，啟用 Chrome 同步時會同步到你的其他裝置；備份時 Token 與 Gist ID 都會送往 GitHub API
・首次手動備份、首次啟用自動備份，以及首次測試連線、讀取遠端列表或還原前，會顯示揭露視窗（目的地、本次傳輸內容、憑證儲存與傳送方式），需明確同意才會傳輸；上傳與讀取分開同意、Gist 與 WebDAV 各自獨立，拒絕同意或同意紀錄無效時不會匯出、不會發出請求
・升級後已勾選自動備份但缺少同意時，會顯示「自動備份暫停中」，按一次「重新同意並恢復自動備份」即可恢復，不需取消再勾選，且恢復當下不會立即上傳；可在「資料與隱私」撤回所有備份同意，撤回後自動備份停止、既有設定保留
・Chrome 原生書籤匯入 / 匯出
・還原前顯示預覽，匯入新資料夾，原有書籤不受影響


■ 外觀
・五種風格（晴空 / 簡潔 / 平衡 / 緊湊 / 柔和）+ 六種配色 + 五種強調色
・每種配色皆可切換淺色、深色或跟隨系統
・可調整背景、卡片、圓角、圖示尺寸與顯示欄位
・時間與天氣可分別關閉；12 / 24 小時制、攝氏 / 華氏、手動選城市
・裝置位置從未讀取


■ AI 分類（選用）
・填入自己的 OpenAI 相容服務（Base URL、Token、模型）
・AI 產生分類建議，確認後才執行；可暫停、繼續或終止
・最近一次結果 24 小時內可撤銷
・Token 不寫入同步資料或備份；不設定也不影響其他功能


■ 隱私
・沒有帳號，不使用第三方分析或追蹤 SDK，也不向開發者傳送使用統計
・網站圖示向 Google Favicon 取得，只傳網域
・天氣、網頁資訊、健康檢查、AI、WebDAV——只在你主動使用時連線
・WebDAV 帳密與備份口令只留在這台裝置（應用程式密碼只存目前瀏覽器工作階段）；Gist Token、Gist ID 與備份密碼存於 Chrome 同步儲存，開啟 Chrome 同步時會跨裝置同步
・部分使用記錄（書籤開啟次數、最近開啟）平時只存本機，只有你建立完整快照並備份時才隨快照上傳


介面語言：繁體中文、英文
```

---

## English

### Summary

```
Put Chrome bookmarks back where you pass every day: search, save, sort and back up from one new tab.
```

### Description

```
Moorread turns the new tab into a workspace for your Chrome bookmarks. It works with the bookmarks and folders Chrome already has — no import, no migration, no account required.


■ Home and layout
・Default home: time, weather, one search field, up to ten pinned items
・Workspace layout: search and weather move to the top bar, more room for bookmarks
・Category bar can be fixed or floating; folder counts optional


■ Search
・Matches names, addresses, descriptions, tags and folder paths at once
・Pinyin initials for Chinese, a few letters for English
・tag:, site:, folder: for precision; save repeated queries as filters
・Ctrl/Cmd + K command palette: add bookmark, clear search, link check, switch theme


■ Save and organize
・Inbox: save pages mid-reading, choose folder and tags later
・Duplicate alert: warns before the same address is saved twice
・Bookmark groups: keep sites that open together in one group, rename, reorder, change icon


■ Organize
・Bulk: move, open, delete many bookmarks at once, or fill descriptions in a batch
・Rules: match title, address, domain, description or tag, then apply folder and tags
・Native bookmark sorting: by title, address, date added or last used; ascending or descending; multiple criteria in sequence; run once or auto-sort on create / rename / move
・Link health: lists duplicates, broken and redirected URLs
・Trash + operation history + sync restore points — undo anything


■ Backup and restore
・Chrome sync for descriptions, tags, icons and pin state
・Export JSON or full snapshot (bookmark tree, folder icons, metadata, groups, usage history and settings)
・WebDAV (optional; you need your own WebDAV-compatible service and must create the folder yourself): manual or auto upload, remote versions, optional encryption
・The WebDAV app password is kept only for the current browser session; the backup encryption passphrase stays on this device. After an extension update or browser restart, re-enter the app password to resume automatic backups. Bookmarks and existing remote backups are unaffected
・This feature has not been end-to-end verified against every WebDAV service. Compatibility varies between services; if a connection fails, check that the service supports WebDAV, the folder exists, and the URL uses HTTPS
・GitHub Gist (optional; you supply your own GitHub token): uploads the full snapshot to your private Gist under the fixed filename moorread-backup.json, updating the same file each time, with optional browser-side encryption. The token, Gist ID and backup passphrase are stored in Chrome sync storage and sync across devices when Chrome sync is on; during backup the token and Gist ID are both sent to the GitHub API
・Before the first manual backup, the first automatic backup, and the first connection test, remote listing or restore, a disclosure dialog shows the destination, what this transfer contains, and how credentials are stored and sent; nothing is exported or sent until you explicitly agree. Uploads and reads are separate consents, and Gist and WebDAV are independent; declining or an invalid consent record sends nothing
・If a setting is enabled but consent is missing after an upgrade, "Automatic backup is paused" appears with a one-click "Agree again and resume automatic backup" button, without unticking and reticking, and without uploading immediately. All backup consent can be revoked under Data & privacy; revocation stops automatic backup and keeps existing settings
・Import / export with native Chrome bookmarks
・Restore shows a preview first, imports into a new folder, existing bookmarks stay untouched


■ Appearance
・Five styles (Clear Sky / Minimal / Balanced / Compact / Soft) + six color themes + five accent colors
・Every theme supports light, dark and system modes
・Customizable backgrounds, cards, corners, icon size and visible fields
・Time and weather toggleable separately; 12/24-hour, Celsius/Fahrenheit, manual city picker
・Device location never read


■ AI classification (optional)
・Bring your own OpenAI-compatible service (Base URL, token, model)
・AI drafts a sorting plan; bookmarks move only after you confirm. Pause, resume or stop anytime
・Undo the last result within 24 hours
・Tokens never written to sync data or backups; leaving this blank affects nothing else


■ Privacy
・No account, no third-party analytics or tracking SDKs, and no usage statistics sent to the developer
・Site icons from Google Favicon service — only the domain is sent
・Weather, page details, link check, AI, WebDAV — connect only when you use that feature
・WebDAV credentials and backup passphrase stay on this device (the app password lives only for the current browser session); the Gist token, Gist ID and backup passphrase live in Chrome sync storage and sync across devices when Chrome sync is on
・Some usage history (bookmark open counts and last-opened times) stays on this device normally and is uploaded only when you create and upload a full snapshot


Languages: Traditional Chinese, English
```
