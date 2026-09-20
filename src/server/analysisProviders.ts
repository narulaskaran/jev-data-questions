import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  choice,
  noul,
  score,
  TypeSafeClient,
  type EntryType,
  type RequestOptions,
  type ScoreCriteria,
  type SystemOneRequest,
  type TypeSafeClientConfig,
} from '@typesafe-ai/sdk'
import {
  ANALYSIS_MAX_QUERY_LENGTH,
  type AnalysisClassification,
  type JevQuestionKind,
} from '../shared/analysis.js'
import { inferQuestionKind, parseQuestionKind } from '../shared/questionKind.js'
import {
  classesFromJevQuery,
  parseJevQueryJson,
  parseJevQueryRecord,
} from '../shared/jevQuery.js'
import { AnalysisError, type AnalysisClassifier, type AnalysisDraftProvider } from './analysis.js'
import { createTypeSafeSdkConfig, hasTypeSafeApiKey, JEV_MODEL } from './jev.js'

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
export const OPENROUTER_MODEL = 'openai/gpt-4o-mini'
const OPENROUTER_TIMEOUT_MS = 20_000

export class OpenRouterConfigurationError extends AnalysisError {
  constructor() {
    super('OPENROUTER_NOT_CONFIGURED', 'OpenRouter is not configured', 503, false)
    this.name = 'OpenRouterConfigurationError'
  }
}

export class OpenRouterProviderError extends AnalysisError {
  constructor(code: string, statusCode: number, retryable: boolean) {
    super(code, 'OpenRouter provider request failed', statusCode, retryable)
    this.name = 'OpenRouterProviderError'
  }
}

const serverEnv = (name: string): string | undefined => {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const parseDraftQuery = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > ANALYSIS_MAX_QUERY_LENGTH || trimmed.includes('\u0000')) return undefined
  return trimmed
}

const parseDraftClasses = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const classes = value.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item.length > 0 && item.length <= 80)
  return classes.length > 0 ? classes : undefined
}

