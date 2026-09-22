import { parseJevQueryJson } from './jevQuery.js'

export const FIXTURE_PLAYER_CLASSES = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] as const
export const SAMPLE_WIN_LIKELIHOOD_TASK = 'Win likelihood of the game per play.'
export const SAMPLE_WIN_NOUL_QUERY = 'Will SEA win given this play state?'
export const SAMPLE_PLAY_QUALITY_TASK = 'Evaluate the quality of each play.'
export const SAMPLE_PLAY_QUALITY_QUERY = 'Rate the quality of this play given this play state.'
export const SAMPLE_PLAY_QUALITY_LEVELS = ['Low', 'Medium', 'High'] as const
export const SQUIRREL_EATING_TASK = 'Where they eat.'
export const SQUIRREL_EATING_NOUL_QUERY = 'Is this squirrel eating given this sighting?'
export const SQUIRREL_ACTIVITY_TASK = 'How active is this squirrel given this sighting?'
export const SQUIRREL_ACTIVITY_QUERY = 'How active is this squirrel given this sighting?'
export const INVALID_CLASSES_COPY = "Couldn't draft classes for that CSV — try a clearer question."

export const JEV_QUESTION_KINDS = ['noul', 'score', 'choice'] as const
export type JevQuestionKind = typeof JEV_QUESTION_KINDS[number]
export type ChartVisualKind = 'series' | 'bars' | 'places'

const WIN_LIKELIHOOD_RE = /win[-\s]?likelihood|\bp\s*\(\s*win\s*\)|will\s+(?:sea|the\s+seahawks|seattle|this\s+team|the\s+home\s+team)\s+win|(?:probability|chance)\s+(?:that\s+)?(?:sea|the\s+seahawks|seattle)\s+(?:will\s+)?win|chance\s+(?:that\s+)?(?:sea|the\s+seahawks|seattle)\s+(?:wins|of winning)|how\s+(?:the\s+)?game\s+went/i
const PLAY_QUALITY_RE = /play\s+quality|quality\s+of\s+(?:the\s+|each\s+|every\s+|these\s+|this\s+)?plays?|grad(?:e|ing)\s+(?:the\s+|each\s+|every\s+|these\s+|this\s+)?plays?|plays?\s+grad(?:e|ing)|good\s*(?:or|\/|vs\.?|versus|-)?\s*bad\s+plays?|bad\s*(?:or|\/|vs\.?|versus|-)?\s*good\s+plays?|rate\s+(?:the\s+|each\s+|every\s+|these\s+|this\s+)?(?:plays?|quality)|how\s+good\s+(?:was|were|is)\s+(?:this|the|each|every)\s+play/i
const GOOD_BAD_PLAY_LABELS = new Set(['good', 'bad', 'good play', 'bad play', 'good plays', 'bad plays'])
const PLACE_EATING_RE = /where\s+they\s+eat|locations?\s+where\s+(?:\w+\s+)?(?:squirrels?|they)\s+(?:are\s+)?(?:spotted\s+)?eat|spotted\s+eating|eating\s+locations?|places?\s+(?:they|squirrels?)\s+eat/i
const JUNK_PLACE_SPLIT = new Set(['location', 'activity', 'place', 'places', 'locations'])
const FIXTURE_PLAYER_RE = /k\.?\s*walker|c\.?\s*kupp|j\.?\s*smith-?njigba|scrimmage\s+yards|leading\s+(?:player|rusher|receiver)/i
const CLASS_LIST_SPLIT_RE = /\s*(?:,|\bor\b|\band\b|\bvs\.?\b|\bversus\b|\/)\s*/i
const CLASS_CLAUSE_RE = /\b(?:as|into)\s+(.+?)(?:\s+(?:using|with|from|given|based|via)\b|[.?!]|$)/i
const CLASS_LABEL_RE = /^[A-Za-z][\w./+-]{0,39}(?:\s+[A-Za-z][\w./+-]{0,39}){0,2}$/
const CLASS_STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'based', 'class', 'classes', 'classify', 'classification',
  'column', 'columns', 'csv', 'data', 'each', 'every', 'field', 'fields', 'from',
  'given', 'into', 'it', 'its', 'label', 'labels', 'or', 'per', 'row', 'rows',
  'text', 'the', 'these', 'this', 'those', 'using', 'via', 'visible', 'vs',
  'versus', 'with',
])
const LABEL_COLUMN_RE = /(?:^|_)(label|labels|class|classes|category|categories|target|hint|species)(?:_|$)/i
const CLASS_MAX_LENGTH = 80
const CLASS_MAX_COUNT = 32

