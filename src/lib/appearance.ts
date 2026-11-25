import type {
  AccentColor,
  AppearanceFontWeight,
  AppearanceSettings,
  BackgroundStyle,
  CardFieldSettings,
  CardStyle,
  ColorTheme,
  ContentWidth,
  DescriptionLineCount,
  GridDensity,
  HomeLayout,
  NavItemSettings,
  NavLayout,
  TitleLineCount,
} from './types'

const NAV_LAYOUTS: NavLayout[] = ['sidebar', 'top']
const HOME_LAYOUTS: HomeLayout[] = ['workspace', 'centered']
const CONTENT_WIDTHS: ContentWidth[] = ['standard', 'wide', 'full']
const GRID_DENSITIES: GridDensity[] = ['comfortable', 'dense']
const CARD_STYLES: CardStyle[] = ['soft', 'outline', 'plain']
const ACCENT_COLORS: AccentColor[] = [
  'neutral',
  'blue',
  'green',
  'orange',
  'rose',
]
const COLOR_THEMES: ColorTheme[] = [
  'default',
  'graphite',
  'meadow',
  'dawn',
  'berry',
  'sky',
]
const BACKGROUND_STYLES: BackgroundStyle[] = ['flat', 'subtle', 'panel']
const FONT_WEIGHTS: AppearanceFontWeight[] = ['regular', 'medium', 'bold']

export const SIDEBAR_WIDTH_MIN = 192
export const SIDEBAR_WIDTH_DEFAULT = 232
export const SIDEBAR_WIDTH_MAX = 384
export const SIDEBAR_WIDTH_COLLAPSED = 56

export const DEFAULT_CARD_FIELDS: CardFieldSettings = {
  websiteIcon: true,
  description: true,
  tags: true,
  categoryPath: true,
  categoryCards: true,
  actions: 'hover',
  titleLines: 1,
  descriptionLines: 2,
  maxVisibleTags: 3,
}

export const DEFAULT_NAV_ITEMS: NavItemSettings = {
  icons: true,
  counts: true,
  smartCategories: true,
  savedSearches: false,
  categoryTree: true,
}

export const BALANCED_APPEARANCE_SETTINGS: AppearanceSettings = {
  navLayout: 'sidebar',
  homeLayout: 'workspace',
  contentWidth: 'wide',
  gridDensity: 'comfortable',
  cardSize: 'comfortable',
  cardHeight: 80,
  gridCols: 4,
  bookmarkGridCols: 0,
  folderGridCols: 0,
  cardStyle: 'soft',
  iconSize: 48,
  radius: 12,
  accentColor: 'neutral',
  colorTheme: 'default',
  fontSizeScale: 0,
  backgroundStyle: 'flat',
  fontFamily: '',
  fontWeight: 'regular',
  navItems: DEFAULT_NAV_ITEMS,
  cardFields: DEFAULT_CARD_FIELDS,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: false,
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  ...BALANCED_APPEARANCE_SETTINGS,
  homeLayout: 'centered',
  iconSize: 52,
  radius: 8,
  colorTheme: 'sky',
}

export const contentWidthClass: Record<ContentWidth, string> = {
  standard: 'mx-auto max-w-[1200px]',
  wide: 'mx-auto max-w-[1440px]',
  full: 'w-full',
}

// gridCols → Tailwind 完整 class 字串（寫死，否則 JIT 掃不到動態拼接）
const GRID_CLASS_BY_COLS: Record<number, string> = {
  1: 'grid grid-cols-1 gap-5',
  2: 'grid grid-cols-1 gap-5 sm:grid-cols-2',
  3: 'grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  6: 'grid grid-cols-1 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
  7: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7',
  8: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8',
}

// compact 模式：沿用相同斷點，但用更小的 gap 提高密度（不再固定 2 欄）
const COMPACT_GRID_CLASS_BY_COLS: Record<number, string> = {
  1: 'grid grid-cols-1 gap-2',
  2: 'grid grid-cols-1 gap-2 xl:grid-cols-2',
  3: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
  6: 'grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6',
  7: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7',
  8: 'grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8',
}

