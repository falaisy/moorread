/**
 * 本機字體：只偵測與呼叫使用者電腦已安裝的字體，不打包、不散布任何字體檔。
 * 選單只列出實際偵測到的家族，避免出現「選了卻沒效果」的選項。
 */

import type { AppearanceFontWeight } from './types'

export const FONT_WEIGHT_VALUES: Record<AppearanceFontWeight, number> = {
  regular: 400,
  medium: 500,
  bold: 700,
}

export interface FontOption {
  /** 顯示名稱 */
  label: string
  /** 寫進設定的值：主要 CSS 家族名稱 */
  family: string
  /** 偵測與套用時使用的別名，第一個為主要名稱 */
  aliases: string[]
}

/** 使用者沒選字體時沿用的系統堆疊。 */
export const DEFAULT_FONT_STACK
  = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", var(--cjk-sans), sans-serif'

export const FONT_CATALOG: FontOption[] = [
  // 繁體中文系統字體
  {
    label: '微軟正黑體',
    family: 'Microsoft JhengHei',
    aliases: ['Microsoft JhengHei', '微軟正黑體'],
  },
  {
    label: '新細明體',
    family: 'PMingLiU',
    aliases: ['PMingLiU', '新細明體'],
  },
  {
    label: '標楷體',
    family: 'DFKai-SB',
    aliases: ['DFKai-SB', '標楷體'],
  },
  {
    label: '蘋方 TC',
    family: 'PingFang TC',
    aliases: ['PingFang TC', '蘋方-繁'],
  },
  // 簡體中文系統字體（繁體字覆蓋不完整，僅供參考）
  {
    label: '微軟雅黑',
    family: 'Microsoft YaHei',
    aliases: ['Microsoft YaHei', '微软雅黑'],
  },
  {
    label: '宋體',
    family: 'SimSun',
    aliases: ['SimSun', '宋体'],
  },
  {
    label: '黑體',
    family: 'SimHei',
    aliases: ['SimHei', '黑体'],
  },
  {
    label: '楷體',
    family: 'KaiTi',
    aliases: ['KaiTi', '楷体'],
  },
  {
    label: '等線',
    family: 'DengXian',
    aliases: ['DengXian', '等线'],
  },
  {
    label: '蘋方 SC',
    family: 'PingFang SC',
    aliases: ['PingFang SC', '苹方-简'],
  },
  {
    label: '華文黑體',
    family: 'STHeiti',
    aliases: ['STHeiti', '华文黑体'],
  },
  // 開源字體（OFL）
  {
    label: '思源黑體',
    family: 'Source Han Sans TC',
    aliases: [
      'Source Han Sans TC',
      'Source Han Sans Traditional Chinese',
      'Noto Sans TC',
      'Noto Sans CJK TC',
      '思源黑體',
    ],
  },
  {
    label: '思源宋體',
    family: 'Source Han Serif TC',
    aliases: [
      'Source Han Serif TC',
      'Source Han Serif Traditional Chinese',
      'Noto Serif TC',
      'Noto Serif CJK TC',
      '思源宋體',
    ],
  },
  {
    label: '霞鶩文楷',
    family: 'LXGW WenKai',
    aliases: ['LXGW WenKai', 'LXGW WenKai TC', '霞鶩文楷', '霞鹜文楷'],
  },
  {
    label: '得意黑',
    family: 'Smiley Sans',
    aliases: ['Smiley Sans', 'Smiley Sans Oblique', '得意黑'],
  },
  {
    label: '芫荽',
    family: 'Iansui',
    aliases: ['Iansui', '芫荽'],
  },
  {
    label: 'jf open 粉圓',
    family: 'jf-openhuninn',
    aliases: ['jf-openhuninn', 'jf open 粉圓'],
  },
  // 廠商免費商用字體
  {
    label: 'MiSans',
    family: 'MiSans',
    aliases: ['MiSans'],
  },
  {
    label: 'HarmonyOS Sans',
    family: 'HarmonyOS Sans SC',
    aliases: ['HarmonyOS Sans SC', 'HarmonyOS Sans TC', 'HarmonyOS Sans'],
  },
  {
    label: '阿里巴巴普惠體',
    family: 'Alibaba PuHuiTi 3.0',
    aliases: ['Alibaba PuHuiTi 3.0', 'Alibaba PuHuiTi', '阿里巴巴普惠体'],
  },
  {
    label: 'OPPO Sans',
    family: 'OPPO Sans',
    aliases: ['OPPO Sans', 'OPPO Sans 3.0'],
  },
]

/** 以 canvas 量測字寬；字體不存在時會落回 monospace，寬度便與基準相同。 */
export type TextMeasurer = (fontSpec: string, text: string) => number

const SAMPLE_TEXT = 'mmmmmmmmmmlliWWWWW書野測試字體0123456789'

function quoteFamily(family: string): string {
  return `"${family.replace(/"/g, '')}"`
}

export function isFontAvailable(
  family: string,
  measure: TextMeasurer,
): boolean {
  const fallbackWidth = measure('72px monospace', SAMPLE_TEXT)
  const width = measure(`72px ${quoteFamily(family)}, monospace`, SAMPLE_TEXT)
  return width !== fallbackWidth
}

function createCanvasMeasurer(): TextMeasurer | null {
  if (typeof document === 'undefined')
    return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context)
    return null
  return (fontSpec, text) => {
    context.font = fontSpec
    return context.measureText(text).width
  }
}

export function detectAvailableFonts(
  catalog: FontOption[] = FONT_CATALOG,
  measure: TextMeasurer | null = createCanvasMeasurer(),
): FontOption[] {
  if (!measure)
    return []
  return catalog.filter(font =>
    font.aliases.some(alias => isFontAvailable(alias, measure)),
  )
}

/** 產生可套用到 CSS 的家族堆疊；找不到目錄資料時仍以單一家族名套用。 */
export function resolveFontStack(family: string): string | null {
  const name = family.trim()
  if (!name)
    return null
  const option = FONT_CATALOG.find(
    entry => entry.family === name || entry.aliases.includes(name),
  )
  const families = option ? option.aliases : [name]
  const stack = families.map(quoteFamily).join(', ')
  return `${stack}, ${DEFAULT_FONT_STACK}`
}