export const parseQuestionKind = (value: unknown): JevQuestionKind | undefined => (
  value === 'noul' || value === 'score' || value === 'choice' ? value : undefined
)

export const looksLikeWinLikelihood = (text: string): boolean => WIN_LIKELIHOOD_RE.test(text.trim())

export const looksLikePlayQuality = (text: string): boolean => PLAY_QUALITY_RE.test(text.trim())

export const looksLikePlaceEatingTask = (text: string): boolean => PLACE_EATING_RE.test(text.trim())

export const isGoodBadPlayClassList = (classes: readonly string[] = []): boolean => {
  if (classes.length !== 2) return false
  const normalized = classes.map((name) => name.trim().toLowerCase())
  if (normalized.some((name) => !GOOD_BAD_PLAY_LABELS.has(name))) return false
  const polarities = new Set(normalized.map((name) => (name.startsWith('good') ? 'good' : 'bad')))
  return polarities.size === 2
}

export const isJunkLocationActivitySplit = (classes: readonly string[] = []): boolean => {
  if (classes.length < 2) return false
  const normalized = classes.map((name) => name.trim().toLowerCase())
  if (normalized.every((name) => JUNK_PLACE_SPLIT.has(name))) return true
  const labels = new Set(normalized)
  return labels.has('location') && labels.has('activity')
}

export const isSampleDefaultEatingTask = (task: string): boolean => (
  normalizeAnalysisTask(task) === normalizeAnalysisTask(SQUIRREL_EATING_TASK) || looksLikePlaceEatingTask(task)
)

export const normalizeAnalysisTask = (task: string): string => task.trim().replace(/\s+/g, ' ').toLowerCase()

export const isSampleDefaultWinTask = (task: string): boolean => (
  normalizeAnalysisTask(task) === normalizeAnalysisTask(SAMPLE_WIN_LIKELIHOOD_TASK)
)

export const isSampleDefaultPlayQualityTask = (task: string): boolean => (
  normalizeAnalysisTask(task) === normalizeAnalysisTask(SAMPLE_PLAY_QUALITY_TASK) || looksLikePlayQuality(task)
)

const uniqueClassLabels = (values: readonly string[]): string[] => {
  const seen = new Set<string>()
  const classes: string[] = []
  for (const value of values) {
    const name = value.trim()
    if (!name || name.length > CLASS_MAX_LENGTH || name.includes('\u0000')) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    classes.push(name)
    if (classes.length >= CLASS_MAX_COUNT) break
  }
  return classes
}

