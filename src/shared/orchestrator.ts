import type { SkillMeta } from './types'

export type SpecialistIntent = 'vibe_code' | 'debug' | 'research' | 'skill_forge' | 'general'
export type SpecialistAgentName =
  | 'orchestrator'
  | 'brainstorm'
  | 'skill_forge'
  | 'engineer'
  | 'sandbox'
  | 'browser'
  | 'qa'
export type SpecialistLogLevel = 'info' | 'warn' | 'error' | 'decision'
export type SpecialistSubtaskStatus = 'pending' | 'running' | 'complete' | 'failed'

export interface SpecialistSubtask {
  id: string
  agent: string
  description: string
  status: SpecialistSubtaskStatus
  depends_on: string[]
}

export interface SpecialistPlan {
  goal: string
  subtasks: SpecialistSubtask[]
}

export interface SpecialistBrief {
  problem?: string
  mvp_features?: string[]
  out_of_scope?: string[]
  stack?: {
    frontend?: string
    backend?: string
    db?: string
    rationale?: string
  }
  data_model?: Array<{
    entity: string
    fields: string[]
    relations: string[]
  }>
  ux_flow?: string[]
  file_architecture?: string[]
  risks?: string[]
  confidence?: number
}

export interface SpecialistArtifacts {
  file_tree: string[]
  entry_point: string
  start_command: string
  env_vars: Array<{ key: string; description: string; required: boolean }>
  sandbox_url: string
  sandbox_id: string
}

export interface SpecialistBrowserReport {
  initial_screenshot?: string
  ux_flow_results?: Array<{
    step: string
    status: 'pass' | 'fail'
    screenshot?: string
    notes?: string
  }>
  console_errors?: string[]
  console_warnings?: string[]
  edge_case_results?: Array<{
    case: string
    status: 'pass' | 'fail'
    notes?: string
  }>
  overall_status?: 'pass' | 'fail' | 'partial'
  review_complete?: boolean
}

export interface SpecialistQAReport {
  status?: 'pass' | 'fail' | 'partial'
  passing_features?: string[]
  failing_features?: Array<{
    feature: string
    root_cause?: string
  }>
  console_errors?: Array<{
    message: string
    severity: 'low' | 'medium' | 'high'
  }>
  edge_case_results?: Array<{
    case: string
    status: 'pass' | 'fail'
    notes?: string
  }>
  recommendation?: 'ship' | 'fix then ship' | 'needs redesign'
  delivery_summary?: string
}

export interface SpecialistLogEntry {
  agent: SpecialistAgentName
  timestamp: string
  level: SpecialistLogLevel
  action: string
  payload: Record<string, unknown>
  skill_used: string | null
  confidence: number
}

export interface SpecialistSharedContext {
  task_id: string
  user_prompt: string
  intent: SpecialistIntent
  confidence: number
  plan: SpecialistPlan
  brief: SpecialistBrief
  skill_inventory: Array<{
    id: string
    name: string
    description: string
  }>
  skill_gaps: string[]
  artifacts: SpecialistArtifacts
  browser_report: SpecialistBrowserReport
  qa_report: SpecialistQAReport
  log: SpecialistLogEntry[]
}

export interface SpecialistContextBuildInput {
  taskId: string
  userPrompt: string
  installedSkills: SkillMeta[]
  workingDirectory: string
  projectPath?: string
}

type SpecialistContextUpdate = Partial<
  Omit<SpecialistSharedContext, 'task_id' | 'user_prompt' | 'skill_inventory'>
> & {
  skill_inventory?: SpecialistSharedContext['skill_inventory']
  log?: SpecialistLogEntry[]
}

const ORCHESTRATOR_CONTEXT_BLOCK = 'orchestrator-context'