const contentDraft = (content: unknown): { query: string; classes?: string[]; questionKind?: JevQuestionKind } | undefined => {
  const fromRecord = (value: unknown): { query: string; classes?: string[]; questionKind?: JevQuestionKind } | undefined => {
    if (!isRecord(value)) return undefined
    const jev = parseJevQueryRecord(value)
    if (jev) {
      return {
        query: JSON.stringify(jev),
        classes: classesFromJevQuery(jev),
        questionKind: jev.type,
      }
    }
    const query = parseDraftQuery(value.query)
    if (!query) return undefined
    const nested = parseJevQueryJson(query)
    if (nested) {
      return {
        query: JSON.stringify(nested),
        classes: classesFromJevQuery(nested),
        questionKind: nested.type,
      }
    }
    const levels = parseDraftClasses(value.levels) ?? parseDraftClasses(value.classes)
    return { query, classes: levels, questionKind: parseQuestionKind(value.questionKind) }
  }
  if (isRecord(content)) return fromRecord(content)
  if (typeof content !== 'string') return undefined
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return fromRecord(JSON.parse(stripped)) ?? (parseDraftQuery(stripped) ? { query: parseDraftQuery(stripped)! } : undefined)
  } catch {
    const query = parseDraftQuery(stripped)
    return query ? { query } : undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface OpenRouterDraftProviderOptions {
  apiKey?: string
  model?: string
  endpoint?: string
  timeoutMs?: number
  fetch?: typeof fetch
}

export class OpenRouterDraftProvider implements AnalysisDraftProvider {
  private readonly apiKey?: string
  private readonly model: string
  private readonly endpoint: string
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(options: OpenRouterDraftProviderOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv('OPENROUTER_KEY')
    this.model = options.model ?? OPENROUTER_MODEL
    this.endpoint = options.endpoint ?? OPENROUTER_ENDPOINT
    this.timeoutMs = options.timeoutMs ?? OPENROUTER_TIMEOUT_MS
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) throw new RangeError('timeoutMs must be finite and between 1 and 60000')
    this.fetcher = options.fetch ?? globalThis.fetch
  }

  async draft(input: {
    fixtureId: string
    datasetId: string
    task: string
    classes?: readonly string[]
    columns?: readonly string[]
    sampleRows?: Array<Record<string, unknown>>
    sourceType?: string
    questionKindHint?: JevQuestionKind
  }): Promise<{ query: string; model: string; classes?: string[]; questionKind?: JevQuestionKind }> {
    if (!this.apiKey) throw new OpenRouterConfigurationError()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: 'Return JSON only: a Jev query object {"type":"noul"|"score"|"choice","instructions":"...","criteria":...}. Honor the user task; do not ignore it. Noul is {"type":"noul","instructions":"..."} (yes/no probability 0-1). Use "Will SEA win given this play state?" only when the user asked for per-play win likelihood. For play quality / grading / good-vs-bad play asks on sequential football rows, prefer Score {"type":"score","instructions":"Rate the quality of this play given this play state?","criteria":["Low","Medium","High"]} (a rate over play index), never Choice classes named Good Play vs Bad Play, and never the leftover H1 player-yards classifier. For "where they eat" / location-of-an-activity questions, prefer Noul ("is this row that activity?") so the UI can map or rank places; Choice classes must be actual location values from the columns (Ground Plane, Above Ground), never meta-labels named Location vs Activity. Score is {"type":"score","instructions":"...","criteria":["Low","Medium","High"]}. Choice is {"type":"choice","instructions":"...","criteria":{"Label":"what this class means"}} with at least two criteria keys taken from the user task (for example fruit and vehicle). Never return empty or single-class criteria. Do not return a natural-language paraphrase of the task as the query. Do not substitute a leftover demo player-yards classifier (K.Walker, C.Kupp, J.Smith-Njigba, Other). Do not treat CSV columns such as wpa or epa as the model output. Do not include credentials or executable code.' },
            { role: 'user', content: JSON.stringify({
              fixtureId: input.fixtureId,
              datasetId: input.datasetId,
              task: input.task,
              ...(input.classes && input.classes.length >= 2 ? { classes: input.classes } : {}),
              columns: input.columns,
              sampleRows: input.sampleRows,
              sourceType: input.sourceType,
              questionKindHint: input.questionKindHint,
            }) },
            { role: 'user', content: JSON.stringify({
              fixtureId: input.fixtureId,
              datasetId: input.datasetId,
              task: input.task,
              ...(input.classes && input.classes.length >= 2 ? { classes: input.classes } : {}),
              columns: input.columns,
              sampleRows: input.sampleRows,
              sourceType: input.sourceType,
              questionKindHint: input.questionKindHint,
            }) },
          ],
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const status = response.status
        throw new OpenRouterProviderError(`OPENROUTER_${status}`, status === 401 ? 502 : status === 429 ? 503 : 502, status === 429 || status >= 500)
      }
      let body: unknown
      try { body = await response.json() } catch { throw new OpenRouterProviderError('OPENROUTER_MALFORMED', 502, false) }
      const choices = isRecord(body) && Array.isArray(body.choices) ? body.choices : []
      const first = choices[0]
      const message = isRecord(first) && isRecord(first.message) ? first.message.content : undefined
      const draft = contentDraft(message)
      if (!draft?.query) throw new OpenRouterProviderError('OPENROUTER_MALFORMED', 502, false)
      const model = isRecord(body) && typeof body.model === 'string' && body.model.trim() ? body.model.trim() : this.model
      return { query: draft.query, model, ...(draft.classes ? { classes: draft.classes } : {}), ...(draft.questionKind ? { questionKind: draft.questionKind } : {}) }
    } catch (error) {
      if (error instanceof AnalysisError) throw error
      if (isAbortError(error)) throw new OpenRouterProviderError('OPENROUTER_TIMEOUT', 504, true)
      throw new OpenRouterProviderError('OPENROUTER_CONNECTION', 502, true)
    } finally {
      clearTimeout(timer)
    }
  }
}

const isAbortError = (error: unknown): boolean => isRecord(error) && error.name === 'AbortError'

const UNIT_EPSILON = 1e-6
const PROBABILITY_SUM_RESCALE = 1e-3
const ENVELOPE_WRAPPER_KEYS = ['data', 'result', 'response', 'body'] as const

const malformed = (message: string, retryable = false): AnalysisError => (
  new AnalysisError('JEV_MALFORMED_RESPONSE', message, 502, retryable)
)

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

const asFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

const asUnitNumber = (value: unknown): number | undefined => {
  const parsed = asFiniteNumber(value)
  if (parsed === undefined) return undefined
  if (parsed >= 0 && parsed <= 1) return parsed
  if (parsed > 1 && parsed <= 1 + UNIT_EPSILON) return 1
  if (parsed < 0 && parsed >= -UNIT_EPSILON) return 0
  return undefined
}

const answerTypeOf = (value: Record<string, unknown>): string | undefined => (
  typeof value.type === 'string' && value.type.trim() ? value.type.trim().toLowerCase() : undefined
)

