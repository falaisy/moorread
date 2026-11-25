import { expect, test } from './extension.fixture'

// P0-2 regression test: sidebar collapse usability
// Root cause: outer Popover.Trigger <button> wrapped entire collapsed sidebar,
// intercepting every icon click and preventing direct category switching.
// Fix: removed outer button wrapper; each CategoryTab button is independently
// clickable; moved Popover.Trigger to the Settings2 manage-button at bottom.

const SETTINGS_KEY = 'moorread:settings'

async function getSidebarState(page: any) {
  const navLayout = await page.evaluate(() =>
    document.querySelector('.workspace-layout')?.getAttribute('data-nav-layout'),
  )
  const gridCols = await page.evaluate(() => {
    const el = document.querySelector('.workspace-layout')
    return el instanceof HTMLElement ? el.style.gridTemplateColumns : null
  })
  return { navLayout, gridCols, collapsedWidth: !!(gridCols && gridCols.startsWith('56px')) }
}

async function waitExtension(page: any) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1800)
}

test('sidebar starts expanded, collapses via storage, restores on reload', async ({ extensionWorker, newTabPage }) => {
  await waitExtension(newTabPage)

  // 1. Starts expanded
  const initial = await getSidebarState(newTabPage)
  test.info().annotations.push({
    type: 'message',
    description: `Initial: layout=${initial.navLayout}, grid=${initial.gridCols}`,
  })
  expect(initial.navLayout).toBe('sidebar')
  expect(initial.collapsedWidth, 'New user should start EXPANDED').toBe(false)

  // 2. Collapse via storage (the real persistence path)
  await extensionWorker.evaluate(async ({ SETTINGS_KEY }) => {
    const raw = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]
    const s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    const appearance = { ...(s.appearance ?? {}), sidebarCollapsed: true }
    await chrome.storage.sync.set({ [SETTINGS_KEY]: JSON.stringify({ ...s, appearance }) })
  }, { SETTINGS_KEY })

  await newTabPage.waitForTimeout(600)
  const collapsed = await getSidebarState(newTabPage)
  test.info().annotations.push({
    type: 'message',
    description: `After storage-set collapsed=true: grid=${collapsed.gridCols}`,
  })
  expect(collapsed.collapsedWidth, 'Should collapse to 56px after storage change').toBe(true)

  // 3. Reload → state persists
  await newTabPage.reload()
  await waitExtension(newTabPage)
  const persisted = await getSidebarState(newTabPage)
  test.info().annotations.push({
    type: 'message',
    description: `After reload: grid=${persisted.gridCols}`,
  })
  expect(persisted.collapsedWidth, 'Collapsed state should survive reload').toBe(true)

  // 4. Restore
  await extensionWorker.evaluate(async ({ SETTINGS_KEY }) => {
    const raw = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]
    const s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    const appearance = { ...(s.appearance ?? {}), sidebarCollapsed: false }
    await chrome.storage.sync.set({ [SETTINGS_KEY]: JSON.stringify({ ...s, appearance }) })
  }, { SETTINGS_KEY })
  await newTabPage.waitForTimeout(600)
  const restored = await getSidebarState(newTabPage)
  expect(restored.collapsedWidth, 'Should restore to expanded').toBe(false)
})