const classLabelFromToken = (value: string): string | undefined => {
  const name = value.replace(/^['"`]+|['"`]+$/g, '').trim()
  if (!name || !CLASS_LABEL_RE.test(name)) return undefined
  if (CLASS_STOPWORDS.has(name.toLowerCase())) return undefined
  return name
}

export const classesFromTask = (task: string): string[] => {
  const text = task.trim()
  if (!text) return []
  const clause = text.match(CLASS_CLAUSE_RE)?.[1] ?? ''
  const colon = text.match(/:\s*([^.?!]+)/)?.[1] ?? ''
  const vs = text.match(/\b([A-Za-z][\w./+-]{0,39})\s+(?:vs\.?|versus)\s+([A-Za-z][\w./+-]{0,39})\b/i)
  const tokens = [...clause.split(CLASS_LIST_SPLIT_RE), ...colon.split(CLASS_LIST_SPLIT_RE)]
  if (vs) tokens.push(vs[1], vs[2])
  return uniqueClassLabels(tokens.map((token) => classLabelFromToken(token) ?? '').filter(Boolean))
}

export const classesFromLabelColumns = (
  columns: readonly string[] = [],
  rows: readonly Record<string, unknown>[] = [],
): string[] => {
  for (const column of columns) {
    if (!LABEL_COLUMN_RE.test(column)) continue
    const values: string[] = []
    for (const row of rows) {
      const value = row[column]
      if (typeof value === 'string' && value.trim()) values.push(value.trim())
    }
    const classes = uniqueClassLabels(values)
    if (classes.length >= 2) return classes
  }
  return []
}

export const mergeClassLists = (...lists: Array<readonly string[] | undefined>): string[] => (
  uniqueClassLabels(lists.flatMap((list) => list ?? []))
)

export const isPlayerClassifierQuery = (query: string): boolean => FIXTURE_PLAYER_RE.test(query)

export const isFixturePlayerClassList = (classes: readonly string[] = []): boolean => {
  if (classes.length === 0) return false
  const normalized = new Set(classes.map((name) => name.trim().toLowerCase()).filter(Boolean))
  return FIXTURE_PLAYER_CLASSES.some((name) => normalized.has(name.toLowerCase()))
}

export const userAskedForFixturePlayers = (task: string): boolean => FIXTURE_PLAYER_RE.test(task)

export const chartVisualFor = (kind: JevQuestionKind): ChartVisualKind => (
  kind === 'choice' ? 'bars' : 'series'
)

export type FixtureAnalysisSlice = 'win-likelihood' | 'halftime-eval'

const analysisInstructions = (query: string): string => {
  const parsed = query ? parseJevQueryJson(query) : undefined
  return (parsed?.instructions ?? query).trim()
}

export const fixtureAnalysisSliceFor = (input: {
  task?: string
  query?: string
  questionKind?: JevQuestionKind
  classes?: readonly string[]
} = {}): FixtureAnalysisSlice => {
  const task = input.task?.trim() ?? ''
  const query = input.query?.trim() ?? ''
  const instructions = analysisInstructions(query)
  const parsed = query ? parseJevQueryJson(query) : undefined
  const kind = input.questionKind ?? parsed?.type
  const classes = input.classes ?? []
  if (looksLikeWinLikelihood(task) || looksLikeWinLikelihood(instructions)) return 'win-likelihood'
  if (looksLikePlayQuality(task) || looksLikePlayQuality(instructions) || isGoodBadPlayClassList(classes)) {
    return 'win-likelihood'
  }
  if (kind === 'noul' || kind === 'score') return 'win-likelihood'
  if (isPlayerClassifierQuery(task) || isPlayerClassifierQuery(instructions) || isFixturePlayerClassList(classes)) {
    return 'halftime-eval'
  }
  if (kind === 'choice') return 'halftime-eval'
  if (classes.length >= 2) return 'halftime-eval'
  if (task || query) return 'halftime-eval'
  return 'win-likelihood'
}

export const inferQuestionKind = (
  text: string,
  classes: readonly string[] = [],
  explicit?: JevQuestionKind,
): JevQuestionKind => {
  if (explicit) return explicit
  const parsed = parseJevQueryJson(text)
  if (parsed) return parsed.type
  if (looksLikeWinLikelihood(text)) return 'noul'
  if (looksLikePlaceEatingTask(text)) return 'noul'
  if (looksLikePlayQuality(text) && !userAskedForFixturePlayers(text)) return 'score'
  if (classes.length >= 2) return 'choice'
  return 'choice'
}

export const isCannedSampleWinQuery = (text: string): boolean => {
  const parsed = parseJevQueryJson(text)
  const instructions = (parsed?.instructions ?? text).trim()
  return instructions === SAMPLE_WIN_NOUL_QUERY
}

export const isCannedSamplePlayQualityQuery = (text: string): boolean => {
  const parsed = parseJevQueryJson(text)
  const instructions = (parsed?.instructions ?? text).trim()
  return instructions === SAMPLE_PLAY_QUALITY_QUERY
}

export const resolveDraftedQuery = (input: {
  task: string
  query: string
  questionKind?: string
  classes?: readonly string[]
}): { query: string; questionKind: JevQuestionKind; classes: string[] } => {
  const query = input.query.trim()
  const task = input.task.trim()
  const parsedKind = parseQuestionKind(input.questionKind)
  const rawClasses = uniqueClassLabels(input.classes ?? [])
  const taskClasses = classesFromTask(task)

  if (looksLikeWinLikelihood(task) && !userAskedForFixturePlayers(task)) {
    const leftoverPlayerDraft = isPlayerClassifierQuery(query) || query.length === 0
    return {
      query: leftoverPlayerDraft ? SAMPLE_WIN_NOUL_QUERY : query,
      questionKind: 'noul',
      classes: [],
    }
  }

  if (looksLikePlayQuality(task) && !userAskedForFixturePlayers(task)) {
    const leftoverChoice = query.length === 0
      || parsedKind === 'choice'
      || isGoodBadPlayClassList(rawClasses)
      || isPlayerClassifierQuery(query)
      || looksLikeWinLikelihood(query)
      || isCannedSampleWinQuery(query)
      || isJunkLocationActivitySplit(rawClasses)
    const classes = !leftoverChoice && parsedKind === 'score' && rawClasses.length >= 2
      ? rawClasses
      : [...SAMPLE_PLAY_QUALITY_LEVELS]
    return {
      query: leftoverChoice ? SAMPLE_PLAY_QUALITY_QUERY : query,
      questionKind: 'score',
      classes,
    }
  }

  if (looksLikePlaceEatingTask(task)) {
    const leftoverJunk = query.length === 0
      || isJunkLocationActivitySplit(rawClasses)
      || isPlayerClassifierQuery(query)
      || looksLikeWinLikelihood(query)
      || isCannedSampleWinQuery(query)
    return {
      query: leftoverJunk ? SQUIRREL_EATING_NOUL_QUERY : query,
      questionKind: 'noul',
      classes: [],
    }
  }

  const leftoverCannedWin = isCannedSampleWinQuery(query) || looksLikeWinLikelihood(query) || isCannedSamplePlayQualityQuery(query) || looksLikePlayQuality(query)
  const honoredQuery = leftoverCannedWin ? task : query
  const honoredKind = leftoverCannedWin ? undefined : parsedKind
  const dropFixtureFallback = isFixturePlayerClassList(rawClasses) && !userAskedForFixturePlayers(task)
  const providerClasses = (dropFixtureFallback || leftoverCannedWin) ? [] : rawClasses
  const classes = providerClasses.length >= 2 ? providerClasses : mergeClassLists(providerClasses, taskClasses)

  if (honoredKind === 'noul' && classes.length < 2) {
    return { query: honoredQuery, questionKind: 'noul', classes: [] }
  }

  if (honoredKind === 'score') {
    return { query: honoredQuery, questionKind: 'score', classes: classes.length >= 2 ? classes : ['Low', 'Medium', 'High'] }
  }

  return {
    query: honoredQuery,
    questionKind: honoredKind === 'choice' || classes.length >= 2 ? 'choice' : inferQuestionKind(honoredQuery, classes),
    classes,
  }
}

export const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const seriesValueFromRow = (row: { value?: number }): number | undefined => {
  if (typeof row.value !== 'number' || !Number.isFinite(row.value)) return undefined
  return clamp01(row.value)
}
