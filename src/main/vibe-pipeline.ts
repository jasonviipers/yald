import { EventEmitter } from 'events'
import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { log as _log } from './logger'
import { SandboxManager } from './sandbox'
import { BrowserAgentManager } from './browser-agent'
import { installSkill, listInstalledSkills, buildInstalledSkillsSystemPrompt } from './skills/store'
import { DEFAULT_BACKEND_URL, resolveBackendUrl } from '../shared/backend-url'
import type { PipelineStage, ProviderContext, VibePipelineState } from '../shared/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type StageId = PipelineStage['id']

interface PipelineRun {
  tabId: string
  prompt: string
  sandboxId: string
  abortController: AbortController
  state: VibePipelineState
  /** Structured log entries for self-diagnostic analysis */
  diagnosticLog: DiagnosticEntry[]
}

interface DiagnosticEntry {
  ts: number
  stage: StageId | 'init'
  level: 'info' | 'warn' | 'error'
  source: 'stdout' | 'stderr' | 'pipeline' | 'build' | 'runtime'
  message: string
}

interface SkillInventoryEntry {
  id: string
  name: string
  description: string
}

interface BrainstormBrief {
  problem: string
  mvp_features: string[]
  out_of_scope: string[]
  stack: { frontend: string; backend: string; db: string; rationale: string }
  data_model: Array<{ entity: string; fields: string[]; relations: string[] }>
  ux_flow: string[]
  file_architecture: string[]
  risks: string[]
  confidence: number
}

interface SkillForgeResult {
  name: string
  content: string
  covers: string[]
}

interface EngineerFile {
  path: string
  content: string
  layer: 'types' | 'constants' | 'utils' | 'data' | 'logic' | 'api' | 'ui' | 'entry' | 'config'
}

interface EngineerManifest {
  installCommand: string
  buildCommand: string
  startCommand: string
  entryPoint: string
  envVars: Array<{ key: string; description: string; required: boolean }>
  fileTree: string[]
  files: EngineerFile[]
}

interface BrowserReviewResult {
  initial_screenshot: string
  ux_flow_results: Array<{
    step: string
    status: 'pass' | 'fail'
    screenshot: string
    notes: string
  }>
  console_errors: string[]
  console_warnings: string[]
  edge_case_results: Array<{ case: string; status: 'pass' | 'fail'; notes: string }>
  overall_status: 'pass' | 'fail' | 'partial'
  review_complete: true
}

interface QAResult {
  status: 'pass' | 'fail' | 'partial'
  passing_features: string[]
  failing_features: Array<{ feature: string; root_cause: string }>
  console_errors: Array<{ message: string; severity: 'low' | 'medium' | 'high' }>
  edge_case_results: Array<{ case: string; status: 'pass' | 'fail'; notes: string }>
  recommendation: 'ship' | 'fix then ship' | 'needs redesign'
  delivery_summary: string
}

interface SelectorPlan {
  selector: string
  action: 'click' | 'type' | 'noop'
  text?: string
}

interface ChatPayload {
  message?: { content?: string }
  error?: { message?: string }
}

/**
 * Structured failure analysis produced by the self-diagnostic engine.
 * The engineer fix loop uses this to generate targeted patches instead of
 * blindly replaying the entire manifest at the model.
 */
interface DiagnosticReport {
  category:
    | 'missing_dependency'
    | 'missing_file'
    | 'type_error'
    | 'syntax_error'
    | 'runtime_crash'
    | 'port_not_exposed'
    | 'unknown'
  affectedFiles: string[]
  missingPackages: string[]
  errorMessages: string[]
  /** Condensed context sent to the fix-generating prompt */
  fixContext: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PIPELINE_STAGE_LABELS: Record<StageId, string> = {
  skill_inventory_check: 'Skill Inventory',
  brainstorm: 'Brainstorm',
  skill_forge: 'Skill Forge',
  engineer: 'Engineer',
  sandbox: 'Sandbox',
  browser: 'Browser Review',
  qa: 'QA Synthesis'
}

const ENGINEER_LAYER_ORDER: EngineerFile['layer'][] = [
  'types',
  'constants',
  'utils',
  'data',
  'logic',
  'api',
  'ui',
  'entry',
  'config'
]

/** Maximum number of self-heal iterations before we give up and surface the error. */
const MAX_SELF_HEAL_ATTEMPTS = 5

/** How many recent diagnostic log lines to include in a fix context. */
const DIAGNOSTIC_TAIL_LINES = 60

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(message: string): void {
  _log('vibe-pipeline', message)
}

// ─── Primitive helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function requiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(`${label} must be a non-empty string`)
  return normalized
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)))
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'skill'
  )
}

function titleCaseFromSlug(value: string): string {
  return value
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}

// ─── JSON parsing ─────────────────────────────────────────────────────────────

function parseJsonPayload(content: string): unknown {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const payload = (fenced?.[1] ?? trimmed).trim()
  try {
    return JSON.parse(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON payload: ${message}`)
  }
}

// ─── Ollama streaming helper ──────────────────────────────────────────────────

async function streamChatText(
  provider: ProviderContext,
  systemPrompt: string,
  userPrompt: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${resolveBackendUrl(provider.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  })

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => response.statusText)
    throw new Error(`Chat stream request failed (${response.status}): ${text}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        try {
          const parsed = JSON.parse(line) as { message?: { content?: unknown }; done?: boolean }
          const chunk = parsed.message?.content
          if (typeof chunk === 'string' && chunk) {
            fullText += chunk
            onChunk(chunk)
          }
        } catch {
          // Non-JSON line — skip silently
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    try {
      const parsed = JSON.parse(trailing) as { message?: { content?: unknown } }
      const chunk = parsed.message?.content
      if (typeof chunk === 'string' && chunk) {
        fullText += chunk
        onChunk(chunk)
      }
    } catch {
      // Ignore
    }
  }

  if (!fullText.trim()) throw new Error('Model stream response was empty')
  return fullText
}

// ─── Non-streaming JSON request ───────────────────────────────────────────────

async function requestChat(
  provider: ProviderContext,
  systemPrompt: string,
  userPrompt: string,
  format?: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${resolveBackendUrl(provider.baseUrl)}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.model,
      stream: false,
      format,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    }),
    signal
  })

  const payload = (await response.json()) as ChatPayload
  if (!response.ok) {
    throw new Error(payload.error?.message || response.statusText)
  }

  const content = payload.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(payload.error?.message || 'Model response was empty')
  }
  return content
}

// ─── Self-Diagnostic Engine ───────────────────────────────────────────────────
//
// The diagnostic engine is the core of the self-healing loop. It reads the
// structured DiagnosticEntry log accumulated during the pipeline run, classifies
// the failure into a category, extracts affected files and missing packages, and
// produces a compact fixContext string that is sent to the fix-generating prompt.
//
// This replaces the previous approach of passing raw stderr text directly to the
// model — which wasted context and led to unfocused fixes.

const MISSING_DEP_PATTERNS: RegExp[] = [
  /Cannot find module ['"]([^'"]+)['"]/,
  /Module not found.*['"]([^'"]+)['"]/,
  /Cannot resolve.*['"]([^'"]+)['"]/,
  /Error: Cannot find package '([^']+)'/,
  /npm ERR! 404.*'([^']+)'/,
  /Could not resolve ['"]([^'"]+)['"]/,
  /Package subpath '([^']+)' is not defined/
]

const MISSING_FILE_PATTERNS: RegExp[] = [
  /ENOENT.*no such file.*'([^']+)'/i,
  /Cannot find.*file.*['"]([^'"]+)['"]/i,
  /Failed to resolve import.*['"]([^'"]+)['"]/i
]

const TYPE_ERROR_PATTERNS: RegExp[] = [
  /TS\d{4}:/,
  /Type '.*' is not assignable/,
  /Property '.*' does not exist on type/,
  /Argument of type '.*' is not assignable/
]

const SYNTAX_ERROR_PATTERNS: RegExp[] = [
  /SyntaxError:/,
  /Unexpected token/,
  /Unexpected end of/,
  /Expected.*but found/,
  /Parsing error:/
]

function classifyDiagnosticEntries(entries: DiagnosticEntry[]): DiagnosticReport {
  const errorLines = entries
    .filter((e) => e.level === 'error' || e.source === 'stderr')
    .map((e) => e.message)

  const allLines = entries.map((e) => e.message)

  const missingPackages: string[] = []
  const affectedFiles: string[] = []
  const errorMessages: string[] = []

  for (const line of errorLines) {
    // Missing dependency detection
    for (const pattern of MISSING_DEP_PATTERNS) {
      const match = pattern.exec(line)
      if (match) {
        const pkg = match[1]
        // Only include external packages (not relative imports)
        if (!pkg.startsWith('.') && !pkg.startsWith('/')) {
          missingPackages.push(pkg.split('/')[0]) // strip sub-paths e.g. pkg/foo → pkg
        }
      }
    }

    // Missing file detection
    for (const pattern of MISSING_FILE_PATTERNS) {
      const match = pattern.exec(line)
      if (match) {
        affectedFiles.push(match[1])
      }
    }

    if (line.trim()) errorMessages.push(line.trim())
  }

  // Determine category
  let category: DiagnosticReport['category'] = 'unknown'
  const combined = errorLines.join('\n')

  if (missingPackages.length > 0) {
    category = 'missing_dependency'
  } else if (affectedFiles.length > 0) {
    category = 'missing_file'
  } else if (TYPE_ERROR_PATTERNS.some((p) => p.test(combined))) {
    category = 'type_error'
  } else if (SYNTAX_ERROR_PATTERNS.some((p) => p.test(combined))) {
    category = 'syntax_error'
  } else if (allLines.some((l) => /port|EADDRINUSE|listen/i.test(l))) {
    category = 'port_not_exposed'
  } else if (errorLines.some((l) => /crash|uncaught|unhandled|fatal/i.test(l))) {
    category = 'runtime_crash'
  }

  // Build a compact fixContext — tail of recent diagnostic lines + structured summary
  const tail = entries
    .slice(-DIAGNOSTIC_TAIL_LINES)
    .map((e) => `[${e.source}][${e.level}] ${e.message}`)
    .join('\n')

  const fixContext = [
    `FAILURE CATEGORY: ${category}`,
    missingPackages.length > 0
      ? `MISSING PACKAGES: ${uniqueStrings(missingPackages).join(', ')}`
      : '',
    affectedFiles.length > 0 ? `AFFECTED FILES: ${uniqueStrings(affectedFiles).join(', ')}` : '',
    `KEY ERRORS:\n${errorMessages.slice(0, 15).join('\n')}`,
    `\nRECENT LOG TAIL:\n${tail}`
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    category,
    affectedFiles: uniqueStrings(affectedFiles),
    missingPackages: uniqueStrings(missingPackages),
    errorMessages: uniqueStrings(errorMessages).slice(0, 15),
    fixContext
  }
}

// ─── Layer inference ──────────────────────────────────────────────────────────