test('collapsed sidebar: expand button visible, icons individually clickable, active mark, tooltip', async ({ extensionWorker, newTabPage }) => {
  // Set collapsed via storage
  await extensionWorker.evaluate(async ({ SETTINGS_KEY }) => {
    const raw = (await chrome.storage.sync.get(SETTINGS_KEY))[SETTINGS_KEY]
    const s = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    const appearance = { ...(s.appearance ?? {}), sidebarCollapsed: true }
    await chrome.storage.sync.set({ [SETTINGS_KEY]: JSON.stringify({ ...s, appearance }) })
  }, { SETTINGS_KEY })

  await newTabPage.reload()
  await waitExtension(newTabPage)

  const state = await getSidebarState(newTabPage)
  expect(state.collapsedWidth, 'Should be collapsed at start of test').toBe(true)

  // --- A. Expand button at TOP of sidebar (clearly visible, always present) ---
  const expandBtn = newTabPage.getByRole('button', { name: /展開側欄|Expand sidebar/i }).first()
  await expect(expandBtn).toBeVisible({ timeout: 2000 })
  const expandTitle = await expandBtn.getAttribute('title')
  test.info().annotations.push({ type: 'message', description: `Expand button visible, title="${expandTitle}"` })
  expect(expandTitle, 'Expand button should have tooltip').toBeTruthy()

  // --- B. Active category has a visible visual mark ---
  const activeTab = newTabPage.locator('[data-category-tab][data-active]').first()
  await expect(activeTab).toBeVisible({ timeout: 2000 })
  const classes = (await activeTab.getAttribute('class')) ?? ''
  test.info().annotations.push({ type: 'message', description: `Active tab classes: ${classes}` })
  expect(classes, 'Active tab should have ring-* class for visual mark').toMatch(/ring-/)

  // --- C. Every CategoryTab button has an aria-label and exposes it as a tooltip ---
  // Collapsed tabs intentionally omit the native `title` and use the shared
  // Radix tooltip instead (src/components/category-tabs/CategoryTab.tsx:60,120-127).
  // CRITICAL: these must be individually reachable (no outer wrapper swallowing clicks!)
  const tabButtons = newTabPage.locator('[data-category-tab] button')
  const count = await tabButtons.count()
  test.info().annotations.push({ type: 'message', description: `Total visible tab buttons: ${count}` })
  expect(count, 'Collapsed sidebar must show at least virtual categories').toBeGreaterThan(0)

  let missingAria = 0
  const samples: string[] = []
  const labels: string[] = []
  for (let i = 0; i < count; i++) {
    const btn = tabButtons.nth(i)
    const aria = await btn.getAttribute('aria-label')
    if (!aria)
      missingAria++
    else if (i < 3)
      labels.push(aria)
    if (i < 3)
      samples.push(`[${i}] aria="${aria?.slice(0, 20)}"`)
  }
  test.info().annotations.push({
    type: 'message',
    description: `${samples.join('\n')}\nMissing aria: ${missingAria}`,
  })
  expect(missingAria, 'All tab buttons must have aria-label').toBe(0)

  // Tooltip content is `${label} · ${count}`; keyboard focus opens it without hovering.
  for (const [index, label] of labels.entries()) {
    const btn = tabButtons.nth(index)
    await btn.focus()
    await expect(newTabPage.getByRole('tooltip')).toContainText(label)
    await btn.evaluate(element => (element as HTMLElement).blur())
    await expect(newTabPage.getByRole('tooltip')).toHaveCount(0)
  }

  // --- D. Click a non-active icon → active marker must shift (prove click is NOT swallowed!) ---
  const initialActiveIds = await newTabPage.locator('[data-category-tab][data-active]').evaluateAll(tabs =>
    tabs.map((t: Element) => t.querySelector('button')?.getAttribute('aria-label') ?? ''),
  )
  test.info().annotations.push({
    type: 'message',
    description: `Initial active tab aria-labels: [${initialActiveIds.join(', ')}]`,
  })

  // Pick a non-active virtual category button
  const inactiveTab = newTabPage.locator('[data-category-tab]:not([data-active])').first()
  await expect(inactiveTab).toBeVisible({ timeout: 2000 })
  const clickedButton = inactiveTab.locator('button').first()
  const clickedAria = await clickedButton.getAttribute('aria-label')
  test.info().annotations.push({
    type: 'message',
    description: `About to click: "${clickedAria}"`,
  })

  await clickedButton.click()
  await newTabPage.waitForTimeout(600)

  // After click: the clicked tab SHOULD be among the active ones
  const activeNowIds = await newTabPage.locator('[data-category-tab][data-active]').evaluateAll(tabs =>
    tabs.map((t: Element) => t.querySelector('button')?.getAttribute('aria-label') ?? ''),
  )
  test.info().annotations.push({
    type: 'message',
    description: `After click, active aria-labels: [${activeNowIds.join(', ')}]`,
  })
  // Core assertion: the icon we clicked IS now active (click was NOT swallowed)
  const clickedNowActive = activeNowIds.includes(clickedAria)
  expect(clickedNowActive, 'Clicked icon must now be active (prove click worked!)').toBe(true)
  // And the initial set MUST have changed (we actually navigated somewhere)
  const changed = initialActiveIds.join('|') !== activeNowIds.join('|')
  expect(changed, 'Active state must actually change after click').toBe(true)

  // --- E. Settings2 manage popover button at BOTTOM ---
  // We only render this on lg: screens, Playwright headless runs at 1280×720 — should be lg
  const manageBtn = newTabPage.getByRole('button', { name: /管理分類|Manage categories/i }).first()
  const manageCount = await manageBtn.count()
  if (manageCount > 0) {
    await expect(manageBtn).toBeVisible({ timeout: 2000 })
    await manageBtn.click()
    // The manage trigger opens a Popover `role="group"` containing the full CategoryTabs
    // (NewtabWorkspace.tsx:266-308), not a Radix menu of `menuitem` rows.
    const popover = newTabPage.getByRole('group', { name: '書籤分類' })
    await expect(popover).toBeVisible({ timeout: 3000 })
    const popoverItems = popover.locator('[data-category-tab]')
    const popoverCount = await popoverItems.count()
    test.info().annotations.push({
      type: 'message',
      description: `Manage button opened popover with ${popoverCount} items`,
    })
    expect(popoverCount, 'Manage button popover should show categories').toBeGreaterThan(0)
  }
  else {
    test.info().annotations.push({
      type: 'message',
      description: 'Manage button not visible in current viewport — skipping (lg-screen only)',
    })
  }

  // --- F. Click expand button → sidebar restores to full width ---
  await expandBtn.click()
  await newTabPage.waitForTimeout(500)
  const expanded = await getSidebarState(newTabPage)
  test.info().annotations.push({ type: 'message', description: `After expand: grid=${expanded.gridCols}` })
  expect(expanded.collapsedWidth, 'Expand button should restore sidebar width').toBe(false)
})