/** 自動欄數的預覽／fallback：沿用目前 4 欄的響應式組合。 */
export const AUTO_GRID_COLS = 4

function normalizeGridColsValue(cols: number): number {
  return Number.isFinite(cols) && cols >= 1 && cols <= 8 ? Math.floor(cols) : 0
}

// 根據每列欄數（0 = 自動）返回 grid class；compact 使用高密度 gap
export function gridClass(cols: number, compact: boolean): string {
  const normalized = normalizeGridColsValue(cols)
  const table = compact ? COMPACT_GRID_CLASS_BY_COLS : GRID_CLASS_BY_COLS
  if (normalized === 0)
    return compact ? COMPACT_GRID_CLASS_BY_COLS[2] : GRID_CLASS_BY_COLS[AUTO_GRID_COLS]
  return table[normalized] ?? table[AUTO_GRID_COLS]
}

export const cardStyleClass: Record<CardStyle, string> = {
  soft: 'border border-border/65 bg-card/95 shadow-card-soft hover:border-border hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200',
  outline: 'border border-border/80 bg-card hover:border-foreground/20 hover:bg-accent/30 hover:-translate-y-0.5 hover:shadow-xs transition-all duration-200',
  plain: 'bg-card hover:bg-accent/40 hover:-translate-y-0.5 hover:shadow-xs transition-all duration-200',
}

// Shared by ordinary bookmarks and bookmark groups.
export const cardContainerClass = 'group relative overflow-hidden [content-visibility:auto] transition-[background-color,border-color,box-shadow,transform] duration-200 focus-within:ring-1 focus-within:ring-ring/70'

// 根據 cardHeight 動態生成卡片尺寸（px）
export function cardSizeStyle(height: number, compact: boolean): React.CSSProperties {
  return {
    minHeight: compact ? '48px' : `${height}px`,
  }
}

// cardContentClass：查表取代動態拼接（Tailwind JIT 靜態預掃描）
const CARD_CONTENT_CLASS_BY_HEIGHT: Record<string, string> = {
  '60-n': 'px-3.5 py-[8px] gap-2',
  '60-c': 'px-3 py-[6px] gap-2',
  '65-n': 'px-3.5 py-[8px] gap-2',
  '65-c': 'px-3 py-[7px] gap-2',
  '70-n': 'px-3.5 py-[9px] gap-3',
  '70-c': 'px-3 py-[8px] gap-2',
  '75-n': 'px-3.5 py-[9px] gap-3',
  '75-c': 'px-3 py-[8px] gap-2',
  '80-n': 'px-3.5 py-[10px] gap-3',
  '80-c': 'px-3 py-[9px] gap-3',
  '85-n': 'px-4 py-[11px] gap-3',
  '85-c': 'px-3 py-[9px] gap-3',
  '90-n': 'px-4 py-[11px] gap-3',
  '90-c': 'px-3 py-[10px] gap-3',
  '95-n': 'px-4 py-[12px] gap-4',
  '95-c': 'px-3 py-[10px] gap-3',
  '100-n': 'px-4 py-[13px] gap-4',
  '100-c': 'px-3 py-[11px] gap-3',
  '105-n': 'px-4 py-[13px] gap-4',
  '105-c': 'px-3 py-[11px] gap-3',
  '110-n': 'px-5 py-[14px] gap-4',
  '110-c': 'px-3 py-[12px] gap-4',
  '115-n': 'px-5 py-[14px] gap-4',
  '115-c': 'px-3 py-[12px] gap-4',
  '120-n': 'px-5 py-[15px] gap-5',
  '120-c': 'px-3 py-[13px] gap-4',
  '125-n': 'px-5 py-[16px] gap-5',
  '125-c': 'px-3 py-[13px] gap-4',
  '130-n': 'px-5 py-[16px] gap-5',
  '130-c': 'px-3 py-[14px] gap-4',
  '135-n': 'px-5 py-[17px] gap-5',
  '135-c': 'px-3 py-[14px] gap-4',
  '140-n': 'px-5 py-[18px] gap-5',
  '140-c': 'px-3 py-[15px] gap-4',
}
export function cardContentClass(height: number, compact: boolean): string {
  if (compact)
    return 'px-3 py-1.5 gap-2'
  const key = `${height}-${compact ? 'c' : 'n'}`
  return CARD_CONTENT_CLASS_BY_HEIGHT[key] ?? 'px-4 py-[10px] gap-3'
}

