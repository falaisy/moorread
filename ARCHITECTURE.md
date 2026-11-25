# ARCHITECTURE.md — MoorRead 系統架構

> 建立：2026-11-08。以程式碼與 `build/chrome-mv3-prod/manifest.json` 為準。

## 1. 技術棧與建置

| 項目 | 值 | 證據 |
|---|---|---|
| 擴充框架 | Plasmo `0.90.5` | `package.json` |
| UI | React `19.2.7`、Tailwind CSS、Radix UI、lucide-react | `package.json` |
| 狀態管理 | Zustand `5.0.14`（slice 拆分） | `src/lib/store.ts`、`store-*-slice.ts` |
| 語言 | TypeScript `5.9.3` | `package.json` |
| 測試 | Vitest `4.1.10`、Playwright `1.61.1`、axe-core | `package.json`、`e2e/` |
| 套件管理 | pnpm `10.34.4` | `package.json` |
| 建置指令 | `pnpm build`（`plasmo build`）→ `build/chrome-mv3-prod/` | `package.json` |
| 驗證指令 | `pnpm verify` = `typecheck && lint && test` | `package.json` |
| 特殊設定 | `.parcelrc` 以硬編碼 pnpm 路徑運作，無法使用標準 `extends` | `.parcelrc`、開發紀錄 |

## 2. Manifest V3 實際內容（`build/chrome-mv3-prod/manifest.json`）

| 欄位 | 值 |
|---|---|
| `manifest_version` | `3` |
| `version` | `0.1.12` |
| `name` / `description` | `__MSG_extensionName__` / `__MSG_extensionDescription__`（locale 檔） |
| `default_locale` | `zh_TW` |
| `background` | Service Worker：`static/background/index.js` |
| `chrome_url_overrides.newtab` | `newtab.html` |
| `action.default_popup` | `popup.html` |
| `permissions` | `storage`、`bookmarks`、`search`、`favicon`、`activeTab`、`scripting`、`contextMenus`、`tabs` |
| `host_permissions` | `https://www.google.com/*`、`https://*.gstatic.com/*`、`https://api.github.com/*` |
| `optional_host_permissions` | `http://*/*`、`https://*/*` |
| `commands` | `open-global-command-palette`；`quick-save-page`（`Alt+Shift+B`／Mac `Command+Shift+B`） |
| `web_accessible_resources` | `tabs/global-command-palette.html`（僅 http/https） |
| `content_scripts` | **無**（命令面板以 `chrome.scripting` 注入 iframe） |

Manifest 來源：`package.json` 的 `manifest` 欄位，由 Plasmo 產生；修改需改 `package.json`，不要直接改 `build/`。

## 3. 入口與頁面

| 入口 | 檔案 | 說明 |
|---|---|---|
| 新分頁 | `src/newtab.tsx` → `NewtabWorkspace` | 主要 UI；讀取書籤樹、metadata、設定 |
| 彈出視窗 | `src/popup.tsx` | 工具列 popup |
| 背景 Service Worker | `src/background.ts` | 右鍵選單、快捷鍵、訊息路由、命令面板注入、自動整理 |
| 全域命令面板 | `src/tabs/global-command-palette.tsx` | 以 iframe 載入任意網頁；session token 驗證 |
| 設定頁 | `src/components/SettingsDialog.tsx` + `settings/Settings*Tab.tsx` | 分頁式設定 |

## 4. 資料流

### 4.1 書籤（原生為真相來源）
```
Chrome bookmarks API
  ├─ src/lib/bookmark-tree.ts / bookmark-repository.ts   讀取與轉換
  ├─ src/lib/category-tree.ts / category-path.ts          分類樹與路徑
  ├─ src/lib/chrome-bookmark-sync.ts                      Chrome → Moorread 匯入
  └─ src/lib/bookmark-native-sort.ts                      原生多欄位排序
```
- 書籤名稱、位置、網址以 Chrome 原生書籤為準；Moorread 不另存副本。
- 補充資料（描述、標籤、圖示、置頂、收件匣狀態）存 `moorread:meta`（`chrome.storage.local`）。

### 4.2 設定與 UI 狀態
```
SettingsDialog / NewtabWorkspace
  → useNavStore（Zustand slices：settings/bookmark/group/backup）
  → store-persistence.ts（persist + navigator.locks）
  → chrome.storage.sync: moorread:settings
```
- `store-settings-slice.ts` 的 `setDefaultCategory` 直接寫入 `settings.defaultCategoryId`，**不再依「已載入分類」降級**（避免分類尚未載入時被寫回 `all`）。
- 跨分頁寫入以 `withSettingsLock`（Web Locks，名稱＝storage key）序列化；鎖內重讀最新值再合併。

### 4.3 背景服務（MV3）
`src/background.ts` 註冊的事件（全域同步註冊）：
- `chrome.runtime.onInstalled` → 重建右鍵選單
- `chrome.storage.onChanged`（sync `moorread:settings`）→ 更新右鍵選單
- `chrome.contextMenus.onClicked` → 快速收藏
- `chrome.commands.onCommand` → 快速收藏／開命令面板
- `chrome.runtime.onMessage` → favicon、首頁註冊、命令面板 session（validate／open／save／switch-category／home／close）、快速收藏
- `chrome.tabs.onRemoved` → 清除 session
- `registerBookmarkEvents()`、`registerNativeSortAutoListener()`（檔案末端）

