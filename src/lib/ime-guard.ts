/**
 * 輸入法組字期間（含注音選字）的按鍵不是一般快捷鍵：
 * Chrome 在確認選字時會送出 `isComposing: true` 的 Enter，部分平台另以 keyCode 229 表示。
 * 這些按鍵必須交還輸入法，不得觸發「完成」「送出」等資料操作。
 */
export function isImeComposing(
  event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>,
): boolean {
  return event.isComposing || event.keyCode === 229
}
