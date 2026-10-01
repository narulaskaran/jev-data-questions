/** Return false when the browser cannot copy, so the UI can expose selectable text. */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