function inferEngineerLayerFromPath(path: string): EngineerFile['layer'] {
  const n = path.replace(/\\/g, '/').toLowerCase()

  if (/\/(index|main|app)\.(t|j)sx?$/.test(n)) return 'entry'
  if (/^(index|main|app)\.(t|j)sx?$/.test(n)) return 'entry'
  if (/(^|\/)types?(\/|$)/.test(n)) return 'types'
  if (/(^|\/)interfaces?(\/|$)/.test(n)) return 'types'
  if (/\.d\.ts$/.test(n)) return 'types'
  if (/(^|\/)constants?(\/|$)/.test(n)) return 'constants'
  if (/(^|\/)enums?(\/|$)/.test(n)) return 'constants'
  if (/(^|\/)config(s|uration)?(\/|$)/.test(n)) return 'config'
  if (/(^|\/)settings?(\/|$)/.test(n)) return 'config'
  if (/vite\.config|tsconfig|eslint/.test(n)) return 'config'
  if (/(^|\/)utils?(\/|$)/.test(n)) return 'utils'
  if (/(^|\/)helpers?(\/|$)/.test(n)) return 'utils'
  if (/(^|\/)lib(s|rary)?(\/|$)/.test(n)) return 'utils'
  if (/(^|\/)shared(\/|$)/.test(n)) return 'utils'
  if (/(^|\/)data(\/|$)/.test(n)) return 'data'
  if (/(^|\/)db(\/|$)/.test(n)) return 'data'
  if (/(^|\/)storage(\/|$)/.test(n)) return 'data'
  if (/(^|\/)repositor(y|ies)(\/|$)/.test(n)) return 'data'
  if (/(^|\/)models?(\/|$)/.test(n)) return 'data'
  if (/(^|\/)schema(s)?(\/|$)/.test(n)) return 'data'
  if (/(^|\/)store(s)?(\/|$)/.test(n)) return 'logic'
  if (/(^|\/)state(\/|$)/.test(n)) return 'logic'
  if (/(^|\/)slice(s)?(\/|$)/.test(n)) return 'logic'
  if (/(^|\/)hook(s)?(\/|$)/.test(n)) return 'logic'
  if (/use[A-Z]/.test(path)) return 'logic'
  if (/(^|\/)service(s)?(\/|$)/.test(n)) return 'logic'
  if (/(^|\/)context(s)?(\/|$)/.test(n)) return 'logic'
  if (/(^|\/)api(\/|$)/.test(n)) return 'api'
  if (/(^|\/)routes?(\/|$)/.test(n)) return 'api'
  if (/(^|\/)server(\/|$)/.test(n)) return 'api'
  if (/(^|\/)controller(s)?(\/|$)/.test(n)) return 'api'
  if (/(^|\/)handler(s)?(\/|$)/.test(n)) return 'api'
  if (/(^|\/)component(s)?(\/|$)/.test(n)) return 'ui'
  if (/(^|\/)page(s)?(\/|$)/.test(n)) return 'ui'
  if (/(^|\/)screen(s)?(\/|$)/.test(n)) return 'ui'
  if (/(^|\/)view(s)?(\/|$)/.test(n)) return 'ui'
  if (/(^|\/)ui(\/|$)/.test(n)) return 'ui'
  if (/(^|\/)layout(s)?(\/|$)/.test(n)) return 'ui'
  if (/\.(css|scss|sass|less)$/.test(n)) return 'ui'
  if (/\.tsx$/.test(n)) return 'ui'

  return 'config'
}

function normalizeEngineerLayer(value: unknown, path: string): EngineerFile['layer'] {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_\-/]+/g, '')
      : ''

  const aliases: Record<string, EngineerFile['layer']> = {
    type: 'types',
    types: 'types',
    typing: 'types',
    typings: 'types',
    interface: 'types',
    interfaces: 'types',
    typedef: 'types',
    typedefs: 'types',
    dto: 'types',
    dtos: 'types',
    declaration: 'types',
    declarations: 'types',
    constant: 'constants',
    constants: 'constants',
    const: 'constants',
    consts: 'constants',
    enum: 'constants',
    enums: 'constants',
    literal: 'constants',
    literals: 'constants',
    config: 'config',
    configs: 'config',
    configuration: 'config',
    setting: 'config',
    settings: 'config',
    env: 'config',
    environment: 'config',
    options: 'config',
    util: 'utils',
    utils: 'utils',
    utility: 'utils',
    utilities: 'utils',
    helper: 'utils',
    helpers: 'utils',
    lib: 'utils',
    libs: 'utils',
    library: 'utils',
    shared: 'utils',
    common: 'utils',
    formatter: 'utils',
    formatters: 'utils',
    validator: 'utils',
    validators: 'utils',
    parser: 'utils',
    parsers: 'utils',
    data: 'data',
    db: 'data',
    database: 'data',
    storage: 'data',
    repository: 'data',
    repositories: 'data',
    schema: 'data',
    schemas: 'data',
    migration: 'data',
    migrations: 'data',
    model: 'data',
    models: 'data',
    logic: 'logic',
    service: 'logic',
    services: 'logic',
    businesslogic: 'logic',
    domain: 'logic',
    core: 'logic',
    state: 'logic',
    store: 'logic',
    stores: 'logic',
    slice: 'logic',
    slices: 'logic',
    reducer: 'logic',
    reducers: 'logic',
    context: 'logic',
    contexts: 'logic',
    hook: 'logic',
    hooks: 'logic',
    customhook: 'logic',
    customhooks: 'logic',
    usecase: 'logic',
    usecases: 'logic',
    action: 'logic',
    actions: 'logic',
    selector: 'logic',
    selectors: 'logic',
    middleware: 'logic',
    api: 'api',
    apis: 'api',
    route: 'api',
    routes: 'api',
    router: 'api',
    routers: 'api',
    server: 'api',
    servers: 'api',
    controller: 'api',
    controllers: 'api',
    endpoint: 'api',
    endpoints: 'api',
    handler: 'api',
    handlers: 'api',
    httphandler: 'api',
    httpmiddleware: 'api',
    request: 'api',
    requests: 'api',
    response: 'api',
    responses: 'api',
    ui: 'ui',
    component: 'ui',
    components: 'ui',
    page: 'ui',
    pages: 'ui',
    screen: 'ui',
    screens: 'ui',
    view: 'ui',
    views: 'ui',
    layout: 'ui',
    layouts: 'ui',
    widget: 'ui',
    widgets: 'ui',
    template: 'ui',
    templates: 'ui',
    presentational: 'ui',
    presentation: 'ui',
    modal: 'ui',
    modals: 'ui',
    panel: 'ui',
    panels: 'ui',
    form: 'ui',
    forms: 'ui',
    style: 'ui',
    styles: 'ui',
    stylesheet: 'ui',
    stylesheets: 'ui',
    css: 'ui',
    scss: 'ui',
    sass: 'ui',
    styledcomponent: 'ui',
    styledcomponents: 'ui',
    reactcomponent: 'ui',
    entry: 'entry',
    entrypoint: 'entry',
    main: 'entry',
    index: 'entry',
    app: 'entry',
    bootstrap: 'entry',
    root: 'entry',
    init: 'entry',
    initializer: 'entry',
    startup: 'entry'
  }

  if (raw && aliases[raw] !== undefined) return aliases[raw]

  for (const [alias, layer] of Object.entries(aliases)) {
    if (raw.includes(alias) || alias.includes(raw)) return layer
  }

  return inferEngineerLayerFromPath(path)
}

// ─── Payload unwrapping ───────────────────────────────────────────────────────

function unwrapEngineerPayload(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (Array.isArray(value.files) && value.files.length > 0) return value

  const WRAPPER_KEYS = ['manifest', 'result', 'app', 'output', 'response', 'data', 'payload']
  for (const key of WRAPPER_KEYS) {
    const inner = value[key]
    if (isRecord(inner) && Array.isArray(inner.files) && inner.files.length > 0) return inner
  }

  const FILE_ALT_KEYS = ['fileList', 'file_list', 'fileManifest', 'file_manifest', 'items']
  for (const key of FILE_ALT_KEYS) {
    if (Array.isArray(value[key]) && (value[key] as unknown[]).length > 0) {
      return { ...value, files: value[key] }
    }
  }

  return value
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeBrainstormBrief(value: unknown): BrainstormBrief {
  if (!isRecord(value)) throw new Error('Brainstorm response was not a JSON object')
  const stack = isRecord(value.stack) ? value.stack : {}
  const rawDataModel = Array.isArray(value.data_model) ? value.data_model : []
  return {
    problem: asString(value.problem),
    mvp_features: asStringArray(value.mvp_features),
    out_of_scope: asStringArray(value.out_of_scope),
    stack: {
      frontend: asString(stack.frontend) || asString(stack.fontend),
      backend: asString(stack.backend),
      db: asString(stack.db),
      rationale: asString(stack.rationale)
    },
    data_model: rawDataModel
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        entity: asString(item.entity),
        fields: asStringArray(item.fields),
        relations: asStringArray(item.relations)
      })),
    ux_flow: asStringArray(value.ux_flow),
    file_architecture: asStringArray(value.file_architecture),
    risks: asStringArray(value.risks),
    confidence: asNumber(value.confidence)
  }
}

function isUsableBrainstormBrief(brief: BrainstormBrief): boolean {
  return Boolean(
    brief.problem.trim() &&
    brief.stack.frontend.trim() &&
    brief.mvp_features.length > 0 &&
    brief.ux_flow.length > 0
  )
}

function normalizeSkillForgeResult(value: unknown): SkillForgeResult {
  if (!isRecord(value)) throw new Error('Skill forge response was not a JSON object')
  const covers = asStringArray(value.covers)
  if (covers.length === 0)
    throw new Error('Skill forge result.covers must contain at least one string')
  return {
    name: requiredString(value.name, 'Skill forge result.name'),
    content: requiredString(value.content, 'Skill forge result.content'),
    covers
  }
}

function normalizeEngineerFile(value: unknown, label: string): EngineerFile {
  if (!isRecord(value)) throw new Error(`${label} must be a JSON object`)
  const path = requiredString(value.path, `${label}.path`)
  return {
    path,
    content: requiredString(value.content, `${label}.content`),
    layer: normalizeEngineerLayer(value.layer, path)
  }
}