const SKILL_GAP_PATTERNS: Array<{ name: string; match: RegExp[] }> = [
  {
    name: 'brainstorming-and-architecture',
    match: [/\barchitecture\b/i, /\bworkflow\b/i, /\borchestr/i, /\bmvp\b/i]
  },
  {
    name: 'browser-qa-automation',
    match: [/\bbrowser\b/i, /\bplaywright\b/i, /\be2e\b/i, /\bqa\b/i]
  },
  {
    name: 'sandbox-runtime-validation',
    match: [/\bsandbox\b/i, /\bpreview\b/i, /\bdeploy\b/i, /\brun locally\b/i]
  },
  {
    name: 'skill-forging',
    match: [/\bskill\b/i, /\bSKILL\.md\b/i, /\bprompt skill\b/i]
  }
]

function normalizeSkillText(skill: Pick<SkillMeta, 'name' | 'description'>): string {
  return `${skill.name} ${skill.description}`.toLowerCase()
}

function detectIntent(prompt: string): SpecialistIntent {
  const normalized = prompt.trim().toLowerCase()
  if (!normalized) return 'general'
  if (/\bskill\b|\bskill\.md\b|\bprompt library\b|\bforge\b/.test(normalized)) {
    return 'skill_forge'
  }
  if (/\bbug\b|\bfix\b|\bbroken\b|\berror\b|\bdebug\b|\bnot working\b/.test(normalized)) {
    return 'debug'
  }
  if (/\bresearch\b|\bcompare\b|\bsummarize\b|\binvestigate\b|\bfind out\b/.test(normalized)) {
    return 'research'
  }
  if (/\bbuild\b|\bimplement\b|\bcreate\b|\bmake\b|\bdesign\b/.test(normalized)) {
    return 'vibe_code'
  }
  return 'general'
}

function scoreConfidence(prompt: string, intent: SpecialistIntent): number {
  const normalized = prompt.trim()
  if (!normalized) return 0.4

  let score = 0.76
  if (normalized.length > 40) score += 0.05
  if (normalized.length > 120) score += 0.04
  if (/[.:]/.test(normalized)) score += 0.03
  if (/\bmust\b|\bshould\b|\brequire\b/.test(normalized.toLowerCase())) score += 0.03
  if (intent !== 'general') score += 0.04
  return Math.max(0.45, Math.min(0.96, Number(score.toFixed(2))))
}

