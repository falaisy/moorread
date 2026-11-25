import {
  decryptMetadataText,
  encryptMetadataText,
  isEncryptedMetadataEnvelope,
} from './metadata-crypto'

export const GIST_API_BASE = 'https://api.github.com'
export const GIST_FILENAME = 'moorread-backup.json'

export interface GistBackupConfig {
  /** GitHub personal access token（需有 gist scope） */
  token: string
  /** 既有 gist 識別碼；留空時 uploadToGist 會建立新的 */
  gistId?: string
  /** 是否在上傳前於本機加密 */
  encrypt: boolean
  /** 加密/解密密碼；encrypt 為 true 時必填 */
  passphrase?: string
}

export type GistErrorCode = 'token' | 'api' | 'decrypt' | 'empty'

class GistBackupError extends Error {
  constructor(public code: GistErrorCode, message?: string) {
    super(message ?? `gist.${code}`)
  }
}

export function gistErrorCode(error: unknown): GistErrorCode {
  return error instanceof GistBackupError ? error.code : 'api'
}

async function gistRequest(
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Response> {
  const response = await fetch(`${GIST_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new GistBackupError(
      'api',
      `GitHub ${response.status} ${response.statusText}`,
    )
  }
  return response
}

/**
 * 上傳（或建立）備份到 GitHub Gist。
 * - 既有 gistId：PATCH 更新
 * - 無 gistId：POST 新建
 * 回傳最終的 gistId。
 */
export async function uploadToGist(
  config: GistBackupConfig,
  data: string,
): Promise<string> {
  if (!config.token.trim())
    throw new GistBackupError('token')

  let payloadContent: string
  if (config.encrypt) {
    if (!config.passphrase?.trim())
      throw new GistBackupError('token', 'passphrase required for encryption')
    const envelope = await encryptMetadataText({
      plaintext: data,
      passphrase: config.passphrase,
      updatedAt: Date.now(),
      deviceId: '',
    })
    payloadContent = JSON.stringify(envelope)
  }
  else {
    payloadContent = data
  }

  const body = {
    description: 'Moorread backup',
    public: false,
    files: {
      [GIST_FILENAME]: {
        content: payloadContent,
        type: 'application/json',
      },
    },
  }

  if (config.gistId?.trim()) {
    const response = await gistRequest(
      config.token,
      'PATCH',
      `/gists/${config.gistId}`,
      body,
    )
    const result = await response.json() as { id?: string }
    if (!result.id)
      throw new GistBackupError('api', 'GitHub response missing gist id')
    return result.id
  }

  const response = await gistRequest(config.token, 'POST', '/gists', body)
  const result = await response.json() as { id?: string }
  if (!result.id)
    throw new GistBackupError('api', 'GitHub response missing gist id')
  return result.id
}

/**
 * 從既有 gist 讀取備份內容。
 * - 自動偵測是否本機加密（檢查 EncryptedMetadataEnvelope 結構）
 * - 加密時需要 config.passphrase
 * 回傳解密後（或未加密的）原始 JSON 字串。
 */
export async function downloadFromGist(
  config: GistBackupConfig,
): Promise<string> {
  if (!config.token.trim())
    throw new GistBackupError('token')
  if (!config.gistId?.trim())
    throw new GistBackupError('api', 'gistId is required to download')

  const response = await gistRequest(
    config.token,
    'GET',
    `/gists/${config.gistId}`,
  )
  const result = await response.json() as {
    files?: Record<string, { content?: string }>
  }
  const files = result.files
  if (!files)
    throw new GistBackupError('empty', 'gist has no files')

  const fileKey = Object.keys(files).find(key => key === GIST_FILENAME)
    ?? Object.keys(files)[0]
  const raw = files[fileKey]?.content
  if (!raw)
    throw new GistBackupError('empty', 'gist file is empty')

  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch {
    // 可能是未加密的純文字 JSON；直接回傳原 raw
    return raw
  }

  if (isEncryptedMetadataEnvelope(value)) {
    if (!config.passphrase?.trim())
      throw new GistBackupError('decrypt', 'passphrase required for encrypted gist')
    try {
      return await decryptMetadataText(value, config.passphrase)
    }
    catch {
      throw new GistBackupError('decrypt')
    }
  }

  return raw
}

/**
 * 測試 token 是否有效（不實際寫入）。
 * 用 GET /gists 列出當前使用者的 gist，驗證 token 權限。
 */
export async function testGistToken(token: string): Promise<void> {
  if (!token.trim())
    throw new GistBackupError('token')
  await gistRequest(token, 'GET', '/gists?per_page=1')
}
