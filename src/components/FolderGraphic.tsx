import type { Placement } from '~/lib/graphic-placement'
import type { AppearanceSettings, Bookmark } from '~/lib/types'
import { BookmarkIcon } from '~/components/BookmarkIcon'
import { placementStyle } from '~/lib/graphic-placement'
import { cn } from '~/lib/utils'

// iconSize 是 number px；folder graphic 容器略大 12px
// 映射：iconSize → Tailwind 静态 class（JIT 预扫描必须静态）
const FOLDER_BY_ICON_SIZE: Record<number, string> = {
  32: 'size-12 rounded-md text-[16px]',
  36: 'size-[52px] rounded-md text-[18px]',
  40: 'size-[56px] rounded-lg text-[20px]',
  44: 'size-[60px] rounded-lg text-[22px]',
  48: 'size-[64px] rounded-lg text-[24px]',
  52: 'size-[68px] rounded-lg text-[26px]',
  56: 'size-[72px] rounded-lg text-[28px]',
  60: 'size-[76px] rounded-lg text-[30px]',
  64: 'size-[80px] rounded-lg text-[32px]',
  68: 'size-[84px] rounded-lg text-[34px]',
  72: 'size-[88px] rounded-lg text-[36px]',
}
function folderContainerClass(size: number): string {
  return FOLDER_BY_ICON_SIZE[size] ?? FOLDER_BY_ICON_SIZE[48]
}

// Resting and hovered placement per item, by how many items the folder shows; percentages of the graphic.
const placements: Record<number, Placement[]> = {
  1: [{ x: 28, hy: -40 }],
  2: [{ x: 16, r: -7, hx: -10, hy: -30, hr: -14 }, { x: 40, r: 7, hx: 10, hy: -30, hr: 14 }],
  3: [{ x: 8, r: -8, hx: -14, hy: -30, hr: -16 }, { x: 28, y: -10, hy: -42 }, { x: 48, r: 8, hx: 14, hy: -30, hr: 16 }],
}
const paperPlacements: Placement[] = [{ x: 12, hy: -26, hr: -6 }, { x: 38, r: 6, hy: -34, hr: 10 }]

interface FolderGraphicProps {
  appearance: AppearanceSettings
  /** User-picked emoji, shown on the front flap; omitted for untouched folders. */
  emoji?: string
  previewBookmarks?: Bookmark[]
}

/**
 * A small open folder with its first site icons peeking out (plain sheets when it holds no bookmarks).
 * Hovering or focusing the surrounding `.folder-card` tips the flap open and fans the contents up; see main.css.
 */
export function FolderGraphic({ appearance, emoji, previewBookmarks = [] }: FolderGraphicProps) {
  return (
    <div
      data-slot="folder-card-icon"
      aria-hidden="true"
      className={cn('folder-graphic shrink-0', folderContainerClass(appearance.iconSize), 'rounded-none')}
    >
      <span className="folder-graphic-back" />
      {previewBookmarks.length > 0
        ? previewBookmarks.map((bookmark, index) => (
            <span key={bookmark.id} className="folder-graphic-item" style={placementStyle(placements[previewBookmarks.length][index], index)}>
              <BookmarkIcon
                icon={bookmark.icon}
                url={bookmark.url}
                name={bookmark.name}
                appearance={appearance}
                className="size-full rounded-[inherit] bg-card bg-none text-[10px] shadow-none ring-0"
                imageClassName="size-[68%]"
                slot="folder-preview-icon"
              />
            </span>
          ))
        : paperPlacements.map((placement, index) => (
            // eslint-disable-next-line react/no-array-index-key -- fixed decorative sheets
            <span key={index} className="folder-graphic-item folder-graphic-paper" style={placementStyle(placement, index)} />
          ))}
      <span className="folder-graphic-front">
        {emoji ? <span className="folder-graphic-emoji">{emoji}</span> : null}
      </span>
    </div>
  )
}