function buildTaskGraph(intent: SpecialistIntent, hasSkillGaps: boolean): SpecialistPlan {
  const graphByIntent: Record<SpecialistIntent, Array<Omit<SpecialistSubtask, 'status'>>> = {
    vibe_code: [
      {
        id: 'skill_inventory_check',
        agent: 'orchestrator',
        description: 'Inspect installed skills and project constraints.',
        depends_on: []
      },
      {
        id: 'brainstorm',
        agent: 'brainstorm',
        description: 'Produce a scoped brief, MVP, risks, and architecture.',
        depends_on: ['skill_inventory_check']
      },
      {
        id: 'skill_gap_check',
        agent: 'orchestrator',
        description: 'Decide whether missing skills block implementation.',
        depends_on: ['brainstorm']
      },
      {
        id: 'skill_forge',
        agent: 'skill_forge',
        description: 'Create missing reusable skill guidance before implementation.',
        depends_on: ['skill_gap_check']
      },
      {
        id: 'engineer',
        agent: 'engineer',
        description: 'Implement the approved plan and verify builds incrementally.',
        depends_on: [hasSkillGaps ? 'skill_forge' : 'skill_gap_check']
      },
      {
        id: 'sandbox',
        agent: 'sandbox',
        description: 'Run the app in an isolated environment and expose a preview.',
        depends_on: ['engineer']
      },
      {
        id: 'browser',
        agent: 'browser',
        description: 'Execute the UX flow and capture runtime issues.',
        depends_on: ['sandbox']
      },
      {
        id: 'qa_report',
        agent: 'qa',
        description: 'Cross-check the build against the brief and test results.',
        depends_on: ['browser']
      },
      {
        id: 'synthesis',
        agent: 'qa',
        description: 'Produce the final delivery summary for the user.',
        depends_on: ['qa_report']
      }
    ],
    debug: [
      {
        id: 'skill_inventory_check',
        agent: 'orchestrator',
        description: 'Inspect installed skills and existing debugging aids.',
        depends_on: []
      },
      {
        id: 'diagnosis',
        agent: 'engineer',
        description: 'Identify the likely root cause and narrow the failing surface.',
        depends_on: ['skill_inventory_check']
      },
      {
        id: 'skill_gap_check',
        agent: 'orchestrator',
        description: 'Determine whether a missing skill blocks the fix path.',
        depends_on: ['diagnosis']
      },
      {
        id: 'skill_forge',
        agent: 'skill_forge',
        description: 'Create a missing debugging skill if the gap is blocking.',
        depends_on: ['skill_gap_check']
      },
      {
        id: 'engineer',
        agent: 'engineer',
        description: 'Apply the fix and rerun verification.',
        depends_on: [hasSkillGaps ? 'skill_forge' : 'skill_gap_check']
      },
      {
        id: 'qa_report',
        agent: 'qa',
        description: 'Summarize the fix, residual risk, and validation status.',
        depends_on: ['engineer']
      }
    ],
    research: [
      {
        id: 'skill_inventory_check',
        agent: 'orchestrator',
        description: 'Inspect installed research and synthesis skills.',
        depends_on: []
      },
      {
        id: 'brainstorm',
        agent: 'brainstorm',
        description: 'Define the research question, scope, and deliverable shape.',
        depends_on: ['skill_inventory_check']
      },
      {
        id: 'synthesis',
        agent: 'qa',
        description: 'Produce the final synthesis with sources and limitations.',
        depends_on: ['brainstorm']
      }
    ],
    skill_forge: [
      {
        id: 'skill_inventory_check',
        agent: 'orchestrator',
        description: 'Inspect installed skills to avoid duplication.',
        depends_on: []
      },
      {
        id: 'skill_forge',
        agent: 'skill_forge',
        description: 'Design and draft the requested reusable SKILL.md.',
        depends_on: ['skill_inventory_check']
      },
      {
        id: 'qa_report',
        agent: 'qa',
        description: 'Review the skill for clarity, trigger quality, and edge cases.',
        depends_on: ['skill_forge']
      }
    ],
    general: [
      {
        id: 'triage',
        agent: 'orchestrator',
        description: 'Clarify the request or provide a direct answer if no build is needed.',
        depends_on: []
      }
    ]
  }

  const subtasks = graphByIntent[intent].map((task, index) => ({
    ...task,
    status: index === 0 ? ('running' as const) : ('pending' as const)
  }))

  return {
    goal: `Handle the request as a ${intent.replace('_', ' ')} task with explicit planning, skill checks, and auditable logs.`,
    subtasks
  }
}

function detectSkillGaps(prompt: string, installedSkills: SkillMeta[]): string[] {
  const normalizedSkills = installedSkills.map(normalizeSkillText)

  return SKILL_GAP_PATTERNS.filter((pattern) => {
    const triggered = pattern.match.some((matcher) => matcher.test(prompt))
    if (!triggered) return false
    return !normalizedSkills.some((text) => text.includes(pattern.name.replace(/-/g, ' ')))
  }).map((pattern) => pattern.name)
}

export function createSpecialistLogEntry(
  agent: SpecialistAgentName,
  level: SpecialistLogLevel,
  action: string,
  payload: Record<string, unknown>,
  confidence: number,
  skillUsed: string | null = null
): SpecialistLogEntry {
  return {
    agent,
    timestamp: new Date().toISOString(),
    level,
    action,
    payload,
    skill_used: skillUsed,
    confidence: Number(confidence.toFixed(2))
  }
}

export function buildSpecialistContext(
  input: SpecialistContextBuildInput
): SpecialistSharedContext {
  const intent = detectIntent(input.userPrompt)
  const confidence = scoreConfidence(input.userPrompt, intent)
  const skillGaps = detectSkillGaps(input.userPrompt, input.installedSkills)
  const plan = buildTaskGraph(intent, skillGaps.length > 0)

  return {
    task_id: input.taskId,
    user_prompt: input.userPrompt,
    intent,
    confidence,
    plan,
    brief: {},
    skill_inventory: input.installedSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description
    })),
    skill_gaps: skillGaps,
    artifacts: {
      file_tree: [],
      entry_point: '',
      start_command: 'pnpm dev',
      env_vars: [],
      sandbox_url: '',
      sandbox_id: input.projectPath || input.workingDirectory
    },
    browser_report: {},
    qa_report: {},
    log: [
      createSpecialistLogEntry(
        'orchestrator',
        'decision',
        'classified_intent',
        { intent, workingDirectory: input.workingDirectory, skillGaps },
        confidence
      ),
      createSpecialistLogEntry(
        'orchestrator',
        confidence >= 0.8 ? 'info' : 'warn',
        'constructed_initial_plan',
        { subtaskCount: plan.subtasks.length },
        confidence
      )
    ]
  }
}