const looksLikeAnswer = (value: Record<string, unknown>): boolean => {
  const type = answerTypeOf(value)
  if (type === 'noul' || type === 'score' || type === 'choice') return true
  return value.noul !== undefined || value.score !== undefined || typeof value.choice === 'string' || isRecord(value.probabilities)
}

const unwrapEnvelope = (value: unknown): Record<string, unknown> | undefined => {
  const parsed = parseJsonValue(value)
  if (!isRecord(parsed)) return undefined
  for (const key of ENVELOPE_WRAPPER_KEYS) {
    const nested = parsed[key]
    if (isRecord(nested) && (isRecord(nested.answers) || looksLikeAnswer(nested) || ENVELOPE_WRAPPER_KEYS.some((wrapper) => isRecord(nested[wrapper])))) {
      return unwrapEnvelope(nested) ?? nested
    }
  }
  return parsed
}

const firstAnswer = (answers: Record<string, unknown>): unknown => {
  if (isRecord(answers.classification) || typeof answers.classification === 'string') return answers.classification
  const values = Object.values(answers)
  return values.length === 1 ? values[0] : values.find((item) => {
    const candidate = unwrapEnvelope(item)
    return candidate !== undefined && looksLikeAnswer(candidate)
  })
}

const extractClassifierAnswer = (value: unknown): { model: string; answer: Record<string, unknown> } | undefined => {
  const envelope = unwrapEnvelope(value)
  if (!envelope) return undefined
  const model = typeof envelope.model === 'string' && envelope.model.trim() ? envelope.model.trim() : JEV_MODEL
  let rawAnswer: unknown
  if (isRecord(envelope.answers)) rawAnswer = firstAnswer(envelope.answers)
  else if (Array.isArray(envelope.answers) && envelope.answers.length === 1) rawAnswer = envelope.answers[0]
  else if (looksLikeAnswer(envelope)) rawAnswer = envelope
  else rawAnswer = envelope.classification
  const answer = unwrapEnvelope(rawAnswer)
  if (!answer || !looksLikeAnswer(answer)) return undefined
  return { model, answer }
}

const classifierCriteriaFor = (classes: readonly string[]): Record<string, string> => (
  Object.fromEntries(classes.map((name) => [name, `the ${name} class`]))
)

const scoreCriteriaFor = (classes: readonly string[]): ScoreCriteria => {
  const levels = classes.length >= 2 ? classes : ['Low', 'Medium', 'High']
  return [levels[0], levels[1], ...levels.slice(2)]
}

const questionFor = (input: Parameters<AnalysisClassifier['classify']>[0]) => {
  const parsed = parseJevQueryJson(input.query)
  const instructions = parsed?.instructions ?? input.query
  const kind = parsed?.type ?? inferQuestionKind(input.query, input.classes, input.questionKind)
  if (kind === 'noul') return noul(instructions)
  if (kind === 'score') {
    const levels = parsed?.type === 'score' ? parsed.criteria : input.classes
    return score(instructions, scoreCriteriaFor(levels ?? []))
  }
  if (parsed?.type === 'choice') return choice(instructions, parsed.criteria)
  if (!input.classes || input.classes.length < 2) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
  return choice(instructions, classifierCriteriaFor(input.classes))
}

export interface ClassifierClientBoundary {
  systemOne(request: SystemOneRequest, options?: RequestOptions): Promise<unknown>
}

const sdkClassifierBoundary = (client: TypeSafeClient): ClassifierClientBoundary => ({
  systemOne: (request, options) => client.systemOne(request, options),
})

export interface TypeSafeClassifierProviderOptions {
  client?: ClassifierClientBoundary
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  fetch?: TypeSafeClientConfig['fetch']
}

export class TypeSafeClassifierProvider implements AnalysisClassifier {
  private readonly client?: ClassifierClientBoundary
  private readonly options: TypeSafeClassifierProviderOptions
  private initializedClient?: ClassifierClientBoundary

  constructor(options: TypeSafeClassifierProviderOptions = {}) {
    this.client = options.client
    this.options = options
  }

  assertConfigured(): void {
    if (!this.client && !hasTypeSafeApiKey({ apiKey: this.options.apiKey })) throw new AnalysisError('JEV_NOT_CONFIGURED', 'Jev is not configured', 503, false)
  }

