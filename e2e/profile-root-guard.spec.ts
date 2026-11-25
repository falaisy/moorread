import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  rmdir,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import {
  createProfile,
  PROFILE_PREFIX,
  PROFILE_ROOT_SEGMENTS,
  pruneStaleProfiles,
  removeProfile,
  resolveProfileRoot,
} from './support/e2e-profile'

const projectRoot = process.cwd()

async function withRoot<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.MOORREAD_E2E_PROFILE_ROOT
  if (value === undefined)
    delete process.env.MOORREAD_E2E_PROFILE_ROOT
  else
    process.env.MOORREAD_E2E_PROFILE_ROOT = value
  try {
    return await run()
  }
  finally {
    if (previous === undefined)
      delete process.env.MOORREAD_E2E_PROFILE_ROOT
    else
      process.env.MOORREAD_E2E_PROFILE_ROOT = previous
  }
}

test('profile 根目錄位於專案 test-temp 之下，且不在系統 TEMP 內', async () => {
  const dir = await createProfile('moorread-e2e-', 'e2e/profile-root-guard.spec.ts')
  try {
    const root = await resolveProfileRoot()
    const real = await import('node:fs/promises').then(fs => fs.realpath(dir))
    expect(root).toBe(path.join(projectRoot, ...PROFILE_ROOT_SEGMENTS))
    expect(real.startsWith(root + path.sep)).toBe(true)
    expect(real.startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(false)
    expect(existsSync(path.join(dir, 'e2e-profile.json'))).toBe(true)
  }
  finally {
    await removeProfile(dir)
  }
})

test('正常清理會移除該次 profile', async () => {
  const dir = await createProfile('moorread-e2e-', 'e2e/profile-root-guard.spec.ts')
  expect(existsSync(dir)).toBe(true)
  await removeProfile(dir)
  expect(existsSync(dir)).toBe(false)
})

test('根目錄指向共用 TEMP（或其子目錄）時拒絕', async () => {
  const tempRoot = path.resolve(os.tmpdir())
  await expect(withRoot(tempRoot, () => resolveProfileRoot()))
    .rejects
    .toThrow(/不得等於 TEMP/)
  await expect(withRoot(path.join(tempRoot, 'moorread-e2e-profiles'), () => resolveProfileRoot()))
    .rejects
    .toThrow(/不得位於 TEMP 之內/)
  await expect(withRoot(path.dirname(tempRoot), () => resolveProfileRoot()))
    .rejects
    .toThrow(/不得是 TEMP 的上層|必須位於專案目錄內/)
})

test('含 .. 的跳脫路徑與專案外的絕對路徑都被拒絕', async () => {
  const base = path.join(projectRoot, 'test-temp')
  const escape = `${base}${path.sep}..${path.sep}..${path.sep}escape`
  await expect(withRoot(escape, () => resolveProfileRoot()))
    .rejects
    .toThrow(/含 \.\. 跳脫/)

  await expect(withRoot(path.join(path.dirname(projectRoot), 'outside-root'), () => resolveProfileRoot()))
    .rejects
    .toThrow(/必須位於專案目錄內|必須位於專案的 test-temp 之下/)
})

test('清理範圍邊界：拒絕根目錄本身與根目錄外的資料', async () => {
  const root = await resolveProfileRoot()
  await expect(removeProfile(root)).rejects.toThrow(/拒絕清理 profile 根目錄本身/)

  const outside = path.join(projectRoot, 'test-temp', `outside-${Date.now()}`)
  await mkdir(outside, { recursive: true })
  try {
    await expect(removeProfile(outside)).rejects.toThrow(/拒絕清理根目錄之外的資料/)
  }
  finally {
    await rm(outside, { recursive: true, force: true })
  }

  // 不存在視為已清理，不應拋錯（但也不會被誤導為清理成功）
  await expect(removeProfile(path.join(root, 'moorread-e2e-does-not-exist'))).resolves.toBeUndefined()
})

interface JunctionFixture {
  link: string
  target: string
  resolvable: boolean
}

// 測試資料全部建立在專案內：目標目錄在 test-temp 下、連結位於 profile 根目錄內並指向根目錄外。
async function createJunctionFixture(label: string): Promise<JunctionFixture> {
  const target = await mkdtemp(path.join(projectRoot, 'test-temp', `junction-target-${label}-`))
  await writeFile(path.join(target, 'sentinel.txt'), 'moorread-121-target')
  await mkdir(path.join(target, 'sub'), { recursive: true })
  await writeFile(path.join(target, 'sub', 'keep.txt'), 'must-stay')
  const root = await resolveProfileRoot()
  const link = path.join(root, `${PROFILE_PREFIX}junction-${label}-${Date.now()}`)
  await symlink(target, link, 'junction')
  let resolvable = false
  try {
    resolvable = path.resolve(await realpath(link)) === path.resolve(target)
  }
  catch {
    resolvable = false
  }
  return { link, target, resolvable }
}

// 只移除連結本身，絕不遞迴刪除目標。
async function disposeJunctionFixture(fixture: JunctionFixture) {
  await unlink(fixture.link).catch(() => rmdir(fixture.link).catch(() => undefined))
  await rm(fixture.target, { recursive: true, force: true })
}

// 未實際執行的案例必須是 skipped，不能只加 annotation 後 return：
// Playwright 會把「自行 return 的測試」計為 passed，導致 BLOCKED 被算成 PASS。
function skipBlocked(caseName: string, detail: string) {
  const message = `${caseName}：${detail}，標記 BLOCKED（未實際執行，不計入 PASS）`
  test.info().annotations.push({ type: 'BLOCKED', description: message })
  console.log(`[BLOCKED] ${message}`)
  test.skip(true, message)
}

function markBlockedIfUnresolvable(fixture: JunctionFixture, caseName: string) {
  if (fixture.resolvable)
    return false
  skipBlocked(caseName, '本環境無法建立可解析的 Windows Junction（realpath 失敗）')
  return true
}

test('Junction 作為 profile 根目錄時被拒絕', async () => {
  const fixture = await createJunctionFixture('root')
  try {
    if (markBlockedIfUnresolvable(fixture, 'Junction 作為 profile 根目錄'))
      return
    await expect(withRoot(fixture.link, () => resolveProfileRoot()))
      .rejects
      .toThrow(/指向連結或重新導向|必須位於專案目錄內/)
  }
  finally {
    await disposeJunctionFixture(fixture)
  }
})

test('removeProfile 拒絕清理連結本身，且不穿透目標', async () => {
  const fixture = await createJunctionFixture('clean')
  try {
    if (markBlockedIfUnresolvable(fixture, 'removeProfile 清理連結'))
      return
    await expect(removeProfile(fixture.link))
      .rejects
      .toThrow(/拒絕清理根目錄之外的資料|無法解析 profile 實際路徑/)
    expect(existsSync(path.join(fixture.target, 'sentinel.txt'))).toBe(true)
    expect(existsSync(path.join(fixture.target, 'sub', 'keep.txt'))).toBe(true)
  }
  finally {
    await disposeJunctionFixture(fixture)
  }
})

test('pruneStaleProfiles 不會穿透超過 2 小時的舊連結', async () => {
  const fixture = await createJunctionFixture('prune')
  try {
    if (markBlockedIfUnresolvable(fixture, 'pruneStaleProfiles 舊連結'))
      return
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
    await utimes(fixture.link, old, old)
    // 核心不變量：不論 prune 拋錯或略過，都不能刪到連結目標內的任何資料。
    await pruneStaleProfiles().catch(() => undefined)
    expect(existsSync(path.join(fixture.target, 'sentinel.txt'))).toBe(true)
    expect(existsSync(path.join(fixture.target, 'sub', 'keep.txt'))).toBe(true)
  }
  finally {
    await disposeJunctionFixture(fixture)
  }
})

test('dangling junction 應被拒絕而非視為可建立', async () => {
  const root = await resolveProfileRoot()
  const link = path.join(root, `${PROFILE_PREFIX}dangling-${Date.now()}`)
  const missing = path.join(projectRoot, 'test-temp', `missing-target-${Date.now()}`)
  try {
    await symlink(missing, link, 'junction')
  }
  catch (error) {
    skipBlocked('dangling junction', `Windows 不允許建立指向不存在目標的目錄連結（${String(error)}）`)
    return
  }
  try {
    // 只有在「連結可見（lstat 成功）且確實無法解析（realpath 失敗）」時才具備驗證條件。
    let visible = false
    try {
      await lstat(link)
      visible = true
    }
    catch {
      visible = false
    }
    let resolvable = false
    try {
      await realpath(link)
      resolvable = true
    }
    catch {
      resolvable = false
    }
    if (!visible || resolvable) {
      skipBlocked('dangling junction', `本環境無法穩定建立失效連結（visible=${visible}, resolvable=${resolvable}）`)
      return
    }
    await expect(withRoot(link, () => resolveProfileRoot()))
      .rejects
      .toThrow(/指向連結或重新導向|無法解析 E2E profile 根目錄|無法解析但實際存在|必須位於專案目錄內/)
  }
  finally {
    await unlink(link).catch(() => rmdir(link))
  }
})

test('清理失敗必須是可見錯誤，而不是靜默成功', async () => {
  const dir = await createProfile(`${PROFILE_PREFIX}locked-`, 'e2e/profile-root-guard.spec.ts')
  // 已驗證的可控注入：讓子程序以 profile 內的子目錄為工作目錄，
  // Windows 會以 EBUSY 拒絕刪除，藉此製造可重現的清理失敗。
  const held = path.join(dir, 'held')
  await mkdir(held, { recursive: true })
  await writeFile(path.join(held, 'sentinel.txt'), 'e2e-busy-cwd')
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
    cwd: held,
    stdio: 'ignore',
    windowsHide: true,
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve())
    child.once('error', reject)
  })
  let threw = false
  let message = ''
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', reject)
    })
    await removeProfile(dir)
  }
  catch (error) {
    threw = true
    message = String(error)
  }
  finally {
    child.kill()
    await exited
  }
  // 清理失敗必須是可見錯誤，且目標資料必須完整保留（不得靜默成功、不得半刪）。
  expect(threw).toBe(true)
  expect(message).toMatch(/E2E profile 清理失敗/)
  expect(existsSync(held)).toBe(true)
  expect(existsSync(path.join(held, 'sentinel.txt'))).toBe(true)
  await removeProfile(dir)
  expect(existsSync(dir)).toBe(false)
})