function normalizeEngineerManifest(value: unknown): EngineerManifest {
  const unwrapped = unwrapEngineerPayload(value)
  if (!isRecord(unwrapped)) throw new Error('Engineer response was not a JSON object')

  const files = Array.isArray(unwrapped.files)
    ? unwrapped.files
    : Array.isArray(unwrapped.fileList)
      ? unwrapped.fileList
      : Array.isArray(unwrapped.file_list)
        ? unwrapped.file_list
        : []

  if (files.length === 0) {
    throw new Error(
      `Engineer manifest contained no files. ` +
        `Keys present: [${Object.keys(unwrapped).join(', ')}]. ` +
        `Expected a "files" array with at least one {path, content, layer} object.`
    )
  }

  const normalizedFiles = files.map((item, index) =>
    normalizeEngineerFile(item, `Engineer manifest.files[${index}]`)
  )

  const startCommand =
    optionalString(unwrapped.startCommand) ||
    optionalString(unwrapped.start_command) ||
    optionalString(unwrapped.runCommand) ||
    optionalString(unwrapped.run_command) ||
    optionalString(unwrapped.devCommand) ||
    optionalString(unwrapped.dev_command)

  if (!startCommand) throw new Error('Engineer manifest.startCommand must be a non-empty string')

  const envVars = Array.isArray(unwrapped.envVars)
    ? unwrapped.envVars
    : Array.isArray(unwrapped.env_vars)
      ? unwrapped.env_vars
      : []

  const fileTree = asStringArray(unwrapped.fileTree ?? unwrapped.file_tree)

  return {
    installCommand:
      optionalString(unwrapped.installCommand) || optionalString(unwrapped.install_command),
    buildCommand: optionalString(unwrapped.buildCommand) || optionalString(unwrapped.build_command),
    startCommand,
    entryPoint:
      optionalString(unwrapped.entryPoint) ||
      optionalString(unwrapped.entry_point) ||
      normalizedFiles[0].path,
    envVars: envVars.map((item, index) => {
      if (!isRecord(item))
        throw new Error(`Engineer manifest.envVars[${index}] must be a JSON object`)
      return {
        key: requiredString(item.key, `Engineer manifest.envVars[${index}].key`),
        description: requiredString(
          item.description,
          `Engineer manifest.envVars[${index}].description`
        ),
        required: asBoolean(item.required)
      }
    }),
    fileTree: fileTree.length > 0 ? fileTree : normalizedFiles.map((f) => f.path),
    files: normalizedFiles
  }
}

function normalizeEngineerFilePatch(value: unknown): Pick<EngineerManifest, 'files'> {
  if (Array.isArray(value) && value.length > 0) {
    return {
      files: value.map((item, i) => normalizeEngineerFile(item, `Engineer fix.files[${i}]`))
    }
  }

  if (!isRecord(value)) throw new Error('Engineer fix response was not a JSON object')

  const FILE_KEYS = [
    'files',
    'changedFiles',
    'changed_files',
    'fixedFiles',
    'fixed_files',
    'patches',
    'items',
    'fileList',
    'file_list'
  ]
  for (const key of FILE_KEYS) {
    const candidate = value[key]
    if (Array.isArray(candidate) && candidate.length > 0) {
      return {
        files: candidate.map((item, i) => normalizeEngineerFile(item, `Engineer fix.${key}[${i}]`))
      }
    }
  }

  const WRAPPER_KEYS = ['fix', 'result', 'output', 'response', 'data', 'manifest', 'payload']
  for (const wk of WRAPPER_KEYS) {
    const inner = value[wk]
    if (!isRecord(inner)) continue
    for (const fk of FILE_KEYS) {
      const candidate = inner[fk]
      if (Array.isArray(candidate) && candidate.length > 0) {
        return {
          files: candidate.map((item, i) =>
            normalizeEngineerFile(item, `Engineer fix.${wk}.${fk}[${i}]`)
          )
        }
      }
    }
  }

  throw new Error(
    `Engineer fix response contained no files. ` +
      `Keys present: [${Object.keys(value).join(', ')}]. ` +
      `Expected a "files" array with at least one {path, content, layer} object.`
  )
}

const SELECTOR_ACTION_ALIASES: Record<string, SelectorPlan['action']> = {
  click: 'click',
  tap: 'click',
  press: 'click',
  select: 'click',
  toggle: 'click',
  check: 'click',
  uncheck: 'click',
  submit: 'click',
  activate: 'click',
  open: 'click',
  close: 'click',
  expand: 'click',
  collapse: 'click',
  type: 'type',
  input: 'type',
  fill: 'type',
  enter: 'type',
  write: 'type',
  set: 'type',
  insert: 'type',
  paste: 'type',
  clear: 'type',
  search: 'type',
  noop: 'noop',
  observe: 'noop',
  verify: 'noop',
  check_text: 'noop',
  scroll: 'noop',
  hover: 'noop',
  focus: 'noop',
  wait: 'noop',
  navigate: 'noop',
  read: 'noop',
  assert: 'noop',
  none: 'noop',
  screenshot: 'noop',
  view: 'noop',
  inspect: 'noop'
}

function normalizeSelectorAction(value: unknown): SelectorPlan['action'] {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '_')
      : ''
  if (SELECTOR_ACTION_ALIASES[raw] !== undefined) return SELECTOR_ACTION_ALIASES[raw]
  for (const [alias, action] of Object.entries(SELECTOR_ACTION_ALIASES)) {
    if (raw.startsWith(alias) || raw.endsWith(alias)) return action
  }
  return 'noop'
}

function normalizeSelectorPlan(value: unknown): SelectorPlan {
  if (!isRecord(value)) throw new Error('Selector plan response was not a JSON object')
  const action = normalizeSelectorAction(value.action)
  const selectorValue = asString(value.selector).trim()
  const resolvedAction = !selectorValue && action !== 'noop' ? 'noop' : action
  return {
    selector: selectorValue,
    action: resolvedAction,
    text: asString(value.text).trim() || undefined
  }
}

function normalizeQAStatus(value: unknown): QAResult['status'] {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '')
      : ''
  const map: Record<string, QAResult['status']> = {
    pass: 'pass',
    passed: 'pass',
    success: 'pass',
    successful: 'pass',
    ok: 'pass',
    green: 'pass',
    complete: 'pass',
    completed: 'pass',
    done: 'pass',
    fail: 'fail',
    failed: 'fail',
    failure: 'fail',
    error: 'fail',
    broken: 'fail',
    red: 'fail',
    crash: 'fail',
    crashed: 'fail',
    partial: 'partial',
    partialpass: 'partial',
    partialsuccess: 'partial',
    mixed: 'partial',
    incomplete: 'partial',
    needswork: 'partial',
    pending: 'partial',
    yellow: 'partial',
    warning: 'partial',
    warn: 'partial'
  }
  return map[raw] ?? 'partial'
}

function normalizeQAStepStatus(value: unknown): 'pass' | 'fail' {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '')
      : ''
  const passes = new Set(['pass', 'passed', 'success', 'ok', 'true', 'complete', 'done', 'green'])
  return passes.has(raw) ? 'pass' : 'fail'
}

function normalizeQASeverity(value: unknown): 'low' | 'medium' | 'high' {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '')
      : ''
  const map: Record<string, 'low' | 'medium' | 'high'> = {
    low: 'low',
    minor: 'low',
    info: 'low',
    verbose: 'low',
    trivial: 'low',
    negligible: 'low',
    medium: 'medium',
    moderate: 'medium',
    warning: 'medium',
    warn: 'medium',
    mid: 'medium',
    high: 'high',
    critical: 'high',
    severe: 'high',
    fatal: 'high',
    error: 'high',
    major: 'high'
  }
  return map[raw] ?? 'low'
}

function normalizeQARecommendation(value: unknown): QAResult['recommendation'] {
  const raw =
    typeof value === 'string'
      ? value
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '')
      : ''
  const map: Record<string, QAResult['recommendation']> = {
    ship: 'ship',
    deploy: 'ship',
    release: 'ship',
    launch: 'ship',
    ready: 'ship',
    good: 'ship',
    approve: 'ship',
    approved: 'ship',
    lgtm: 'ship',
    fixthenships: 'fix then ship',
    fixthenrelease: 'fix then ship',
    fixandship: 'fix then ship',
    fixfirst: 'fix then ship',
    needsfix: 'fix then ship',
    needsfixes: 'fix then ship',
    minorfixes: 'fix then ship',
    almostready: 'fix then ship',
    closetodone: 'fix then ship',
    needsredesign: 'needs redesign',
    redesign: 'needs redesign',
    rework: 'needs redesign',
    rewrite: 'needs redesign',
    majorchanges: 'needs redesign',
    startover: 'needs redesign',
    blocked: 'needs redesign',
    notready: 'needs redesign',
    broken: 'needs redesign'
  }
  if (map[raw] !== undefined) return map[raw]
  if (raw.includes('ship')) return raw.includes('fix') ? 'fix then ship' : 'ship'
  if (raw.includes('fix') || raw.includes('minor') || raw.includes('tweak')) return 'fix then ship'
  if (raw.includes('redesign') || raw.includes('rewrite') || raw.includes('rework'))
    return 'needs redesign'
  return 'fix then ship'
}

function normalizeQAResult(value: unknown): QAResult {
  if (!isRecord(value)) throw new Error('QA response was not a JSON object')

  const raw = isRecord(value.result) ? value.result : value
  const failingFeatures = Array.isArray(raw.failing_features)
    ? raw.failing_features
    : Array.isArray(raw.failed_features)
      ? raw.failed_features
      : Array.isArray(raw.failures)
        ? raw.failures
        : []
  const consoleErrors = Array.isArray(raw.console_errors)
    ? raw.console_errors
    : Array.isArray(raw.errors)
      ? raw.errors
      : []
  const edgeCaseResults = Array.isArray(raw.edge_case_results)
    ? raw.edge_case_results
    : Array.isArray(raw.edge_cases)
      ? raw.edge_cases
      : []

  const deliverySummary =
    optionalString(raw.delivery_summary) ||
    optionalString(raw.summary) ||
    optionalString(raw.description) ||
    optionalString(raw.report) ||
    'No delivery summary provided.'

  return {
    status: normalizeQAStatus(raw.status),
    passing_features: asStringArray(raw.passing_features ?? raw.passed_features ?? raw.passed),
    failing_features: failingFeatures
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        feature: asString(item.feature ?? item.name ?? item.title),
        root_cause: asString(item.root_cause ?? item.cause ?? item.reason ?? item.description)
      })),
    console_errors: consoleErrors
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        message: asString(item.message ?? item.text ?? item.error),
        severity: normalizeQASeverity(item.severity ?? item.level)
      })),
    edge_case_results: edgeCaseResults
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .map((item) => ({
        case: asString(item.case ?? item.name ?? item.description),
        status: normalizeQAStepStatus(item.status ?? item.result),
        notes: asString(item.notes ?? item.message ?? item.detail ?? '')
      })),
    recommendation: normalizeQARecommendation(raw.recommendation ?? raw.verdict ?? raw.action),
    delivery_summary: deliverySummary
  }
}

// ─── Skill gap resolution ─────────────────────────────────────────────────────
//
// SKILL-FIRST: Before forging any new skill, we perform a two-pass relevance
// check against the installed inventory:
//   Pass 1 — exact name/slug match
//   Pass 2 — semantic keyword overlap between the technical gap and each
//             installed skill's name + description
//
// A gap is only handed to SkillForge when both passes fail. This prevents
// redundant skill creation and makes the pipeline respect existing user investment.

