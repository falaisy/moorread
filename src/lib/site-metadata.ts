import { LocalizedError } from './localized-error'

export interface SiteMetadata {
  name?: string
  description?: string
  icon?: string
}

const META_TIMEOUT_MS = 10_000
const META_RETRY_DELAY_MS = 400

interface SiteDocument {
  document: Document
  finalUrl: string
}

function content(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = document
      .querySelector<HTMLMetaElement>(selector)
      ?.content
      .trim()
    if (value)
      return value
  }
}

function resolveIcon(document: Document, pageUrl: string): string | undefined {
  const links = document.querySelectorAll<HTMLLinkElement>(
    'link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]',
  )

  for (const link of links) {
    const href = link.getAttribute('href')?.trim()
    if (!href)
      continue
    try {
      const icon = new URL(href, pageUrl)
      if (icon.protocol === 'http:' || icon.protocol === 'https:') {
        return icon.toString()
      }
    }
    catch {
      // 跳过无效图标地址，继续尝试下一个候选项
    }
  }

  try {
    return new URL('/favicon.ico', pageUrl).toString()
  }
  catch {
    return undefined
  }
}

function description(document: Document): string | undefined {
  return content(document, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]',
    'meta[itemprop="description"]',
  ])
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}

// 4xx 代表站点明确拒绝（权限、防盗链等），重试没有意义；超时已等满 10 秒也不重试；
// 其余情况（网络抖动、5xx）重试一次通常能救回来。
function isRetryableSiteError(error: unknown): boolean {
  if (!(error instanceof LocalizedError))
    return true
  // 超时已经等满 10 秒，再试一次只会让整批补全卡更久。
  if (error.messageKey === 'runtimeSiteRequestTimeout')
    return false
  if (error.messageKey !== 'runtimeSiteHttpError')
    return true
  const status = Number(error.params?.status)
  return !Number.isFinite(status) || status >= 500 || status === 408 || status === 429
}

async function fetchSiteDocument(url: string): Promise<SiteDocument> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    META_TIMEOUT_MS,
  )

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new LocalizedError('runtimeSiteHttpError', {
        status: response.status,
        url,
      })
    }

    const html = await response.text()
    return {
      document: new DOMParser().parseFromString(html, 'text/html'),
      finalUrl: response.url || url,
    }
  }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new LocalizedError('runtimeSiteRequestTimeout')
    }
    throw error
  }
  finally {
    globalThis.clearTimeout(timeout)
  }
}

/** 只抓取网页描述，供缺失描述的后台补全队列使用。 */
export async function fetchSiteDescription(
  url: string,
  retries = 1,
): Promise<string | undefined> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const site = await fetchSiteDocument(url)
      return description(site.document)
    }
    catch (error) {
      lastError = error
      if (attempt >= retries || !isRetryableSiteError(error)) {
        // 把 URL 附加到 error cause，供上层记录，方便使用者看到哪些站失败
        const cause: any = error
        cause.siteUrl = url
        throw error
      }
      await delay(META_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

/** 抓取网页 HTML，并从标准 meta/link 标签提取站点信息。 */
export async function fetchSiteMetadata(url: string): Promise<SiteMetadata> {
  const site = await fetchSiteDocument(url)

  return {
    name:
      content(site.document, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
      ])
      ?? (site.document.title.trim() || undefined),
    description: description(site.document),
    icon: resolveIcon(site.document, site.finalUrl),
  }
}