// 根據 cardHeight 推薦 iconSize（自動聯動）
export function recommendedIconSize(height: number): number {
  if (height <= 70)
    return 36
  if (height <= 90)
    return 44
  if (height <= 110)
    return 52
  if (height <= 130)
    return 60
  return 68
}
export const cardTitleClass = 'bookmark-card-title text-card-title font-medium leading-snug tracking-[-0.01em] text-foreground group-hover:text-primary transition-colors'
// 精簡列表次要欄：固定寬度讓不同長度的資料仍對齊，內容以省略號收斂
export const compactSecondaryClass = 'w-24 shrink-0 truncate pr-2 text-right text-xs text-muted-foreground'
// 精簡卡片的容器查詢外殼：依卡片實際寬度決定次欄顯示（見 main.css）
export const compactCardShellClass = 'compact-card-shell'
export const cardActionsClass = 'absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/50 bg-card/90 p-0.5 shadow-xs backdrop-blur-xs opacity-70 transition-all duration-150'
export const cardActionsHoverClass = 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100'
export const cardActionButtonClass = 'flex size-6 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export const backgroundStyleClass: Record<BackgroundStyle, string> = {
  flat: 'bg-background',
  subtle:
    'bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,hsl(var(--accent)/0.6),hsl(var(--background)))]',
  panel: 'bg-muted/30',
}

// radius px → Tailwind class（寫死且為精確像素，JIT 才掃得到；
// 不可使用 rounded-md/rounded-lg，那些 Token 會隨 --radius 加減 2px／4px）
const RADIUS_CLASS_BY_PX: Record<number, string> = {
  4: 'rounded-[4px]',
  8: 'rounded-[8px]',
  12: 'rounded-[12px]',
  16: 'rounded-[16px]',
}
export const radiusClass = RADIUS_CLASS_BY_PX

// iconSize px (32-72, step 4) → Tailwind 靜態 class（JIT 預掃描必須靜態寫死）
// 容器 = iconSize + 8px (compact) / +12px (grid)；圖片 = iconSize × 0.6
const ICON_SIZE_BY_PX: Record<number, { compact: string, grid: string, imageCompact: string, imageGrid: string }> = {
  32: { compact: 'size-10 rounded-md text-base', grid: 'size-11 rounded-lg text-lg', imageCompact: 'size-[19px]', imageGrid: 'size-[22px]' },
  36: { compact: 'size-11 rounded-md text-lg', grid: 'size-12 rounded-lg text-xl', imageCompact: 'size-[22px]', imageGrid: 'size-[25px]' },
  40: { compact: 'size-12 rounded-lg text-xl', grid: 'size-[52px] rounded-lg text-2xl', imageCompact: 'size-[24px]', imageGrid: 'size-[28px]' },
  44: { compact: 'size-[52px] rounded-lg text-2xl', grid: 'size-[56px] rounded-xl text-2xl', imageCompact: 'size-[26px]', imageGrid: 'size-[31px]' },
  48: { compact: 'size-[56px] rounded-lg text-2xl', grid: 'size-[60px] rounded-xl text-3xl', imageCompact: 'size-[29px]', imageGrid: 'size-[34px]' },
  52: { compact: 'size-[60px] rounded-xl text-3xl', grid: 'size-[64px] rounded-xl text-3xl', imageCompact: 'size-[31px]', imageGrid: 'size-[36px]' },
  56: { compact: 'size-[64px] rounded-xl text-3xl', grid: 'size-[68px] rounded-xl text-4xl', imageCompact: 'size-[34px]', imageGrid: 'size-[39px]' },
  60: { compact: 'size-[68px] rounded-xl text-3xl', grid: 'size-[72px] rounded-xl text-4xl', imageCompact: 'size-[36px]', imageGrid: 'size-[42px]' },
  64: { compact: 'size-[72px] rounded-xl text-4xl', grid: 'size-[76px] rounded-xl text-5xl', imageCompact: 'size-[38px]', imageGrid: 'size-[45px]' },
  68: { compact: 'size-[76px] rounded-xl text-4xl', grid: 'size-[80px] rounded-xl text-5xl', imageCompact: 'size-[41px]', imageGrid: 'size-[48px]' },
  72: { compact: 'size-[80px] rounded-xl text-4xl', grid: 'size-[84px] rounded-xl text-5xl', imageCompact: 'size-[43px]', imageGrid: 'size-[50px]' },
}

