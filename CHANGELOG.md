# CHANGELOG.md — 版本變更

> 本檔記錄正式版本 0.1.12 的變更與發布狀態。
> 版本權威：Git commit SHA；封裝包以 SHA256 為準。

## 0.1.12（2026-11-22，正式發布）

**工程變更（整合）**
- 外觀色階：`src/lib/appearance.ts` 新增 `--border-strong`（預設、sky 等主題的亮／暗），提高邊框對比；新增精簡卡片容器查詢外殼 `compact-card-shell` 與固定寬度的次要欄，7／8 欄窄卡不再讓次要欄覆蓋操作按鈕。
- 自訂主題色盤：新增 `src/lib/palette.ts`、`src/lib/store-theme-palette-slice.ts`、`src/lib/theme-palette-storage.ts` 與設定頁「外觀・色盤」區塊；支援色值正規化、亮／暗模式、AA 對比檢核（文字 4.5:1、介面 3:1）、鎖定與隨機，以及儲存／還原。
- 本機背景圖：新增 `src/lib/local-background.ts` 與設定頁「外觀・背景」區塊；限制 8 MB／8192 px、MIME 白名單，圖片存放於本機快取。
- 首屏主題啟動：新增 `src/lib/theme-boot.ts`，在 React 掛載前套用主題與色盤，避免重新整理時先閃預設色。
- 搜尋：新增 `src/lib/search-bar-results.ts`（書籤／資料夾各最多 5 筆，含分組與資料夾路徑）；書籤模式搜尋框改為 `combobox` 語義並補齊 `aria-expanded`／`aria-controls`／`aria-activedescendant`；hero 搜尋結果面板改在文件流內展開，不再覆蓋分類卡操作按鈕。
- 卡片操作：`BookmarkCard`／`CategoryCard`／`BookmarkGroupCard` 的操作按鈕與 hover 選單位置調整，保留鍵盤焦點與拖曳行為。
- 測試：新增 `compact-list`、`local-background`、`p3-ui-consistency`、`search-integration`、`theme-contrast`、`theme-first-paint`、`theme-palette` 等 E2E，以及 `palette`／`local-background`／`search-bar-results`／`appearance-border-strong` 等單元測試；Playwright 產物改由 `MOORREAD_E2E_OUTPUT_DIR` 指定，與既有輸出分離。

**修復**
- `bookmark-groups-ui` 兩處搜尋框定位器改以實際無障礙角色 `combobox` 定位。
- 修正搜尋結果面板開啟時點擊分類卡「編輯資料夾」按鈕落空的問題：hero 面板改為文件流內展開；`SearchBar` 在焦點先落到卡片操作元素時，等這次點擊完成後再收合面板；`HomeHero` 的 docked 判定改量測搜尋框本體。
- 新增回歸測試「keeps the open results panel clickable for folder actions」。
- 修正精簡模式下書籤組卡片高度：`BookmarkGroupCard` 回復 `cardHeight` 的 85%（預設 80 → 68px）作為最小高度，與單行精簡書籤列（48px）區分；`bookmark-groups-ui:229` 不再失敗。
- 修正精簡資料夾列的圖示槽位：`CategoryCard` 精簡檢視仍顯示小型分類圖示，但補上 `data-slot="folder-card-icon"`，讓「卡片圖示」開關在卡片與精簡兩種檢視下都有同一個可辨識的圖示；`icon-visibility:106` 不再失敗。
- 修正時間天氣設定與重新載入的競態：`setHeaderWidget` 改為寫入儲存成功後才更新畫面（寫入失敗仍保留使用者的樂觀選擇並顯示錯誤），避免關閉時間與天氣後立刻重新載入又看到小工具；`header-widget:14` 連續 10 次隔離重跑均通過。

**環境限制**
- `profile-root-guard` 的 4 項 Junction 案例在目前執行環境無法建立可解析的 Junction，依測試既有 `test.skip` 條件標記 skipped（未修改測試內容）；同一版本在原本環境曾實際執行通過。

**發布狀態**
- 由 0.1.12 原始碼建置，`build/chrome-mv3-prod/manifest.json` 版本 `0.1.12`。
- 驗收：Vitest 71 檔／728 tests PASS；TypeScript 0 error；ESLint 0 error；Plasmo production build 成功；Playwright 全量 204 項為 200 passed／0 failed／4 skipped（上述環境限制）。
