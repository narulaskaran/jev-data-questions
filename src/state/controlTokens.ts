const KEY = 'jev-playground.runs.v1'
const MAX_REMEMBERED = 50

type Stored = Record<string, { token: string; at: number }>

const load = (): Stored => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Stored : {}
  } catch {
    return {}
  }
}

/** Remember that this browser started the run, so it can cancel or resume it later. */
export const rememberControlToken = (analysisId: string, token: string): void => {
  try {
    const stored = load()
    stored[analysisId] = { token, at: Date.now() }
    const kept = Object.entries(stored).sort((left, right) => right[1].at - left[1].at).slice(0, MAX_REMEMBERED)
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch { /* Private mode: controls just won't survive a reload. */ }
}

export const controlTokenFor = (analysisId: string): string | undefined => {
  const entry = load()[analysisId]
  return typeof entry?.token === 'string' ? entry.token : undefined
}