// 給 BookmarkIcon / GroupStackGraphic 用：iconSize number → class set
export function iconSizeClasses(size: number): { compact: string, grid: string, imageCompact: string, imageGrid: string } {
  return ICON_SIZE_BY_PX[size] ?? ICON_SIZE_BY_PX[48]
}

export const titleLineClass: Record<TitleLineCount, string> = {
  1: 'truncate',
  2: 'line-clamp-2',
}

export const descriptionLineClass: Record<DescriptionLineCount, string> = {
  1: 'line-clamp-1',
  2: 'line-clamp-2',
  3: 'line-clamp-3',
}

export const accentColorVars: Record<AccentColor, Record<string, string>> = {
  neutral: {
    '--primary': '0 0% 9%',
    '--primary-foreground': '0 0% 98%',
    '--ring': '0 0% 30%',
    '--brand': '0 0% 30%',
  },
  blue: {
    '--primary': '217 91% 52%',
    '--primary-foreground': '0 0% 100%',
    '--ring': '217 91% 52%',
    '--brand': '217 91% 52%',
  },
  green: {
    '--primary': '160 84% 32%',
    '--primary-foreground': '0 0% 100%',
    '--ring': '160 84% 32%',
    '--brand': '160 84% 32%',
  },
  orange: {
    '--primary': '24 95% 47%',
    '--primary-foreground': '0 0% 100%',
    '--ring': '24 95% 47%',
    '--brand': '24 95% 47%',
  },
  rose: {
    '--primary': '346 77% 49%',
    '--primary-foreground': '0 0% 100%',
    '--ring': '346 77% 49%',
    '--brand': '346 77% 49%',
  },
}

// Sky: cool paper with a blue pop — the brand's home palette.
const skyPalette = {
  light: {
    '--background': '216 30% 94%',
    '--foreground': '221 32% 13%',
    '--card': '0 0% 98.5%',
    '--card-foreground': '221 32% 13%',
    '--popover': '0 0% 98.5%',
    '--popover-foreground': '221 32% 13%',
    '--primary': '221 87% 55%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '216 28% 89%',
    '--secondary-foreground': '221 32% 16%',
    '--muted': '216 28% 91%',
    '--muted-foreground': '219 13% 40%',
    '--accent': '218 56% 88%',
    '--accent-foreground': '221 60% 28%',
    '--border': '216 22% 83%',
    '--border-strong': '216 22% 56%',
    '--input': '216 22% 79%',
    '--ring': '221 87% 55%',
    '--brand': '221 87% 50%',
  },
  dark: {
    '--background': '222 24% 13%',
    '--foreground': '214 30% 94%',
    '--card': '222 20% 11%',
    '--card-foreground': '214 30% 94%',
    '--popover': '222 20% 11%',
    '--popover-foreground': '214 30% 94%',
    '--primary': '217 92% 66%',
    '--primary-foreground': '222 30% 8%',
    '--secondary': '222 16% 16%',
    '--secondary-foreground': '214 30% 94%',
    '--muted': '222 16% 16%',
    '--muted-foreground': '216 14% 68%',
    '--accent': '220 28% 19%',
    '--accent-foreground': '214 30% 94%',
    '--border': '222 14% 20%',
    '--border-strong': '222 14% 44%',
    '--input': '222 14% 24%',
    '--ring': '217 92% 66%',
    '--brand': '217 92% 66%',
  },
}

