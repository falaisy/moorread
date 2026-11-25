import { runViewTransition, viewTransitionActive } from '~/lib/view-transition'

/** 主题切换：fade 过渡，不做圆形扩散 */
export function runThemeTransition(apply: () => void): void {
  if (
    !document.startViewTransition
    || document.visibilityState !== 'visible'
    || viewTransitionActive()
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    apply()
    return
  }
  runViewTransition({
    prepare: () => {},
    update: apply,
    cleanup: () => {},
  })
}
