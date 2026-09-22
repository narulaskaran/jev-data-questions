export type AppRoute =
  | { kind: 'land' }
  | { kind: 'dataset'; datasetId: string }
  | { kind: 'share'; analysisId: string }

export const DATASET_PATH_RE = /^\/dataset\/([^/]+)\/?$/
export const SHARE_PATH_RE = /^\/share\/([^/]+)\/?$/

const decodeSegment = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

const withSearch = (path: string, search = ''): string => {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}`
}

export const landHref = (search = ''): string => withSearch('/', search)

export const datasetHref = (datasetId: string, search = ''): string => (
  withSearch(`/dataset/${encodeURIComponent(datasetId)}`, search)
)

export const shareHref = (analysisId: string, search = ''): string => (
  withSearch(`/share/${encodeURIComponent(analysisId)}`, search)
)

export const parseAppPath = (pathname: string): AppRoute => {
  const share = pathname.match(SHARE_PATH_RE)
  if (share) {
    const analysisId = decodeSegment(share[1] ?? '')
    return analysisId ? { kind: 'share', analysisId } : { kind: 'land' }
  }
  const dataset = pathname.match(DATASET_PATH_RE)
  if (dataset) {
    const datasetId = decodeSegment(dataset[1] ?? '')
    return datasetId ? { kind: 'dataset', datasetId } : { kind: 'land' }
  }
  return { kind: 'land' }
}

export const parseAppLocation = (
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
): AppRoute => parseAppPath(pathname || '/')