export const colorThemeVars: Record<
  Exclude<ColorTheme, 'default'>,
  {
    light: Record<string, string>
    dark: Record<string, string>
  }
> = {
  sky: skyPalette,
  graphite: {
    light: {
      '--background': '210 12% 94%',
      '--foreground': '220 15% 8%',
      '--card': '0 0% 99%',
      '--card-foreground': '220 15% 8%',
      '--popover': '0 0% 99%',
      '--popover-foreground': '220 15% 8%',
      '--primary': '220 13% 18%',
      '--primary-foreground': '0 0% 98%',
      '--secondary': '210 12% 88%',
      '--secondary-foreground': '220 13% 18%',
      '--muted': '210 12% 90%',
      '--muted-foreground': '215 10% 38%',
      '--accent': '210 10% 86%',
      '--accent-foreground': '220 13% 18%',
      '--border': '214 10% 80%',
      '--border-strong': '214 10% 55%',
      '--input': '214 10% 76%',
      '--ring': '220 13% 18%',
      '--brand': '220 13% 18%',
    },
    dark: {
      '--background': '215 10% 7%',
      '--foreground': '210 20% 96%',
      '--card': '215 9% 10%',
      '--card-foreground': '210 20% 96%',
      '--popover': '215 9% 10%',
      '--popover-foreground': '210 20% 96%',
      '--primary': '210 20% 92%',
      '--primary-foreground': '215 10% 7%',
      '--secondary': '215 11% 14%',
      '--secondary-foreground': '210 20% 96%',
      '--muted': '215 11% 14%',
      '--muted-foreground': '215 13% 68%',
      '--accent': '215 11% 16%',
      '--accent-foreground': '210 20% 96%',
      '--border': '215 12% 18%',
      '--border-strong': '215 12% 42%',
      '--input': '215 12% 22%',
      '--ring': '210 20% 92%',
      '--brand': '210 20% 92%',
    },
  },
  meadow: {
    light: {
      '--background': '96 28% 92%',
      '--foreground': '165 30% 16%',
      '--card': '92 25% 98%',
      '--card-foreground': '165 30% 16%',
      '--popover': '92 25% 98%',
      '--popover-foreground': '165 30% 16%',
      '--primary': '158 59% 30%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '92 28% 88%',
      '--secondary-foreground': '158 36% 18%',
      '--muted': '92 24% 88%',
      '--muted-foreground': '156 16% 32%',
      '--accent': '142 31% 84%',
      '--accent-foreground': '158 36% 18%',
      '--border': '104 18% 77%',
      '--border-strong': '104 18% 48%',
      '--input': '104 18% 73%',
      '--ring': '158 59% 30%',
      '--brand': '158 59% 30%',
    },
    dark: {
      '--background': '96 28% 10%',
      '--foreground': '96 33% 93%',
      '--card': '96 25% 9%',
      '--card-foreground': '96 33% 93%',
      '--popover': '96 25% 9%',
      '--popover-foreground': '96 33% 93%',
      '--primary': '150 55% 60%',
      '--primary-foreground': '96 28% 6%',
      '--secondary': '96 23% 14%',
      '--secondary-foreground': '96 33% 93%',
      '--muted': '96 23% 14%',
      '--muted-foreground': '96 18% 68%',
      '--accent': '96 24% 17%',
      '--accent-foreground': '96 33% 93%',
      '--border': '96 19% 20%',
      '--border-strong': '96 19% 37%',
      '--input': '96 19% 24%',
      '--ring': '150 55% 60%',
      '--brand': '150 55% 60%',
    },
  },
  dawn: {
    light: {
      '--background': '32 42% 93%',
      '--foreground': '230 18% 12%',
      '--card': '38 35% 99%',
      '--card-foreground': '230 18% 12%',
      '--popover': '38 35% 99%',
      '--popover-foreground': '230 18% 12%',
      '--primary': '24 88% 45%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '38 34% 87%',
      '--secondary-foreground': '230 18% 12%',
      '--muted': '36 31% 88%',
      '--muted-foreground': '230 10% 35%',
      '--accent': '28 48% 83%',
      '--accent-foreground': '24 54% 24%',
      '--border': '34 22% 75%',
      '--border-strong': '34 22% 51%',
      '--input': '34 22% 71%',
      '--ring': '24 88% 45%',
      '--brand': '24 88% 45%',
    },
    dark: {
      '--background': '32 22% 12%',
      '--foreground': '32 38% 93%',
      '--card': '32 19% 10%',
      '--card-foreground': '32 38% 93%',
      '--popover': '32 19% 10%',
      '--popover-foreground': '32 38% 93%',
      '--primary': '24 88% 60%',
      '--primary-foreground': '32 22% 7%',
      '--secondary': '32 16% 15%',
      '--secondary-foreground': '32 38% 93%',
      '--muted': '32 16% 15%',
      '--muted-foreground': '32 18% 70%',
      '--accent': '32 18% 18%',
      '--accent-foreground': '32 38% 93%',
      '--border': '32 14% 21%',
      '--border-strong': '32 14% 41%',
      '--input': '32 14% 25%',
      '--ring': '24 88% 60%',
      '--brand': '24 88% 60%',
    },
  },
  berry: {
    light: {
      '--background': '334 36% 93%',
      '--foreground': '225 18% 11%',
      '--card': '0 0% 99%',
      '--card-foreground': '225 18% 11%',
      '--popover': '0 0% 99%',
      '--popover-foreground': '225 18% 11%',
      '--primary': '346 72% 45%',
      '--primary-foreground': '0 0% 100%',
      '--secondary': '334 28% 87%',
      '--secondary-foreground': '225 18% 11%',
      '--muted': '334 24% 87%',
      '--muted-foreground': '225 10% 36%',
      '--accent': '346 38% 82%',
      '--accent-foreground': '341 55% 24%',
      '--border': '334 18% 77%',
      '--border-strong': '334 18% 56%',
      '--input': '334 18% 73%',
      '--ring': '346 72% 45%',
      '--brand': '346 72% 45%',
    },
    dark: {
      '--background': '334 28% 11%',
      '--foreground': '334 32% 93%',
      '--card': '334 25% 10%',
      '--card-foreground': '334 32% 93%',
      '--popover': '334 25% 10%',
      '--popover-foreground': '334 32% 93%',
      '--primary': '346 78% 66%',
      '--primary-foreground': '334 28% 7%',
      '--secondary': '334 22% 15%',
      '--secondary-foreground': '334 32% 93%',
      '--muted': '334 22% 15%',
      '--muted-foreground': '334 16% 70%',
      '--accent': '334 24% 18%',
      '--accent-foreground': '334 32% 93%',
      '--border': '334 18% 21%',
      '--border-strong': '334 18% 43%',
      '--input': '334 18% 25%',
      '--ring': '346 78% 66%',
      '--brand': '346 78% 66%',
    },
  },
}

