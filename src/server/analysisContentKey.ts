import { createHash } from 'node:crypto'
import type { AnalysisSnapshot, JevQuestionKind } from '../shared/analysis.js'
import {
  buildJevQuery,
  classesFromJevQuery,
  parseJevQueryJson,
  type JevQueryJson,
} from '../shared/jevQuery.js'
import { inferQuestionKind, normalizeAnalysisTask } from '../shared/questionKind.js'

const CONTENT_KEY_VERSION = 1
// v2: drafts that only restate existing columns are refused, so older cached ones must not be reused.
const DRAFT_CONTENT_KEY_VERSION = 2

const compactJevQuery = (query: JevQueryJson): string => {
  if (query.type === 'noul') {
    return JSON.stringify({ type: 'noul', instructions: query.instructions.trim() })
  }
  if (query.type === 'score') {
    return JSON.stringify({ type: 'score', instructions: query.instructions.trim(), criteria: query.criteria })
  }
  const criteria = Object.fromEntries(
    Object.entries(query.criteria).sort(([left], [right]) => left.localeCompare(right)),
  )
  return JSON.stringify({ type: 'choice', instructions: query.instructions.trim(), criteria })
}

export const analysisContentFingerprint = (input: {
  datasetId: string
  query: string
  questionKind?: JevQuestionKind
  classes?: readonly string[]
}): string => {
  const parsed = parseJevQueryJson(input.query)
  const questionKind = parsed?.type ?? inferQuestionKind(input.query, input.classes ?? [], input.questionKind)
  const built = parsed ?? buildJevQuery({
    type: questionKind,
    instructions: input.query.trim(),
    classes: input.classes,
  })
  const classes = built.type === 'noul'
    ? []
    : [...classesFromJevQuery(built)].map((item) => item.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right))
  return JSON.stringify({
    v: CONTENT_KEY_VERSION,
    datasetId: input.datasetId.trim(),
    query: compactJevQuery(built),
    questionKind: built.type,
    classes,
  })
}

export const analysisContentKey = (input: {
  datasetId: string
  query: string
  questionKind?: JevQuestionKind
  classes?: readonly string[]
}): string => createHash('sha256').update(analysisContentFingerprint(input), 'utf8').digest('hex')

export const analysisContentKeyFromSnapshot = (snapshot: Pick<AnalysisSnapshot, 'datasetId' | 'fixtureId' | 'query' | 'questionKind' | 'classes'>): string => (
  analysisContentKey({
    datasetId: snapshot.datasetId || snapshot.fixtureId,
    query: snapshot.query,
    questionKind: snapshot.questionKind,
    classes: snapshot.classes,
  })
)

export const draftContentFingerprint = (input: {
  datasetId: string
  task: string
}): string => JSON.stringify({
  v: DRAFT_CONTENT_KEY_VERSION,
  datasetId: input.datasetId.trim(),
  task: normalizeAnalysisTask(input.task),
})

export const draftContentKey = (input: {
  datasetId: string
  task: string
}): string => createHash('sha256').update(draftContentFingerprint(input), 'utf8').digest('hex')