### 4.4 同步與備份
| 機制 | 模組 | 儲存位置 |
|---|---|---|
| 設定同步 | `store-persistence.ts` | `chrome.storage.sync` |
| 補充資料 | `store-persistence.ts` | `chrome.storage.local`（避免 sync 配額） |
| 跨裝置 metadata | `metadata-sync*.ts`、`metadata-crypto.ts` | `moorread:metadata-sync-*` |
| JSON 備份／完整快照 | `backup.ts`、`import-preview.ts` | 使用者下載 |
| WebDAV | `webdav-backup.ts` | 使用者自有 WebDAV |
| Gist | `gist-backup.ts` | GitHub Gist（`api.github.com`） |
| 命令面板 session | `background.ts` | `chrome.storage.session` |

## 5. 模組地圖（依職責）

| 區域 | 代表檔案 | 職責 |
|---|---|---|
| 書籤核心 | `bookmark-repository.ts`、`bookmark-tree.ts`、`bookmark-groups.ts` | CRUD、分組、樹狀結構 |
| 搜尋 | `bookmark-search.ts`、`search-engines.ts` | 模糊搜尋、進階語法、搜尋引擎 |
| 整理 | `auto-organize.ts`、`native-sort-auto.ts`、`bookmark-native-sort.ts` | 規則整理、原生排序 |
| 健康／安全 | `bookmark-health.ts`、`bookmark-deletion-safety.ts` | 連結檢查、刪除防競態 |
| 外觀 | `appearance.ts`、`theme-transition.ts`、`main.css` | 主題 token、版面設定 |
| i18n | `i18n.ts`、`i18n-*.ts`、`language.ts`、`use-i18n.ts` | 翻譯目錄與語系解析（zh-* → zh_TW） |
| 設定 UI | `components/settings/**` | 設定分頁 |
| 新分頁 UI | `components/newtab/**`、`category-tabs/**` | 版面、分類欄、收合側欄 |
| 診斷 | `diagnostics.ts` | 統一錯誤回報（不含敏感資料） |
| 儲存抽象 | `storage-port.ts`、`store-persistence.ts` | StoragePort＋Web Locks＋持久化佇列 |

## 6. 關鍵設計決策與限制

1. **storage key 不可改**：`moorread:meta`、`moorread:category-meta`、`moorread:settings`、`moorread:usage`、`moorread:metadata-sync-log`、`moorread:metadata-sync-passphrase`、`moorread:tasks`。改名會讓既有使用者資料失效。`navigator.locks` 名稱同屬相容邊界。
2. **原生書籤為真相來源**：Moorread 只疊加補充資料；避免雙寫衝突。
3. **MV3 生命週期**：Service Worker 隨時可能休眠，狀態必須可重建；不用常駐 `setInterval`。
4. **分類 id 有前綴**：app 層為 `cat-{nativeId}`，原生資料夾 id 為 `{nativeId}`；跨層需映射（`background.ts` 的 `catToNativeId`、`SettingsGeneralTab.tsx` 的雙形式正規化）。
5. **i18n 全繁中硬編碼於 `i18n-*.ts`**：E2E fixture 必須 `zh-TW`，否則 aria-label 比對失敗。
6. **命令面板以 iframe 注入**：需 `scripting` 權限與 `web_accessible_resources`；不使用 content script。

## 7. 已知架構風險

| 風險 | 說明 | 影響 |
|---|---|---|
| 設定競態 | 多分頁同時寫 `moorread:settings`；已用 Web Lock，但舊版邏輯曾把 `defaultCategoryId` 覆蓋回 `all` | 可能根因之一，需實測確認 |
| 分類載入時序 | 分類未載入時寫入預設值會失真 | 高風險 |
| 收合側欄事件攔截 | 歷史上外層 Popover trigger 包住整個側欄，攔截圖示點擊 | 高風險；現行已移除外層 wrapper |
| E2E 環境限制 | Playwright 全量在部分環境不穩定 | 回歸訊號不足 |

## 8. 現況核對（2026-11-11 實測；2026-11-25 覆核）

以隔離 Edge/Chromium 臨時 Profile 載入 `build/chrome-mv3-prod` 並以 Playwright `ariaSnapshot()` 取證：

1. **語系只有兩個**：`Language = 'zh-TW' | 'en'`（`src/lib/language.ts`），`isLanguage('ja') === false`；`i18n.ts` 僅 `zhTW`／`en` 兩份目錄。舊 E2E 迴圈中的 ja／ko／es／fr 皆不存在。
2. **設定分頁共 11 個**：一般、版面、書籤外觀、視覺、快速鍵、搜尋、內容補全、AI、資料與隱私、原生書籤、關於；「外觀」已拆為「版面」「書籤外觀」「視覺」。
3. **設定入口已獨立**：標題列有 `button "開啟設定"`；「更多操作」選單只剩開啟書籤健康檢查、開啟垃圾桶與歷史記錄、管理分頁工作階段、切換到工作台佈局。任何以 menuitem 找「開啟設定」的路徑都已失效。
4. **命名變更**：批次管理（非批量）、分頁工作階段（非標籤頁會話）、垃圾桶與歷史記錄、工作中心、收件匣（非收件箱）、快速鍵（非快捷鍵）、進階自訂（設定面板已改為常駐顯示）。
5. **E2E 實際發現數為 204**：`playwright.config.ts` 以 `e2e/` 為 `testDir`，並以 `testIgnore` 排除除錯驗證檔；2026-11-25 全量結果為 200 passed／0 failed／4 skipped。
6. **品牌色**：`src/lib/appearance.ts` sky 淺色 `--brand` 由 `221 87% 55%` 改為 `221 87% 50%`，修正 axe color-contrast 4.2:1。

## 9. 未在本次驗證的架構面

- `pnpm build`：0.1.12 已於 2026-11-25 建置成功（manifest 版本 `0.1.12`）。
- 真實 Chrome／Edge 載入 `build/chrome-mv3-prod/`：`NOT VERIFIED`。
- WebDAV、Gist、AI API 的真實端點連線：`NOT VERIFIED`。