export const colorThemeVariableNames = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--border-strong',
  '--input',
  '--ring',
  '--brand',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pick<T extends string>(value: unknown, options: T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

export function normalizeAppearanceSettings(
  value?: Partial<Omit<AppearanceSettings, 'cardFields' | 'navItems'>> & {
    cardFields?: Partial<CardFieldSettings>
    navItems?: Partial<NavItemSettings>
  },
): AppearanceSettings {
  const cardFields = isRecord(value?.cardFields) ? value.cardFields : {}
  const navItems = isRecord(value?.navItems) ? value.navItems : {}
  const titleLines
    = cardFields.titleLines === 1 || cardFields.titleLines === 2
      ? cardFields.titleLines
      : DEFAULT_APPEARANCE_SETTINGS.cardFields.titleLines
  const descriptionLines
    = cardFields.descriptionLines === 1
      || cardFields.descriptionLines === 2
      || cardFields.descriptionLines === 3
      ? cardFields.descriptionLines
      : DEFAULT_CARD_FIELDS.descriptionLines
  const maxVisibleTags
    = typeof cardFields.maxVisibleTags === 'number'
      ? Math.max(0, Math.min(5, Math.floor(cardFields.maxVisibleTags)))
      : DEFAULT_CARD_FIELDS.maxVisibleTags

  // 舊版只有 gridCols（1-6）；新欄位缺省時從它遷移，避免既有版面設定遺失。
  const legacyGridCols = (() => {
    const raw = value?.gridCols
    if (typeof raw === 'number' && raw >= 1 && raw <= 6)
      return Math.floor(raw)
    const legacyCardSize = value?.cardSize
    const legacyDensity = value?.gridDensity
    if (legacyCardSize === 'compact' || legacyDensity === 'dense')
      return 5
    if (legacyCardSize === 'spacious')
      return 3
    return undefined
  })()
  // 0 = 自動；其餘 clamp 1-8。沒有有效值時用舊 gridCols 遷移，再用預設（自動）。
  const migrateGridCols = (raw: unknown): number => {
    if (typeof raw === 'number' && Number.isFinite(raw))
      return raw <= 0 ? 0 : Math.min(8, Math.floor(raw))
    return legacyGridCols ?? DEFAULT_APPEARANCE_SETTINGS.bookmarkGridCols
  }

  return {
    navLayout: pick(
      value?.navLayout,
      NAV_LAYOUTS,
      DEFAULT_APPEARANCE_SETTINGS.navLayout,
    ),
    // Only fresh installs start centered; saved appearances keep the workspace header.
    homeLayout: pick(
      value?.homeLayout,
      HOME_LAYOUTS,
      isRecord(value) ? 'workspace' : DEFAULT_APPEARANCE_SETTINGS.homeLayout,
    ),
    contentWidth: pick(
      value?.contentWidth,
      CONTENT_WIDTHS,
      DEFAULT_APPEARANCE_SETTINGS.contentWidth,
    ),
    gridDensity: pick(
      value?.gridDensity,
      GRID_DENSITIES,
      DEFAULT_APPEARANCE_SETTINGS.gridDensity,
    ),
    cardSize: pick(
      value?.cardSize,
      ['compact', 'comfortable', 'spacious'] as const,
      // 旧設定只有 gridDensity，compact 遷移到 dense
      value?.gridDensity === 'dense' ? 'compact' : DEFAULT_APPEARANCE_SETTINGS.cardSize,
    ),
    // 舊 cardSize/gridDensity 遷移到 cardHeight + gridCols
    cardHeight: (() => {
      const raw = value?.cardHeight
      if (typeof raw === 'number' && raw >= 60 && raw <= 140)
        return raw
      // 從舊 cardSize 或 gridDensity 推導
      const legacyCardSize = value?.cardSize
      const legacyDensity = value?.gridDensity
      if (legacyCardSize === 'compact' || legacyDensity === 'dense')
        return 68
      if (legacyCardSize === 'spacious')
        return 100
      return DEFAULT_APPEARANCE_SETTINGS.cardHeight
    })(),
    gridCols: legacyGridCols ?? DEFAULT_APPEARANCE_SETTINGS.gridCols,
    bookmarkGridCols: migrateGridCols(value?.bookmarkGridCols),
    folderGridCols: migrateGridCols(value?.folderGridCols),
    cardStyle: pick(
      value?.cardStyle,
      CARD_STYLES,
      DEFAULT_APPEARANCE_SETTINGS.cardStyle,
    ),
    // iconSize 現在是 px 數字；舊 AppearanceSize ('sm'|'md'|'lg'|'xl') 遷移
    iconSize: (() => {
      const raw = value?.iconSize
      if (typeof raw === 'number' && raw >= 32 && raw <= 72)
        return raw
      const legacyMap: Record<string, number> = { sm: 36, md: 44, lg: 52, xl: 60 }
      if (typeof raw === 'string' && legacyMap[raw])
        return legacyMap[raw]
      return DEFAULT_APPEARANCE_SETTINGS.iconSize
    })(),
    // radius 現在是 px 數字；舊 AppearanceSize ('sm'|'md'|'lg'|'xl') 遷移
    radius: (() => {
      const raw = value?.radius
      const legacyMap = { sm: 4, md: 8, lg: 12, xl: 16 }
      if (typeof raw === 'string' && legacyMap[raw])
        return legacyMap[raw]
      if (typeof raw === 'number' && raw >= 4 && raw <= 16)
        return raw
      return DEFAULT_APPEARANCE_SETTINGS.radius
    })(),
    accentColor: pick(
      value?.accentColor,
      ACCENT_COLORS,
      DEFAULT_APPEARANCE_SETTINGS.accentColor,
    ),
    colorTheme: pick(
      value?.colorTheme,
      COLOR_THEMES,
      DEFAULT_APPEARANCE_SETTINGS.colorTheme,
    ),
    // fontSizeScale 現在是數字百分比（0=自動，負=縮小，正=放大）
    fontSizeScale: (() => {
      const raw = value?.fontSizeScale
      if (typeof raw === 'number' && raw >= -30 && raw <= 50)
        return raw
      if (typeof raw === 'string' && raw !== 'auto') {
        const n = Number.parseFloat(raw)
        if (!Number.isNaN(n))
          return n
      }
      return 0 // 'auto' 或缺失 → 0（跟隨自動 clamp）
    })(),
    backgroundStyle: pick(
      value?.backgroundStyle,
      BACKGROUND_STYLES,
      DEFAULT_APPEARANCE_SETTINGS.backgroundStyle,
    ),
    fontFamily:
      typeof value?.fontFamily === 'string' ? value.fontFamily.trim() : '',
    fontWeight: pick(
      value?.fontWeight,
      FONT_WEIGHTS,
      DEFAULT_APPEARANCE_SETTINGS.fontWeight,
    ),
    navItems: {
      icons:
        typeof navItems.icons === 'boolean'
          ? navItems.icons
          : DEFAULT_NAV_ITEMS.icons,
      counts:
        typeof navItems.counts === 'boolean'
          ? navItems.counts
          : DEFAULT_NAV_ITEMS.counts,
      smartCategories:
        typeof navItems.smartCategories === 'boolean'
          ? navItems.smartCategories
          : DEFAULT_NAV_ITEMS.smartCategories,
      savedSearches:
        typeof navItems.savedSearches === 'boolean'
          ? navItems.savedSearches
          : DEFAULT_NAV_ITEMS.savedSearches,
      categoryTree:
        typeof navItems.categoryTree === 'boolean'
          ? navItems.categoryTree
          : DEFAULT_NAV_ITEMS.categoryTree,
    },
    cardFields: {
      websiteIcon:
        typeof cardFields.websiteIcon === 'boolean'
          ? cardFields.websiteIcon
          : DEFAULT_CARD_FIELDS.websiteIcon,
      description:
        typeof cardFields.description === 'boolean'
          ? cardFields.description
          : DEFAULT_CARD_FIELDS.description,
      tags:
        typeof cardFields.tags === 'boolean'
          ? cardFields.tags
          : DEFAULT_CARD_FIELDS.tags,
      categoryPath:
        typeof cardFields.categoryPath === 'boolean'
          ? cardFields.categoryPath
          : DEFAULT_CARD_FIELDS.categoryPath,
      categoryCards:
        typeof cardFields.categoryCards === 'boolean'
          ? cardFields.categoryCards
          : DEFAULT_CARD_FIELDS.categoryCards,
      actions: cardFields.actions === 'always' ? 'always' : 'hover',
      titleLines,
      descriptionLines,
      maxVisibleTags,
    },
    sidebarWidth: (() => {
      const raw = value?.sidebarWidth
      if (typeof raw === 'number') {
        if (Number.isFinite(raw))
          return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(raw)))
      }
      return DEFAULT_APPEARANCE_SETTINGS.sidebarWidth
    })(),
    sidebarCollapsed: typeof value?.sidebarCollapsed === 'boolean'
      ? value.sidebarCollapsed
      : DEFAULT_APPEARANCE_SETTINGS.sidebarCollapsed,
  }
}