  async classify(input: Parameters<AnalysisClassifier['classify']>[0]): Promise<AnalysisClassification> {
    const client = this.client ?? this.initializedClient ?? (this.initializedClient = sdkClassifierBoundary(new TypeSafeClient(createTypeSafeSdkConfig({
      apiKey: this.options.apiKey,
      baseURL: this.options.baseURL,
      timeoutMs: this.options.timeoutMs,
      fetch: this.options.fetch,
    }))))
    const questionKind = inferQuestionKind(input.query, input.classes, input.questionKind)
    const request: SystemOneRequest = {
      model: JEV_MODEL,
      state: { fixtureId: input.fixtureId, datasetId: input.datasetId, rowIndex: input.rowIndex, input: input.row } as unknown as EntryType,
      questions: { classification: questionFor(input) },
    }
    const baseKey = `analysis:${input.analysisId}:${input.rowIndex}`
    const attemptKeys = [baseKey, `${baseKey}:r1`]
    let lastError: unknown
    for (let attempt = 0; attempt < attemptKeys.length; attempt += 1) {
      try {
        const response = await client.systemOne(request, { headers: { 'Idempotency-Key': attemptKeys[attempt] } })
        return parseClassifierResponse(response, input.classes ?? [], questionKind)
      } catch (error) {
        lastError = error
        if (error instanceof AnalysisError) {
          if (error.code === 'JEV_MALFORMED_RESPONSE' && error.retryable && attempt < attemptKeys.length - 1) continue
          throw error
        }
        if (error instanceof APITimeoutError) throw new AnalysisError('JEV_TIMEOUT', 'Jev request timed out', 504, true)
        if (error instanceof APIConnectionError) throw new AnalysisError('JEV_CONNECTION', 'Jev connection failed', 502, true)
        if (error instanceof APIError) {
          const status = error.status
          throw new AnalysisError(`JEV_${status}`, 'Jev provider request failed', status === 401 ? 502 : status === 429 ? 503 : 502, status === 429 || status >= 500)
        }
        throw error
      }
    }
    throw lastError
  }
}

export const parseClassifierResponse = (
  value: unknown,
  classes: readonly string[] = [],
  questionKind: JevQuestionKind = inferQuestionKind('', classes),
): AnalysisClassification => {
  const extracted = extractClassifierAnswer(value)
  if (!extracted) throw malformed('Jev returned an invalid classification', true)
  const { model, answer } = extracted
  const type = answerTypeOf(answer)
  if (questionKind === 'noul' || type === 'noul') {
    const noulValue = asUnitNumber(answer.noul ?? answer.value ?? answer.probability)
    if ((type !== undefined && type !== 'noul') || noulValue === undefined) throw malformed('Jev returned an invalid noul')
    return { model, questionKind: 'noul', value: noulValue }
  }
  if (questionKind === 'score' || type === 'score') {
    const scoreValue = asFiniteNumber(answer.score ?? answer.value)
    if ((type !== undefined && type !== 'score') || scoreValue === undefined) throw malformed('Jev returned an invalid score')
    const levels = classes.length >= 2 ? classes.length : Object.keys(isRecord(answer.legend) ? answer.legend : {}).length
    const max = Math.max(1, levels - 1)
    const value01 = Math.min(1, Math.max(0, scoreValue / max))
    const confidence = answer.confidence === undefined ? undefined : asUnitNumber(answer.confidence)
    if (answer.confidence !== undefined && confidence === undefined) throw malformed('Jev returned invalid confidence')
    return {
      model,
      questionKind: 'score',
      value: value01,
      ...(confidence === undefined ? {} : { confidence }),
    }
  }
  const allowed = classes.length >= 2 ? classes : []
  const selected = typeof answer.choice === 'string' ? answer.choice.trim() : ''
  if (allowed.length < 2 || (type !== undefined && type !== 'choice') || !selected || !allowed.includes(selected) || !isRecord(answer.probabilities)) {
    throw malformed('Jev returned an invalid classification')
  }
  const probabilities: Record<string, number> = {}
  for (const className of allowed) {
    const probability = asUnitNumber(answer.probabilities[className])
    if (probability === undefined) throw malformed('Jev returned invalid class probabilities')
    probabilities[className] = probability
  }
  const total = Object.values(probabilities).reduce((sum, probability) => sum + probability, 0)
  if (Math.abs(total - 1) > PROBABILITY_SUM_RESCALE) throw malformed('Jev class probabilities are inconsistent')
  if (Math.abs(total - 1) > UNIT_EPSILON && total > 0) {
    for (const className of allowed) probabilities[className] = probabilities[className] / total
  }
  const confidence = answer.confidence === undefined ? undefined : asUnitNumber(answer.confidence)
  if (answer.confidence !== undefined && confidence === undefined) throw malformed('Jev returned invalid confidence')
  return { model, questionKind: 'choice', selectedClass: selected, probabilities, ...(confidence === undefined ? {} : { confidence }) }
}