/** Well-known technical patterns and the brief fields they map to */
const TECH_SKILL_PATTERNS: Array<{ match: RegExp; skillName: string; keywords: string[] }> = [
  {
    match: /canvas|game.?loop|sprite|tilemap|physics/i,
    skillName: 'html5-canvas-game',
    keywords: ['canvas', 'game', 'sprite', 'physics']
  },
  {
    match: /react.*dnd|drag.?and.?drop|sortable/i,
    skillName: 'react-dnd',
    keywords: ['dnd', 'drag', 'drop', 'sortable']
  },
  {
    match: /websocket|socket\.io|realtime/i,
    skillName: 'websocket-realtime',
    keywords: ['websocket', 'socket', 'realtime']
  },
  {
    match: /sqlite|drizzle|prisma|orm/i,
    skillName: 'sqlite-orm',
    keywords: ['sqlite', 'orm', 'drizzle', 'prisma', 'database']
  },
  {
    match: /auth|jwt|session|passport/i,
    skillName: 'auth-jwt',
    keywords: ['auth', 'jwt', 'session', 'login']
  },
  {
    match: /stripe|payment|checkout/i,
    skillName: 'stripe-payments',
    keywords: ['stripe', 'payment', 'checkout']
  },
  {
    match: /chart\.js|recharts|d3|apexcharts/i,
    skillName: 'data-visualisation',
    keywords: ['chart', 'graph', 'visualization', 'd3', 'recharts']
  },
  { match: /three\.js|webgl|3d/i, skillName: 'threejs-3d', keywords: ['three', 'webgl', '3d'] },
  {
    match: /markdown|mdx|remark/i,
    skillName: 'markdown-rendering',
    keywords: ['markdown', 'mdx', 'remark']
  },
  {
    match: /csv|xlsx|spreadsheet/i,
    skillName: 'spreadsheet-parsing',
    keywords: ['csv', 'xlsx', 'spreadsheet']
  }
]

/**
 * Check whether an installed skill covers a given gap based on keyword overlap.
 * Returns true if enough keywords from the gap match the skill's name/description.
 */
function installedSkillCoversGap(skill: SkillInventoryEntry, gapKeywords: string[]): boolean {
  const haystack = `${skill.name} ${skill.description}`.toLowerCase()
  const matchCount = gapKeywords.filter((kw) => haystack.includes(kw.toLowerCase())).length
  // Require at least 2 keyword matches OR 50% of keywords to avoid false positives
  return matchCount >= 2 || (gapKeywords.length > 0 && matchCount / gapKeywords.length >= 0.5)
}

function skillGapsFromBrief(
  brief: BrainstormBrief,
  skills: SkillInventoryEntry[]
): Array<{ gapName: string; keywords: string[] }> {
  const techSurface = [
    brief.stack.frontend,
    brief.stack.backend,
    brief.stack.db,
    brief.stack.rationale,
    ...brief.mvp_features,
    ...brief.risks
  ].join(' ')

  const gaps: Array<{ gapName: string; keywords: string[] }> = []

  for (const { match, skillName, keywords } of TECH_SKILL_PATTERNS) {
    if (!match.test(techSurface)) continue

    // Pass 1: exact slug/name match
    const exactMatch = skills.some(
      (s) =>
        s.name.toLowerCase().replace(/[^a-z0-9]/g, '') === skillName.replace(/[^a-z0-9]/g, '') ||
        s.id.includes(skillName.split('-')[0])
    )
    if (exactMatch) continue

    // Pass 2: semantic keyword overlap
    const semanticMatch = skills.some((s) => installedSkillCoversGap(s, keywords))
    if (semanticMatch) continue

    // Both passes failed — this is a genuine gap
    gaps.push({ gapName: skillName, keywords })
  }

  return gaps
}

// ─── Fallback generators ──────────────────────────────────────────────────────

function inferFrontend(prompt: string): string {
  const n = prompt.toLowerCase()
  if (/\belectron\b/.test(n)) return 'Electron + React'
  if (/\breact\b/.test(n)) return 'React + Vite'
  if (/\bvue\b/.test(n)) return 'Vue + Vite'
  return 'React + Vite'
}

function inferBackend(prompt: string): string {
  const n = prompt.toLowerCase()
  if (/\blocal.?storage\b/.test(n)) return 'none'
  if (/\bapi\b|\bserver\b|\bbackend\b|\bauth\b|\bwebhook\b/.test(n)) return 'Bun + Hono'
  return 'none'
}

function inferDataStore(prompt: string, backend: string): string {
  const n = prompt.toLowerCase()
  if (/\blocal.?storage\b/.test(n)) return 'localStorage'
  if (/\bsqlite\b/.test(n)) return 'SQLite'
  if (/\bpostgres\b/.test(n)) return 'PostgreSQL'
  return backend === 'none' ? 'localStorage' : 'SQLite'
}

function classifyAppType(prompt: string): 'game' | 'tool' | 'dashboard' | 'api' | 'generic' {
  const n = prompt.toLowerCase()
  if (
    /\bgame\b|\bminecraft\b|\bpong\b|\bsnake\b|\btetris\b|\bshoote\b|\bplatform\b|\bpuzzle\b|\bchess\b|\barcade\b/.test(
      n
    )
  )
    return 'game'
  if (/\bdashboard\b|\banalytics\b|\bmetric\b|\bchart\b|\bgraph\b|\bmonitor\b|\bstat\b/.test(n))
    return 'dashboard'
  if (/\bapi\b|\bserver\b|\bbackend\b|\bendpoint\b|\bwebhook\b/.test(n)) return 'api'
  if (/\btool\b|\butility\b|\bconverter\b|\bcalculator\b|\beditor\b|\bviewer\b|\bscanner\b/.test(n))
    return 'tool'
  return 'generic'
}

function buildFallbackMvpFeaturesForPrompt(prompt: string, appType: string): string[] {
  const n = prompt.toLowerCase()
  if (appType === 'game') {
    return [
      `Playable ${prompt.trim()} game loop`,
      'Keyboard or mouse controls',
      'Score or progress tracking',
      'Game over and restart state',
      'Basic visual rendering'
    ]
  }
  if (appType === 'dashboard') {
    return [
      `Primary ${prompt.trim()} data view`,
      'Charts or visual metrics',
      'Data filtering or time range selection',
      'Responsive layout',
      'Sample or mock data for demonstration'
    ]
  }
  const features = [
    `Core ${prompt.trim()} functionality`,
    'Clean, usable UI',
    'Error handling and empty states'
  ]
  if (/\bcrud\b|\bcreate\b|\bedit\b|\bdelete\b/i.test(n))
    features.push('Create, edit, and delete records')
  if (/\bsearch\b|\bfilter\b/i.test(n)) features.push('Search and filter')
  if (/\blocal.?storage\b/i.test(n)) features.push('Persist data in localStorage')
  return uniqueStrings(features).slice(0, 5)
}

function buildFallbackUxFlowForPrompt(prompt: string, appType: string): string[] {
  if (appType === 'game') {
    return [
      'Open the game and see the start screen',
      'Press a key or click to begin playing',
      'Play the game using the controls',
      'Reach a game-over state',
      'Restart and play again'
    ]
  }
  if (appType === 'dashboard') {
    return [
      'Open the dashboard and see the main view',
      'Interact with a chart or filter',
      'View updated data or metrics'
    ]
  }
  const usesLocal = /\blocal.?storage\b/i.test(prompt)
  return [
    `Open the ${prompt.trim()} app`,
    'Use the primary feature',
    'See the result immediately',
    usesLocal ? 'Refresh the page and confirm data persists' : 'Confirm the action succeeded'
  ]
}

function buildFallbackDataModelForPrompt(
  prompt: string,
  appType: string
): BrainstormBrief['data_model'] {
  if (appType === 'game') {
    return [
      {
        entity: 'GameState',
        fields: ['score', 'level', 'lives', 'status', 'startedAt'],
        relations: []
      },
      { entity: 'Player', fields: ['x', 'y', 'velocity', 'health'], relations: ['GameState'] }
    ]
  }
  if (appType === 'dashboard') {
    return [
      { entity: 'Metric', fields: ['id', 'label', 'value', 'unit', 'timestamp'], relations: [] }
    ]
  }
  const entityName =
    prompt
      .trim()
      .split(/\s+/)
      .find((w) => w.length > 3 && !/^(create|build|make|write|add|the|a|an)$/i.test(w))
      ?.replace(/[^a-zA-Z]/g, '') || 'Record'
  const capitalised = entityName.charAt(0).toUpperCase() + entityName.slice(1)
  return [{ entity: capitalised, fields: ['id', 'title', 'status', 'createdAt'], relations: [] }]
}

function buildFallbackBrainstormBrief(prompt: string): BrainstormBrief {
  const trimmed = prompt.trim() || 'requested app'
  const backend = inferBackend(trimmed)
  const db = inferDataStore(trimmed, backend)
  const appType = classifyAppType(trimmed)

  const frontend = appType === 'game' ? 'HTML5 Canvas + vanilla TypeScript' : inferFrontend(trimmed)

  return {
    problem: `Users want to ${trimmed.toLowerCase().startsWith('create') || trimmed.toLowerCase().startsWith('build') || trimmed.toLowerCase().startsWith('make') ? trimmed : `use a ${trimmed}`}.`,
    mvp_features: buildFallbackMvpFeaturesForPrompt(trimmed, appType),
    out_of_scope: [
      'User authentication and accounts',
      'Online multiplayer or real-time sync',
      'Mobile app packaging'
    ],
    stack: {
      frontend,
      backend,
      db: appType === 'game' ? 'none' : db,
      rationale: `Fallback brief for "${trimmed}". Model output was invalid — generated locally.`
    },
    data_model: buildFallbackDataModelForPrompt(trimmed, appType),
    ux_flow: buildFallbackUxFlowForPrompt(trimmed, appType),
    file_architecture:
      appType === 'game'
        ? [
            'src/main.ts',
            'src/game.ts',
            'src/renderer.ts',
            'src/input.ts',
            'src/state.ts',
            'index.html'
          ]
        : ['src/main.tsx', 'src/App.tsx', 'src/components/', 'src/lib/'],
    risks: [
      `Fallback brief for "${trimmed}" — less tailored than a model-generated response.`,
      'Complexity may require follow-up implementation passes.'
    ],
    confidence: 0.55
  }
}

function buildFallbackSkillForgeResult(gap: string): SkillForgeResult {
  const normalizedGap = gap.trim() || 'general-capability'
  const slug = slugify(normalizedGap)
  const skillName = titleCaseFromSlug(slug)
  const content = [
    '---',
    `name: ${slug}`,
    `description: Fallback skill for ${normalizedGap}. Generated locally after invalid SkillForge model output.`,
    '---',
    '',
    `# ${skillName}`,
    '',
    '## Purpose',
    `Provide reusable implementation guidance for ${normalizedGap}.`,
    '',
    '## When to Use',
    `- When the task clearly depends on ${normalizedGap}.`,
    '',
    '## Procedure',
    '1. Restate the requirement in concrete technical terms.',
    '2. Identify the minimum file and runtime changes required.',
    '3. Implement the smallest working version first.',
    '4. Typecheck or run the narrowest verification command available.',
    '',
    '## Quality Checklist',
    '- [ ] Inputs and outputs are explicitly typed.',
    '- [ ] Error cases are handled and surfaced clearly.',
    '',
    '## Known Pitfalls',
    '- Over-scoping the solution before validating the minimum path.'
  ].join('\n')
  return { name: slug, content, covers: [normalizedGap] }
}

// ─── Pipeline state helpers ───────────────────────────────────────────────────