export function buildOrchestratorSystemPrompt(context: SpecialistSharedContext): string {
  return [
    'You are the yald Orchestrator inside a specialist-agent workspace.',
    'Plan first, act second. Before any implementation or tool usage, classify the task, score confidence, and produce a dependency-ordered plan.',
    'Operate using the shared context provided below. Read it before acting, and do not assume missing state.',
    'Respect the skill-first policy. Use installed skills when relevant. If a capability is missing, record it in skill_gaps and route work through skill_forge before implementation.',
    'Be explicit about assumptions, risks, quality gates, and what remains blocked by missing runtime primitives.',
    'When the task cannot be fully executed because the app lacks sandbox or browser primitives, say so clearly and provide the next best implementation within the current codebase.',
    'Every answer must end with a fenced code block named orchestrator-context containing a single JSON object with only the fields that changed in the shared context. Use valid JSON.',
    'Do not mention the hidden context block in the user-facing prose.',
    'The user-facing answer should remain concise and useful.',
    `Shared context:\n${JSON.stringify(context, null, 2)}`
  ].join('\n\n')
}

export function stripOrchestratorContextBlock(text: string): string {
  return text
    .replace(
      new RegExp(`\\n?\\\`\\\`\\\`${ORCHESTRATOR_CONTEXT_BLOCK}[\\s\\S]*?\\\`\\\`\\\`\\s*$`, 'i'),
      ''
    )
    .trim()
}

export function extractOrchestratorContextUpdate(text: string): {
  cleanedText: string
  update: SpecialistContextUpdate | null
} {
  const match = text.match(
    new RegExp(`\\\`\\\`\\\`${ORCHESTRATOR_CONTEXT_BLOCK}\\s*([\\s\\S]*?)\\\`\\\`\\\``, 'i')
  )
  if (!match) {
    return {
      cleanedText: text,
      update: null
    }
  }

  try {
    const parsed = JSON.parse(match[1].trim()) as SpecialistContextUpdate
    return {
      cleanedText: stripOrchestratorContextBlock(text),
      update: parsed
    }
  } catch {
    return {
      cleanedText: stripOrchestratorContextBlock(text),
      update: null
    }
  }
}

export function mergeSpecialistContext(
  current: SpecialistSharedContext,
  update: SpecialistContextUpdate | null
): SpecialistSharedContext {
  if (!update) return current

  return {
    ...current,
    intent: update.intent || current.intent,
    confidence:
      typeof update.confidence === 'number'
        ? Number(update.confidence.toFixed(2))
        : current.confidence,
    plan: update.plan
      ? {
          goal: update.plan.goal || current.plan.goal,
          subtasks: Array.isArray(update.plan.subtasks)
            ? update.plan.subtasks
            : current.plan.subtasks
        }
      : current.plan,
    brief: update.brief ? { ...current.brief, ...update.brief } : current.brief,
    skill_inventory: Array.isArray(update.skill_inventory)
      ? update.skill_inventory
      : current.skill_inventory,
    skill_gaps: Array.isArray(update.skill_gaps) ? update.skill_gaps : current.skill_gaps,
    artifacts: update.artifacts ? { ...current.artifacts, ...update.artifacts } : current.artifacts,
    browser_report: update.browser_report
      ? { ...current.browser_report, ...update.browser_report }
      : current.browser_report,
    qa_report: update.qa_report ? { ...current.qa_report, ...update.qa_report } : current.qa_report,
    log: Array.isArray(update.log) ? [...current.log, ...update.log] : current.log
  }
}
