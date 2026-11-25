import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

// 所有 E2E profile 都建在專案專用根目錄（<project>/test-temp/e2e-profiles），
// 並在建立時寫入可辨識標記：正常結束時由 removeProfile() 刪除；
// 若程序被強制中止，殘留目錄仍帶標記，可依「標記＋無 lock＋無程序佔用＋年齡」辨識。
export const PROFILE_MARKER = 'e2e-profile.json'
export const PROFILE_PREFIX = 'moorread-e2e-'
export const PROFILE_ROOT_SEGMENTS = ['test-temp', 'e2e-profiles']

export class ProfileRootError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileRootError'
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function rawRoot(): string {
  const fromEnv = process.env.MOORREAD_E2E_PROFILE_ROOT
  return fromEnv && fromEnv.trim().length > 0
    ? fromEnv
    : path.join(process.cwd(), ...PROFILE_ROOT_SEGMENTS)
}

function hasParentSegment(value: string) {
  return value.split(/[\\/]+/).includes('..')
}

async function realOrSelf(value: string) {
  const resolved = path.resolve(value)
  if (existsSync(resolved))
    return realpath(resolved)
  return resolved
}

// 硬性防護：以實際路徑（realpath）判定，不依賴環境變數本身或檔名前綴。
export async function resolveProfileRoot(): Promise<string> {
  const raw = rawRoot()
  if (!raw || raw.trim().length === 0)
    throw new ProfileRootError('E2E profile 根目錄為空，拒絕使用')
  if (!path.isAbsolute(raw))
    throw new ProfileRootError(`E2E profile 根目錄必須是絕對路徑：${raw}`)
  if (hasParentSegment(raw))
    throw new ProfileRootError(`E2E profile 根目錄含 .. 跳脫：${raw}`)

  const projectRoot = await realpath(process.cwd())
  const tempRoots = new Set<string>()
  for (const candidate of [os.tmpdir(), process.env.TEMP, process.env.TMP]) {
    if (candidate && candidate.trim().length > 0)
      tempRoots.add(await realOrSelf(candidate))
  }
  if (process.env.SystemRoot)
    tempRoots.add(path.join(process.env.SystemRoot, 'Temp'))

  const root = path.resolve(raw)
  const parsed = path.parse(root)
  if (root === parsed.root || root === parsed.root.replace(/\\$/, ''))
    throw new ProfileRootError(`E2E profile 根目錄不得是磁碟根目錄：${root}`)

  // 以實際路徑判定：junction／symlink 會讓 realpath 與字面路徑不同，直接拒絕。
  // （Windows 上 junction 不一定會被 lstat().isSymbolicLink() 辨識，故不可只依賴該判斷。）
  let effective = root
  let realRoot: string | undefined
  try {
    realRoot = path.resolve(await realpath(root))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new ProfileRootError(`無法解析 E2E profile 根目錄，拒絕使用：${root}（${String(error)}）`)
    // ENOENT 但路徑本身存在（例如 dangling junction／已刪除目標的連結）→ 不可視為「稍後建立」。
    try {
      await lstat(root)
      throw new ProfileRootError(`E2E profile 根目錄無法解析但實際存在（可能為失效連結）：${root}`)
    }
    catch (lstatError) {
      if (lstatError instanceof ProfileRootError)
        throw lstatError
      if ((lstatError as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new ProfileRootError(`無法確認 E2E profile 根目錄狀態，拒絕使用：${root}（${String(lstatError)}）`)
    }
  }
  if (realRoot !== undefined) {
    if (realRoot !== root)
      throw new ProfileRootError(`E2E profile 根目錄指向連結或重新導向：${root} -> ${realRoot}`)
    effective = realRoot
  }

  for (const temp of tempRoots) {
    if (effective === temp)
      throw new ProfileRootError(`E2E profile 根目錄不得等於 TEMP：${effective}`)
    if (effective.startsWith(temp + path.sep))
      throw new ProfileRootError(`E2E profile 根目錄不得位於 TEMP 之內：${effective}`)
    if (temp.startsWith(effective + path.sep))
      throw new ProfileRootError(`E2E profile 根目錄不得是 TEMP 的上層：${effective}`)
  }

  // 路徑上每一層都不得是連結，且必須實際落在專案目錄之內。
  let cursor = root
  while (cursor && cursor !== parsed.root) {
    if (existsSync(cursor)) {
      const info = await lstat(cursor)
      if (info.isSymbolicLink())
        throw new ProfileRootError(`E2E profile 根目錄路徑含連結：${cursor}`)
    }
    cursor = path.dirname(cursor)
  }

  if (!effective.startsWith(projectRoot + path.sep))
    throw new ProfileRootError(`E2E profile 根目錄必須位於專案目錄內：${effective}`)
  if (!effective.startsWith(path.join(projectRoot, PROFILE_ROOT_SEGMENTS[0]) + path.sep))
    throw new ProfileRootError(`E2E profile 根目錄必須位於專案的 test-temp 之下：${effective}`)

  return effective
}

export async function ensureProfileRoot(): Promise<string> {
  const root = await resolveProfileRoot()
  await mkdir(root, { recursive: true })
  const real = await realpath(root)
  const projectRoot = await realpath(process.cwd())
  if (!real.startsWith(projectRoot + path.sep))
    throw new ProfileRootError(`E2E profile 根目錄解析後逃逸專案：${real}`)
  return real
}

export async function createProfile(label: string, owner: string): Promise<string> {
  const root = await ensureProfileRoot()
  const dir = await mkdtemp(path.join(root, label))
  await writeFile(
    path.join(dir, PROFILE_MARKER),
    JSON.stringify(
      {
        purpose: 'moorread-e2e',
        owner,
        pid: process.pid,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  return dir
}

export async function pruneStaleProfiles(maxAgeMs = 2 * 60 * 60 * 1000): Promise<void> {
  const root = await ensureProfileRoot()
  const { readdir, stat } = await import('node:fs/promises')
  const entries = await readdir(root, { withFileTypes: true })
  const cutoff = Date.now() - maxAgeMs
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(PROFILE_PREFIX))
      continue
    const target = path.join(root, entry.name)
    const info = await stat(target).catch(() => undefined)
    if (info && info.mtimeMs < cutoff)
      await removeProfile(target)
  }
}

// 清理前再次以 realpath 驗證：必須嚴格位於根目錄之下，且不得是根目錄本身。
export async function removeProfile(dir: string, releaseTimeoutMs = 15_000): Promise<void> {
  const root = await ensureProfileRoot()
  if (!dir || dir.trim().length === 0)
    throw new ProfileRootError('拒絕清理空的 profile 路徑')

  let target: string
  try {
    target = await realpath(dir)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return
    throw new ProfileRootError(`無法解析 profile 實際路徑，拒絕清理：${dir}（${String(error)}）`)
  }

  if (target === root)
    throw new ProfileRootError(`拒絕清理 profile 根目錄本身：${target}`)
  if (!target.startsWith(root + path.sep))
    throw new ProfileRootError(`拒絕清理根目錄之外的資料：${target}`)
  if (!path.basename(target).startsWith(PROFILE_PREFIX))
    throw new ProfileRootError(`拒絕清理非 moorread-e2e- 前綴的資料：${target}`)

  const deadline = Date.now() + releaseTimeoutMs
  while (Date.now() < deadline) {
    const locked = existsSync(path.join(target, 'SingletonLock'))
      || existsSync(path.join(target, 'lockfile'))
    if (!locked)
      break
    await delay(100)
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    }
    catch (error) {
      lastError = error
      await delay(200 * attempt)
    }
  }
  throw new Error(`E2E profile 清理失敗（目錄保留於 ${target}）：${String(lastError)}`)
}