function createInitialState(sandboxId: string): VibePipelineState {
  const stages: PipelineStage[] = (
    [
      'skill_inventory_check',
      'brainstorm',
      'skill_forge',
      'engineer',
      'sandbox',
      'browser',
      'qa'
    ] as StageId[]
  ).map((id) => ({
    id,
    label: PIPELINE_STAGE_LABELS[id],
    status: 'pending',
    startedAt: null,
    completedAt: null
  }))
  return {
    stages,
    activeStage: null,
    log: [],
    sandboxId,
    sandboxUrl: null,
    deliverySummary: null,
    error: null
  }
}

function defaultProvider(): ProviderContext {
  return {
    providerId: 'ollama',
    model: 'gpt-oss:120b',
    baseUrl: resolveBackendUrl(undefined, DEFAULT_BACKEND_URL),
    transport: 'api'
  }
}

// ─── Missing-file synthesis ───────────────────────────────────────────────────

function synthesiseMissingImports(files: EngineerFile[]): Array<{ path: string; content: string }> {
  const writtenPaths = new Set(files.map((f) => f.path.replace(/\\/g, '/').replace(/^\.\//, '')))
  const IMPORT_RE = /(?:import\s+(?:.*?\s+from\s+)?|require\s*\(\s*)['"](\.[^'"]+)['"]/g
  const stubs: Array<{ path: string; content: string }> = []
  const alreadySynthesised = new Set<string>()

  for (const file of files) {
    const fileDir = file.path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')

    let match: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((match = IMPORT_RE.exec(file.content)) !== null) {
      const importedRaw = match[1]
      const resolved = fileDir ? `${fileDir}/${importedRaw}` : importedRaw
      const normalised = resolved
        .replace(/\\/g, '/')
        .replace(/\/\.\//g, '/')
        .replace(/^\.\//, '')

      const candidates = /\.\w+$/.test(normalised)
        ? [normalised]
        : [
            `${normalised}.ts`,
            `${normalised}.tsx`,
            `${normalised}.js`,
            `${normalised}.jsx`,
            `${normalised}/index.ts`,
            `${normalised}/index.tsx`
          ]

      if (candidates.some((c) => writtenPaths.has(c))) continue

      const stubPath = /\.\w+$/.test(importedRaw)
        ? (fileDir ? `${fileDir}/${importedRaw}` : importedRaw).replace(/^\.\//, '')
        : (fileDir ? `${fileDir}/${importedRaw}.ts` : `${importedRaw}.ts`).replace(/^\.\//, '')

      if (alreadySynthesised.has(stubPath)) continue
      alreadySynthesised.add(stubPath)
      writtenPaths.add(stubPath)

      const ext = stubPath.split('.').pop() ?? ''
      let content = ''
      if (ext === 'css' || ext === 'scss' || ext === 'sass' || ext === 'less') {
        content = `/* Auto-generated stub for ${stubPath} */\n`
      } else if (ext === 'json') {
        content = '{}\n'
      } else if (ext === 'svg') {
        content = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>\n`
      } else {
        content = `// Auto-generated stub for ${stubPath}\nexport default {}\n`
      }

      stubs.push({ path: stubPath, content })
    }
  }

  return stubs
}

// ─── Pipeline manager ─────────────────────────────────────────────────────────

export class VibePipelineManager extends EventEmitter {
  private activeRuns = new Map<string, PipelineRun>()

  constructor(
    private readonly sandboxManager: SandboxManager,
    private readonly browserAgent: BrowserAgentManager
  ) {
    super()
  }

  async run(tabId: string, prompt: string, sandboxId: string): Promise<void> {
    if (this.activeRuns.has(tabId)) {
      throw new Error(`A vibe pipeline is already running for tab ${tabId}`)
    }

    const run: PipelineRun = {
      tabId,
      prompt,
      sandboxId,
      abortController: new AbortController(),
      state: createInitialState(sandboxId),
      diagnosticLog: []
    }
    this.activeRuns.set(tabId, run)

    try {
      const provider = defaultProvider()

      // ── Stage: skill inventory ──────────────────────────────────────────────
      // Load all installed skills upfront. We'll use them in two ways:
      //   1. To build a skills system prompt that enriches the engineer agent
      //   2. To avoid forging new skills that are already covered
      this.emitStage(run, 'skill_inventory_check')
      const installedSkills = (await listInstalledSkills()).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description
      }))
      this.emitLog(run, `Loaded ${installedSkills.length} installed skill(s).`)

      // Build the skills system prompt once — reused in engineer and fix prompts
      const skillsSystemPrompt = (await buildInstalledSkillsSystemPrompt()) ?? ''
      if (skillsSystemPrompt) {
        this.emitLog(
          run,
          `Skills context available for engineer: ${installedSkills.map((s) => s.name).join(', ')}.`
        )
      }

      this.completeStage(run, 'skill_inventory_check')

      // ── Stage: brainstorm ───────────────────────────────────────────────────
      this.emitStage(run, 'brainstorm')
      const brief = await this.runBrainstorm(provider, prompt, run)
      this.emitLog(run, `Brainstorm complete. Confidence: ${brief.confidence}.`)
      this.completeStage(run, 'brainstorm')

      // ── Stage: skill forge ──────────────────────────────────────────────────
      // SKILL-FIRST: only forge skills for gaps that are genuinely uncovered.
      // The two-pass check (exact match + semantic overlap) means most runs will
      // skip this stage entirely when the user already has relevant skills installed.
      let skillInventory = installedSkills
      const technicalGaps = skillGapsFromBrief(brief, installedSkills)

      if (technicalGaps.length > 0) {
        this.emitStage(run, 'skill_forge')
        for (const { gapName, keywords } of technicalGaps) {
          // Final check: semantic re-verify against the now-updated inventory
          // (in case a just-forged skill covers multiple gaps)
          if (skillInventory.some((s) => installedSkillCoversGap(s, keywords))) {
            this.emitLog(
              run,
              `Gap "${gapName}" already covered by a recently forged skill — skipping.`
            )
            continue
          }

          this.emitLog(run, `Forging new skill for uncovered gap: "${gapName}"...`)
          const forged = await this.runSkillForge(provider, gapName, run.abortController.signal)
          const skillPath = await this.writeSkillToHome(forged)
          const installed = await installSkill(skillPath)
          skillInventory = [
            ...skillInventory,
            { id: installed.id, name: installed.name, description: installed.description }
          ]
          this.emitLog(run, `Forged and installed skill "${installed.name}".`)
        }
        this.completeStage(run, 'skill_forge')
      } else {
        // Mark skill_forge complete even when skipped so the UI shows all stages
        this.completeStage(run, 'skill_forge')
        this.emitLog(
          run,
          `Skill forge skipped — all technical gaps covered by ${installedSkills.length} installed skill(s).`
        )
      }

      // ── Stage: engineer ─────────────────────────────────────────────────────
      this.emitStage(run, 'engineer')
      const manifest = await this.runEngineer(
        provider,
        prompt,
        brief,
        skillInventory,
        skillsSystemPrompt,
        run
      )
      await this.applyEngineerManifest(run, manifest)
      this.completeStage(run, 'engineer')

      // ── Stage: sandbox ──────────────────────────────────────────────────────
      this.emitStage(run, 'sandbox')

      await this.ensureSandboxPackageJson(run, manifest)

      // Install dependencies
      if (manifest.installCommand.trim()) {
        this.emitLog(run, `[sandbox] Running install: ${manifest.installCommand}`)
        let installResult = await this.sandboxManager.exec(
          sandboxId,
          manifest.installCommand,
          { timeoutMs: 120_000 },
          {
            onStdoutLine: (line) => {
              this.emitLog(run, `[install] ${line}`)
              this.pushDiagnostic(run, 'sandbox', 'info', 'stdout', line)
            },
            onStderrLine: (line) => {
              this.emitLog(run, `[install] ${line}`)
              this.pushDiagnostic(run, 'sandbox', 'warn', 'stderr', line)
            }
          }
        )

        if (installResult.exitCode !== 0) {
          this.emitLog(
            run,
            `[sandbox] Install failed (exit ${installResult.exitCode}), retrying once...`
          )
          this.pushDiagnostic(
            run,
            'sandbox',
            'error',
            'pipeline',
            `Install failed with exit code ${installResult.exitCode}: ${installResult.stderr.slice(-400)}`
          )

          installResult = await this.sandboxManager.exec(
            sandboxId,
            manifest.installCommand,
            { timeoutMs: 120_000 },
            {
              onStdoutLine: (line) => {
                this.emitLog(run, `[install retry] ${line}`)
                this.pushDiagnostic(run, 'sandbox', 'info', 'stdout', line)
              },
              onStderrLine: (line) => {
                this.emitLog(run, `[install retry] ${line}`)
                this.pushDiagnostic(run, 'sandbox', 'error', 'stderr', line)
              }
            }
          )

          if (installResult.exitCode !== 0) {
            const errorText = installResult.stderr.slice(-800) || installResult.stdout.slice(-800)
            this.pushDiagnostic(
              run,
              'sandbox',
              'error',
              'pipeline',
              `Install retry failed: ${errorText}`
            )
            throw new Error(errorText || 'Sandbox install command failed after retry')
          }
        }
        this.emitLog(run, `[sandbox] Install complete.`)
      }

      // ── Build with self-healing loop ────────────────────────────────────────
      if (manifest.buildCommand.trim()) {
        this.emitLog(run, `[sandbox] Running build: ${manifest.buildCommand}`)
        let buildPassed = false

        for (let attempt = 1; attempt <= MAX_SELF_HEAL_ATTEMPTS; attempt++) {
          const buildResult = await this.sandboxManager.exec(
            sandboxId,
            manifest.buildCommand,
            { timeoutMs: 90_000 },
            {
              onStdoutLine: (line) => {
                this.emitLog(run, `[build] ${line}`)
                this.pushDiagnostic(run, 'sandbox', 'info', 'build', line)
              },
              onStderrLine: (line) => {
                this.emitLog(run, `[build] ${line}`)
                this.pushDiagnostic(run, 'sandbox', 'error', 'build', line)
              }
            }
          )

          this.emitLog(
            run,
            `[sandbox] Build attempt ${attempt}/${MAX_SELF_HEAL_ATTEMPTS} — exit ${buildResult.exitCode}.`
          )

          if (buildResult.exitCode === 0) {
            buildPassed = true
            break
          }

          if (attempt === MAX_SELF_HEAL_ATTEMPTS) {
            const report = classifyDiagnosticEntries(run.diagnosticLog)
            throw new Error(
              `Build failed after ${MAX_SELF_HEAL_ATTEMPTS} self-heal attempts.\n` +
                `Category: ${report.category}\n` +
                (report.missingPackages.length > 0
                  ? `Missing packages: ${report.missingPackages.join(', ')}\n`
                  : '') +
                buildResult.stderr.slice(-800) || buildResult.stdout.slice(-800)
            )
          }

          // Produce a diagnostic report from the accumulated log and use it to
          // generate a targeted fix — rather than passing raw stderr to the model.
          const report = classifyDiagnosticEntries(run.diagnosticLog)
          this.emitLog(
            run,
            `[self-heal] Attempt ${attempt}/${MAX_SELF_HEAL_ATTEMPTS} — category: ${report.category}. Generating targeted fix...`
          )

          // Special case: missing dependency detected — patch package.json directly
          // rather than asking the model to regenerate files for a trivial add.
          if (report.category === 'missing_dependency' && report.missingPackages.length > 0) {
            await this.applyMissingDependencyPatch(run, manifest, report.missingPackages)
            // Re-run install before next build attempt
            await this.sandboxManager.exec(sandboxId, manifest.installCommand, {
              timeoutMs: 120_000
            })
          } else {
            const fixes = await this.requestEngineerFix(
              provider,
              manifest,
              report,
              skillsSystemPrompt
            )
            for (const file of fixes.files) {
              await this.sandboxManager.writeFile(sandboxId, file.path, file.content)
              this.emitLog(run, `[self-heal] Applied fix to ${file.path}.`)
              this.pushDiagnostic(
                run,
                'sandbox',
                'info',
                'pipeline',
                `Self-heal applied fix to ${file.path}`
              )
            }
          }
        }

        if (buildPassed) this.emitLog(run, `[sandbox] Build complete.`)
      }

      // ── Start dev server ────────────────────────────────────────────────────
      this.emitLog(run, `[sandbox] Starting server: ${manifest.startCommand}`)
      await this.sandboxManager.exec(
        sandboxId,
        manifest.startCommand,
        { timeoutMs: 0 },
        {
          onStdoutLine: (line) => {
            this.emitLog(run, `[server] ${line}`)
            this.pushDiagnostic(run, 'sandbox', 'info', 'runtime', line)
          },
          onStderrLine: (line) => {
            this.emitLog(run, `[server] ${line}`)
            this.pushDiagnostic(run, 'sandbox', 'warn', 'runtime', line)
          }
        }
      )

      await new Promise<void>((resolve) => setTimeout(resolve, 1500))

      const sandboxPort = await this.sandboxManager.exposePort(sandboxId)
      run.state.sandboxUrl = sandboxPort.url
      this.emit('sandbox-ready', tabId, sandboxPort.url)
      this.emitLog(run, `[sandbox] Server ready at ${sandboxPort.url}.`)
      this.completeStage(run, 'sandbox')

      // ── Stage: browser review ───────────────────────────────────────────────
      this.emitStage(run, 'browser')
      const browserReport = await this.runBrowserReview(
        provider,
        sandboxPort.url,
        brief.ux_flow,
        run
      )
      this.emitLog(run, `Browser review: ${browserReport.overall_status}.`)
      this.completeStage(run, 'browser')

      // ── Stage: QA synthesis ─────────────────────────────────────────────────
      this.emitStage(run, 'qa')
      const qa = await this.runQa(provider, prompt, brief, manifest, browserReport, run)
      run.state.deliverySummary = qa.delivery_summary
      this.emitLog(run, `QA recommendation: ${qa.recommendation}.`)
      this.completeStage(run, 'qa')
      this.emit('pipeline-complete', tabId, qa.delivery_summary)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      run.state.error = message
      this.failActiveStage(run)
      this.emit('pipeline-error', tabId, message)
      throw error
    } finally {
      this.activeRuns.delete(tabId)
    }
  }

  async stop(tabId: string): Promise<void> {
    const run = this.activeRuns.get(tabId)
    if (!run) return
    run.abortController.abort()
    await this.browserAgent.close()
    await this.sandboxManager.destroy(run.sandboxId)
    this.activeRuns.delete(tabId)
    this.emit('pipeline-log', tabId, '[pipeline] stopped')
  }

  // ─── Diagnostic log ─────────────────────────────────────────────────────────

  /**
   * Append a structured diagnostic entry. These are separate from the user-facing
   * pipeline log — they are used by the self-diagnostic engine to classify failures
   * and generate targeted fix contexts.
   */
  private pushDiagnostic(
    run: PipelineRun,
    stage: StageId | 'init',
    level: DiagnosticEntry['level'],
    source: DiagnosticEntry['source'],
    message: string
  ): void {
    run.diagnosticLog.push({ ts: Date.now(), stage, level, source, message })
    // Keep the diagnostic log bounded — most recent entries are most useful
    if (run.diagnosticLog.length > 600) run.diagnosticLog.shift()
  }

  // ─── Stage helpers ──────────────────────────────────────────────────────────

  private emitStage(run: PipelineRun, stageId: StageId): void {
    run.state.activeStage = stageId
    run.state.stages = run.state.stages.map((s) =>
      s.id === stageId ? { ...s, status: 'running', startedAt: Date.now() } : s
    )
    this.emit('pipeline-stage', run.tabId, stageId)
    log(`tab=${run.tabId} stage=${stageId}`)
  }

  private completeStage(run: PipelineRun, stageId: StageId): void {
    run.state.stages = run.state.stages.map((s) =>
      s.id === stageId ? { ...s, status: 'complete', completedAt: Date.now() } : s
    )
  }

  private failActiveStage(run: PipelineRun): void {
    const activeStage = run.state.activeStage
    if (!activeStage) return
    run.state.stages = run.state.stages.map((s) =>
      s.id === activeStage ? { ...s, status: 'failed', completedAt: Date.now() } : s
    )
  }

  private emitLog(run: PipelineRun, line: string): void {
    run.state.log.push(line)
    if (run.state.log.length > 400) run.state.log.shift()
    this.emit('pipeline-log', run.tabId, line)
  }

  // ─── Brainstorm ─────────────────────────────────────────────────────────────

  private async runBrainstorm(
    provider: ProviderContext,
    prompt: string,
    run: PipelineRun
  ): Promise<BrainstormBrief> {
    const signal = run.abortController.signal

    this.emitLog(run, '[brainstorm] Analysing prompt...')
    try {
      await streamChatText(
        provider,
        'You are the Brainstorm Agent. The user asked you to build: ' +
          JSON.stringify(prompt) +
          '. ' +
          'In 1-2 sentences, describe what you are going to build that directly fulfils their request. ' +
          'Never mention to-do lists or generic CRUD apps unless the user explicitly asked for one. Plain text only — no JSON.',
        prompt,
        (chunk) => this.emitLog(run, chunk),
        signal
      )
    } catch {
      // Non-fatal
    }

    const schema: Record<string, unknown> = {
      type: 'object',
      required: [
        'problem',
        'mvp_features',
        'out_of_scope',
        'stack',
        'data_model',
        'ux_flow',
        'file_architecture',
        'risks',
        'confidence'
      ],
      properties: {
        problem: { type: 'string' },
        mvp_features: { type: 'array', items: { type: 'string' } },
        out_of_scope: { type: 'array', items: { type: 'string' } },
        stack: {
          type: 'object',
          required: ['frontend', 'backend', 'db', 'rationale'],
          properties: {
            frontend: { type: 'string' },
            backend: { type: 'string' },
            db: { type: 'string' },
            rationale: { type: 'string' }
          }
        },
        data_model: {
          type: 'array',
          items: {
            type: 'object',
            required: ['entity', 'fields', 'relations'],
            properties: {
              entity: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
              relations: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        ux_flow: { type: 'array', items: { type: 'string' } },
        file_architecture: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' }
      }
    }

    const systemPrompt = [
      'You are the Brainstorm Agent.',
      'The user has given you a specific app to build.',
      'You MUST build EXACTLY what the user asked for — do not substitute a different, simpler, or more generic app.',
      'If the user asked for a game, build a game. If they asked for a Minecraft clone, build a Minecraft clone.',
      'Never default to a to-do list, notes app, or CRUD app unless the user explicitly asked for one.',
      'Return strict JSON matching the schema.',
      "Produce a concise MVP brief that directly addresses the user's stated request."
    ].join(' ')

    const userMessage = [
      `User request: "${prompt}"`,
      '',
      'Return a JSON object with these exact keys:',
      '- problem: string',
      '- mvp_features: string[]',
      '- out_of_scope: string[]',
      '- stack: { frontend, backend, db, rationale }',
      '- data_model: [{ entity, fields, relations }]',
      '- ux_flow: string[]',
      '- file_architecture: string[]',
      '- risks: string[]',
      '- confidence: number between 0 and 1'
    ].join('\n')

    try {
      const content = await requestChat(provider, systemPrompt, userMessage, schema, signal)
      const brief = normalizeBrainstormBrief(parseJsonPayload(content))
      if (isUsableBrainstormBrief(brief)) return brief
      throw new Error('Brainstorm brief was missing required fields')
    } catch (error) {
      this.emitLog(
        run,
        `[brainstorm] Attempt 1 failed: ${error instanceof Error ? error.message : String(error)}. Retrying...`
      )
    }

    try {
      const retry = await requestChat(
        provider,
        'Return ONLY a JSON object for this request. No explanation, no markdown. The JSON must have: problem, mvp_features, out_of_scope, stack (with frontend/backend/db/rationale), data_model, ux_flow, file_architecture, risks, confidence.',
        userMessage,
        schema,
        signal
      )
      const brief = normalizeBrainstormBrief(parseJsonPayload(retry))
      if (isUsableBrainstormBrief(brief)) return brief
      throw new Error('Brainstorm retry brief was still missing required fields')
    } catch (error) {
      this.emitLog(
        run,
        `[brainstorm] Attempt 2 failed: ${error instanceof Error ? error.message : String(error)}. Using fallback.`
      )
    }

    return buildFallbackBrainstormBrief(prompt)
  }

  // ─── Skill forge ────────────────────────────────────────────────────────────

  private async runSkillForge(
    provider: ProviderContext,
    gap: string,
    signal: AbortSignal
  ): Promise<SkillForgeResult> {
    const schema: Record<string, unknown> = {
      type: 'object',
      required: ['name', 'content', 'covers'],
      properties: {
        name: { type: 'string' },
        content: { type: 'string' },
        covers: { type: 'array', items: { type: 'string' } }
      }
    }
    const systemPrompt =
      'You are the SkillForge Agent. Return SKILL.md content for the missing capability. The markdown must include frontmatter with name and description.'
    const userPrompt = `Forge a skill for this gap: ${gap}`

    try {
      const content = await requestChat(provider, systemPrompt, userPrompt, schema, signal)
      return normalizeSkillForgeResult(parseJsonPayload(content))
    } catch {
      try {
        const retry = await requestChat(
          provider,
          `${systemPrompt} Previous response was invalid. Return only valid JSON with escaped markdown content.`,
          userPrompt,
          schema,
          signal
        )
        return normalizeSkillForgeResult(parseJsonPayload(retry))
      } catch {
        return buildFallbackSkillForgeResult(gap)
      }
    }
  }

  private async writeSkillToHome(skill: SkillForgeResult): Promise<string> {
    const skillDir = join(homedir(), '.claude', 'skills', slugify(skill.name))
    await mkdir(skillDir, { recursive: true })
    const targetPath = join(skillDir, 'SKILL.md')
    await writeFile(targetPath, skill.content, 'utf8')
    return targetPath
  }

  // ─── Engineer ───────────────────────────────────────────────────────────────
  // The engineer prompt now incorporates the installed skills system prompt so the
  // model can follow skill-specific patterns (e.g. preferred canvas game loop
  // structure, ORM usage conventions) directly during generation.

  private async runEngineer(
    provider: ProviderContext,
    prompt: string,
    brief: BrainstormBrief,
    skills: SkillInventoryEntry[],
    skillsSystemPrompt: string,
    run: PipelineRun
  ): Promise<EngineerManifest> {
    const signal = run.abortController.signal
    const schema: Record<string, unknown> = {
      type: 'object',
      required: [
        'installCommand',
        'buildCommand',
        'startCommand',
        'entryPoint',
        'envVars',
        'fileTree',
        'files'
      ],
      properties: {
        installCommand: { type: 'string' },
        buildCommand: { type: 'string' },
        startCommand: { type: 'string' },
        entryPoint: { type: 'string' },
        envVars: {
          type: 'array',
          items: {
            type: 'object',
            required: ['key', 'description', 'required'],
            properties: {
              key: { type: 'string' },
              description: { type: 'string' },
              required: { type: 'boolean' }
            }
          }
        },
        fileTree: { type: 'array', items: { type: 'string' } },
        files: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'content', 'layer'],
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              layer: { type: 'string', enum: ENGINEER_LAYER_ORDER }
            }
          }
        }
      }
    }

    // Combine the fixed engineer instructions with any installed skills guidance
    const systemPrompt = [
      skillsSystemPrompt ? skillsSystemPrompt + '\n\n---\n' : '',
      'You are the Engineer Agent. Return strict JSON matching the schema.',
      `THE USER ASKED FOR: "${prompt}". Build EXACTLY that. Do not substitute a simpler or different app.`,
      'If the user asked for a game, write a real playable game. If they asked for a Minecraft clone, write a 3D or 2D block-building game.',
      'NEVER generate a to-do list, notes app, or generic CRUD app unless the user explicitly asked for one.',
      'Generate a minimal but complete working app manifest with all source file contents.',
      'Prefer Bun, Vite, React, or plain Node only when the brief requires them.',
      'For games: use HTML5 Canvas with vanilla TypeScript — no React needed.',
      'IMPORTANT: Always include a package.json in the files array.',
      'The package.json MUST list every dependency the app needs under "dependencies" or "devDependencies".',
      'Do NOT assume any package is pre-installed globally.',
      'All plugins and loaders (e.g. @vitejs/plugin-react) must appear in package.json.',
      'For "installCommand" use "bun install" or "npm install".',
      'For "startCommand" and "buildCommand" use "bun run dev", "npm run dev", etc.',
      'Never use bare "vite", "tsc", or "react-scripts" — always prefix with "bun run" or "npx".',
      '"files" is required and must contain at least one object with path, content, and layer.',
      `Valid layer values: ${ENGINEER_LAYER_ORDER.join(', ')}.`
    ].join(' ')

    const userPayload = JSON.stringify({ prompt, brief, skills }, null, 2)

    this.emitLog(run, '[engineer] Generating file manifest...')

    let lastError = ''

    try {
      const content = await requestChat(provider, systemPrompt, userPayload, schema, signal)
      return normalizeEngineerManifest(parseJsonPayload(content))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      this.emitLog(run, `[engineer] Attempt 1 failed: ${lastError}. Retrying with error context...`)
    }

    const correctionPrompt = `${systemPrompt} Your previous response was rejected: "${lastError}". Fix the issue and return only valid JSON.`
    try {
      const content = await requestChat(provider, correctionPrompt, userPayload, schema, signal)
      return normalizeEngineerManifest(parseJsonPayload(content))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      this.emitLog(run, `[engineer] Attempt 2 failed: ${lastError}. Using minimal prompt...`)
    }

    const minimalPrompt = [
      'Return a JSON object with exactly these keys:',
      '"installCommand" (string, e.g. "bun install"),',
      '"buildCommand" (string, e.g. "bun run build" or empty string),',
      '"startCommand" (string, required, e.g. "bun run dev"),',
      '"entryPoint" (string, path to main file),',
      '"envVars" (array, can be empty),',
      '"fileTree" (array of path strings),',
      '"files" (array of objects — each must have "path" (string), "content" (full file source as string),',
      `and "layer" (one of: ${ENGINEER_LAYER_ORDER.join(', ')})).`,
      'Include every source file needed to run the app. No explanation, no markdown fences.'
    ].join(' ')
    const content = await requestChat(provider, minimalPrompt, userPayload, schema, signal)
    return normalizeEngineerManifest(parseJsonPayload(content))
  }

  // ─── Apply manifest ─────────────────────────────────────────────────────────

  private async applyEngineerManifest(run: PipelineRun, manifest: EngineerManifest): Promise<void> {
    const groupedByLayer = new Map<EngineerFile['layer'], EngineerFile[]>()
    for (const file of manifest.files) {
      const bucket = groupedByLayer.get(file.layer) ?? []
      bucket.push(file)
      groupedByLayer.set(file.layer, bucket)
    }

    for (const layer of ENGINEER_LAYER_ORDER) {
      const files = groupedByLayer.get(layer) ?? []
      if (files.length === 0) continue
      for (const file of files) {
        await this.sandboxManager.writeFile(run.sandboxId, file.path, file.content)
        this.emitLog(run, `Wrote ${file.path} (${layer}).`)
        this.pushDiagnostic(run, 'engineer', 'info', 'pipeline', `Wrote ${file.path}`)
      }
    }

    const stubs = synthesiseMissingImports(manifest.files)
    for (const stub of stubs) {
      await this.sandboxManager.writeFile(run.sandboxId, stub.path, stub.content)
      this.emitLog(run, `Synthesised missing file ${stub.path} (stub).`)
      this.pushDiagnostic(
        run,
        'engineer',
        'warn',
        'pipeline',
        `Synthesised stub for missing import: ${stub.path}`
      )
    }
  }

  // ─── Self-healing fix request ────────────────────────────────────────────────
  // Now receives a DiagnosticReport instead of raw stderr, and also receives the
  // skills system prompt so the model can follow skill guidance when patching.

  private async requestEngineerFix(
    provider: ProviderContext,
    manifest: EngineerManifest,
    report: DiagnosticReport,
    skillsSystemPrompt: string
  ): Promise<Pick<EngineerManifest, 'files'>> {
    const schema: Record<string, unknown> = {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'content', 'layer'],
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              layer: { type: 'string', enum: ENGINEER_LAYER_ORDER }
            }
          }
        }
      }
    }

    const fixContext = JSON.stringify(
      {
        diagnosticReport: {
          category: report.category,
          missingPackages: report.missingPackages,
          affectedFiles: report.affectedFiles,
          keyErrors: report.errorMessages
        },
        fileTree: manifest.fileTree,
        entryPoint: manifest.entryPoint,
        startCommand: manifest.startCommand,
        logContext: report.fixContext
      },
      null,
      2
    )

    const systemPrompt = [
      skillsSystemPrompt ? skillsSystemPrompt + '\n\n---\n' : '',
      'You are the Engineer Agent performing a targeted self-heal fix.',
      'A build or runtime failure has been diagnosed. You are given a structured diagnostic report.',
      'Return ONLY the files that need to change to resolve the reported failure.',
      'Focus the fix on the specific failure category — do not rewrite unrelated files.',
      'Each file must have "path" (string), "content" (complete corrected file source), and',
      `"layer" (one of: ${ENGINEER_LAYER_ORDER.join(', ')}).`,
      'Return a JSON object with a "files" array. No explanation, no markdown fences.'
    ]
      .filter(Boolean)
      .join(' ')

    let lastError = ''

    try {
      const content = await requestChat(provider, systemPrompt, fixContext, schema)
      return normalizeEngineerFilePatch(parseJsonPayload(content))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log(`requestEngineerFix attempt 1 failed: ${lastError}`)
    }

    const correctionPrompt = `${systemPrompt} Previous response was rejected: "${lastError}". Fix the structure and return only valid JSON.`
    try {
      const content = await requestChat(provider, correctionPrompt, fixContext, schema)
      return normalizeEngineerFilePatch(parseJsonPayload(content))
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      log(`requestEngineerFix attempt 2 failed: ${lastError}`)
    }

    const minimalPrompt = [
      'Fix the build failure described below.',
      'Return JSON: { "files": [ { "path": "...", "content": "...", "layer": "..." } ] }.',
      `Valid layer values: ${ENGINEER_LAYER_ORDER.join(', ')}.`,
      'Include only the files that changed. No explanation.'
    ].join(' ')
    const content = await requestChat(provider, minimalPrompt, fixContext, schema)
    return normalizeEngineerFilePatch(parseJsonPayload(content))
  }

  /**
   * Patch package.json in-place to add missing packages detected by the
   * diagnostic engine. This avoids a full model round-trip for the common case
   * of a missing npm dependency.
   */
  private async applyMissingDependencyPatch(
    run: PipelineRun,
    manifest: EngineerManifest,
    missingPackages: string[]
  ): Promise<void> {
    const pkgFile = manifest.files.find(
      (f) => f.path === 'package.json' || f.path.endsWith('/package.json')
    )

    let pkg: Record<string, unknown> = {}
    if (pkgFile) {
      try {
        pkg = JSON.parse(pkgFile.content) as Record<string, unknown>
      } catch {
        /* ignore */
      }
    } else {
      try {
        const raw = await this.sandboxManager.readFile(run.sandboxId, 'package.json')
        pkg = JSON.parse(raw) as Record<string, unknown>
      } catch {
        /* no existing package.json */
      }
    }

    const deps = (isRecord(pkg.dependencies) ? pkg.dependencies : {}) as Record<string, string>
    const devDeps = (isRecord(pkg.devDependencies) ? pkg.devDependencies : {}) as Record<
      string,
      string
    >

    for (const pkg_ of missingPackages) {
      if (!deps[pkg_] && !devDeps[pkg_]) {
        // Default to "latest" — the install command will resolve the real version
        deps[pkg_] = 'latest'
        this.emitLog(run, `[self-heal] Added missing dependency "${pkg_}" to package.json.`)
        this.pushDiagnostic(
          run,
          'sandbox',
          'info',
          'pipeline',
          `Patched package.json: added ${pkg_}`
        )
      }
    }

    const updated = JSON.stringify(
      { ...pkg, dependencies: deps, devDependencies: devDeps },
      null,
      2
    )
    await this.sandboxManager.writeFile(run.sandboxId, 'package.json', updated)
  }

  // ─── Sandbox helpers ────────────────────────────────────────────────────────

  private async ensureSandboxPackageJson(
    run: PipelineRun,
    manifest: EngineerManifest
  ): Promise<void> {
    const pkgFile = manifest.files.find(
      (f) => f.path === 'package.json' || f.path.endsWith('/package.json')
    )

    const viteConfig = manifest.files.find(
      (f) => f.path.endsWith('vite.config.ts') || f.path.endsWith('vite.config.js')
    )
    const extraDeps: Record<string, string> = {}
    if (viteConfig) {
      if (viteConfig.content.includes('@vitejs/plugin-react'))
        extraDeps['@vitejs/plugin-react'] = '^4.0.0'
      if (viteConfig.content.includes('@vitejs/plugin-vue'))
        extraDeps['@vitejs/plugin-vue'] = '^4.0.0'
      if (viteConfig.content.includes('@vitejs/plugin-svelte'))
        extraDeps['@vitejs/plugin-svelte'] = '^3.0.0'
    }

    if (pkgFile) {
      if (Object.keys(extraDeps).length === 0) return
      try {
        const parsed = JSON.parse(pkgFile.content) as Record<string, unknown>
        const dev = (isRecord(parsed.devDependencies) ? parsed.devDependencies : {}) as Record<
          string,
          string
        >
        let patched = false
        for (const [dep, version] of Object.entries(extraDeps)) {
          const deps = (isRecord(parsed.dependencies) ? parsed.dependencies : {}) as Record<
            string,
            string
          >
          if (!deps[dep] && !dev[dep]) {
            dev[dep] = version
            patched = true
          }
        }
        if (!patched) return
        const updated = JSON.stringify({ ...parsed, devDependencies: dev }, null, 2)
        await this.sandboxManager.writeFile(run.sandboxId, pkgFile.path, updated)
        this.emitLog(
          run,
          `[sandbox] Patched package.json with missing devDependencies: ${Object.keys(extraDeps).join(', ')}.`
        )
      } catch {
        // Non-fatal
      }
      return
    }

    const name =
      run.prompt
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'yald-app'

    const scripts: Record<string, string> = {}
    if (manifest.buildCommand.trim()) {
      scripts.build = manifest.buildCommand.replace(/^(?:npm run|bun run|yarn)\s+/, '')
    }
    if (manifest.startCommand.trim()) {
      const dev = manifest.startCommand.replace(/^(?:npm run|bun run|yarn)\s+/, '')
      scripts.dev = dev
      scripts.start = dev
    }

    const allContent = manifest.files.map((f) => f.content).join('\n')
    const inferredDeps: Record<string, string> = {}
    const inferredDev: Record<string, string> = { ...extraDeps }

    if (allContent.includes("from 'react'") || allContent.includes('from "react"')) {
      inferredDeps['react'] = '^18.0.0'
      inferredDeps['react-dom'] = '^18.0.0'
      inferredDev['@types/react'] = '^18.0.0'
      inferredDev['@types/react-dom'] = '^18.0.0'
    }
    if (viteConfig) inferredDev['vite'] = '^5.0.0'
    if (allContent.includes("from 'hono'") || allContent.includes('from "hono"')) {
      inferredDeps['hono'] = '^4.0.0'
    }
    if (allContent.includes("from 'zustand'") || allContent.includes('from "zustand"')) {
      inferredDeps['zustand'] = '^4.0.0'
    }

    const pkg = JSON.stringify(
      {
        name,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts,
        dependencies: inferredDeps,
        devDependencies: inferredDev
      },
      null,
      2
    )

    try {
      await this.sandboxManager.writeFile(run.sandboxId, 'package.json', pkg)
      this.emitLog(run, '[sandbox] Wrote fallback package.json with inferred dependencies.')
    } catch {
      // Non-fatal
    }
  }

  // ─── Browser review ─────────────────────────────────────────────────────────

  private async runBrowserReview(
    provider: ProviderContext,
    sandboxUrl: string,
    uxFlow: string[],
    run: PipelineRun
  ): Promise<BrowserReviewResult> {
    const signal = run.abortController.signal
    await this.browserAgent.navigate(sandboxUrl)
    const initialScreenshot = await this.browserAgent.screenshot()
    const results: BrowserReviewResult['ux_flow_results'] = []

    for (const step of uxFlow) {
      const dom = await this.browserAgent.readDom('body')
      const selectorPlan = await this.requestSelectorPlan(
        provider,
        step,
        dom.slice(0, 18000),
        signal
      )
      try {
        if (selectorPlan.action === 'click' && selectorPlan.selector) {
          await this.browserAgent.click(selectorPlan.selector)
        } else if (selectorPlan.action === 'type' && selectorPlan.selector) {
          await this.browserAgent.type(selectorPlan.selector, selectorPlan.text || 'test')
        }
        const screenshot = await this.browserAgent.screenshot()
        const consoleEntries = await this.browserAgent.consoleLogs()
        results.push({
          step,
          status: 'pass',
          screenshot,
          notes: consoleEntries.map((e) => `${e.level}: ${e.message}`).join('\n')
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const screenshot = await this.browserAgent.screenshot()
        results.push({ step, status: 'fail', screenshot, notes: message })
        this.emitLog(run, `[browser] Step failed: ${step} — ${message}`)
        this.pushDiagnostic(
          run,
          'browser',
          'error',
          'runtime',
          `Browser step failed: ${step} — ${message}`
        )
      }
    }

    const allConsole = await this.browserAgent.consoleLogs()
    const consoleErrors = allConsole
      .filter((e) => e.level.toLowerCase().includes('error'))
      .map((e) => e.message)
    const consoleWarnings = allConsole
      .filter((e) => e.level.toLowerCase().includes('warn'))
      .map((e) => e.message)

    // Push browser console errors into the diagnostic log for post-QA analysis
    for (const err of consoleErrors) {
      this.pushDiagnostic(run, 'browser', 'error', 'runtime', `[console error] ${err}`)
    }

    const edgeCaseResults = await this.runBrowserEdgeCases(sandboxUrl)
    await this.browserAgent.close()

    const passed = results.filter((r) => r.status === 'pass').length
    const overallStatus: BrowserReviewResult['overall_status'] =
      passed === results.length ? 'pass' : passed > 0 ? 'partial' : 'fail'

    return {
      initial_screenshot: initialScreenshot,
      ux_flow_results: results,
      console_errors: consoleErrors,
      console_warnings: consoleWarnings,
      edge_case_results: edgeCaseResults,
      overall_status: overallStatus,
      review_complete: true
    }
  }

  private async requestSelectorPlan(
    provider: ProviderContext,
    step: string,
    dom: string,
    signal: AbortSignal
  ): Promise<SelectorPlan> {
    const schema: Record<string, unknown> = {
      type: 'object',
      required: ['selector', 'action'],
      properties: {
        selector: { type: 'string' },
        action: { type: 'string', enum: ['click', 'type', 'noop'] },
        text: { type: 'string' }
      }
    }

    const systemPrompt = [
      'You convert a UX step description into a single CSS selector + action plan.',
      'Return strict JSON with exactly: "selector" (CSS selector string or "" if not applicable),',
      '"action" (MUST be one of: click, type, noop — nothing else), and optionally "text" (string to type).',
      'Use "noop" for steps that are observational, navigational, or cannot be done with a single selector.',
      'Never use scroll, hover, focus, submit, navigate, or any other action word — only click, type, or noop.'
    ].join(' ')

    const userPrompt = JSON.stringify({ step, dom }, null, 2)

    try {
      const content = await requestChat(provider, systemPrompt, userPrompt, schema, signal)
      return normalizeSelectorPlan(parseJsonPayload(content))
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log(`requestSelectorPlan attempt 1 failed for step "${step}": ${msg} — retrying`)
    }

    try {
      const content = await requestChat(
        provider,
        'Return JSON: { "selector": "CSS_SELECTOR_OR_EMPTY", "action": "click|type|noop", "text": "optional" }. action MUST be one of those three words only.',
        `Step: ${step}`,
        schema,
        signal
      )
      return normalizeSelectorPlan(parseJsonPayload(content))
    } catch {
      log(`requestSelectorPlan both attempts failed for step "${step}" — defaulting to noop`)
      return { selector: '', action: 'noop', text: undefined }
    }
  }

  private async runBrowserEdgeCases(
    sandboxUrl: string
  ): Promise<BrowserReviewResult['edge_case_results']> {
    const results: BrowserReviewResult['edge_case_results'] = []
    try {
      await this.browserAgent.navigate(sandboxUrl)
      try {
        await this.browserAgent.click(
          'form button[type="submit"], button[type="submit"], input[type="submit"]'
        )
        results.push({
          case: 'empty required form submit',
          status: 'pass',
          notes: 'Triggered first available submit control.'
        })
      } catch (error) {
        results.push({
          case: 'empty required form submit',
          status: 'fail',
          notes: error instanceof Error ? error.message : String(error)
        })
      }
      await this.browserAgent.navigate(`${sandboxUrl.replace(/\/$/, '')}/__yald_missing__`)
      results.push({
        case: 'invalid route navigation',
        status: 'pass',
        notes: 'Invalid route loaded without crashing.'
      })
    } catch (error) {
      results.push({
        case: 'invalid route navigation',
        status: 'fail',
        notes: error instanceof Error ? error.message : String(error)
      })
    }
    return results
  }

  // ─── QA synthesis ───────────────────────────────────────────────────────────

  private async runQa(
    provider: ProviderContext,
    prompt: string,
    brief: BrainstormBrief,
    manifest: EngineerManifest,
    browserReport: BrowserReviewResult,
    run: PipelineRun
  ): Promise<QAResult> {
    const signal = run.abortController.signal

    this.emitLog(run, '[qa] Generating delivery summary...')
    let streamedSummary = ''
    try {
      streamedSummary = await streamChatText(
        provider,
        'You are the QA and Synthesis Agent. Write a concise plain-text delivery summary for the user: what was built, how to run it, any known limitations. No JSON, no markdown headers.',
        JSON.stringify({
          prompt,
          brief,
          browserReport: {
            overall_status: browserReport.overall_status,
            ux_flow_results: browserReport.ux_flow_results.map((r) => ({
              step: r.step,
              status: r.status
            }))
          }
        }),
        (chunk) => this.emitLog(run, chunk),
        signal
      )
    } catch {
      // Non-fatal
    }

    const schema: Record<string, unknown> = {
      type: 'object',
      required: [
        'status',
        'passing_features',
        'failing_features',
        'console_errors',
        'edge_case_results',
        'recommendation',
        'delivery_summary'
      ],
      properties: {
        status: { type: 'string', enum: ['pass', 'fail', 'partial'] },
        passing_features: { type: 'array', items: { type: 'string' } },
        failing_features: {
          type: 'array',
          items: {
            type: 'object',
            required: ['feature', 'root_cause'],
            properties: { feature: { type: 'string' }, root_cause: { type: 'string' } }
          }
        },
        console_errors: {
          type: 'array',
          items: {
            type: 'object',
            required: ['message', 'severity'],
            properties: {
              message: { type: 'string' },
              severity: { type: 'string', enum: ['low', 'medium', 'high'] }
            }
          }
        },
        edge_case_results: {
          type: 'array',
          items: {
            type: 'object',
            required: ['case', 'status', 'notes'],
            properties: {
              case: { type: 'string' },
              status: { type: 'string', enum: ['pass', 'fail'] },
              notes: { type: 'string' }
            }
          }
        },
        recommendation: { type: 'string', enum: ['ship', 'fix then ship', 'needs redesign'] },
        delivery_summary: { type: 'string' }
      }
    }

    const content = await requestChat(
      provider,
      'You are the QA and Synthesis Agent. Return strict JSON.',
      JSON.stringify({ prompt, brief, manifest, browserReport }, null, 2),
      schema,
      signal
    )
    const qa = normalizeQAResult(parseJsonPayload(content))

    if (streamedSummary.trim().length > qa.delivery_summary.length) {
      qa.delivery_summary = streamedSummary.trim()
    }

    return qa
  }
}
