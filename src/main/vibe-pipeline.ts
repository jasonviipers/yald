import { EventEmitter } from 'events'
import { mkdir, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { log as _log } from './logger'
import { SandboxManager } from './sandbox'
import { BrowserAgentManager } from './browser-agent'
import { installSkill, listInstalledSkills } from './skills/store'
import { DEFAULT_BACKEND_URL, resolveBackendUrl } from '../shared/backend-url'
import type { PipelineStage, ProviderContext, VibePipelineState } from '../shared/types'

type StageId = PipelineStage['id']

interface PipelineRun {
  tabId: string
  prompt: string
  sandboxId: string
  abortController: AbortController
  state: VibePipelineState
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
  stack: {
    frontend: string
    backend: string
    db: string
    rationale: string
  }
  data_model: Array<{
    entity: string
    fields: string[]
    relations: string[]
  }>
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
  edge_case_results: Array<{
    case: string
    status: 'pass' | 'fail'
    notes: string
  }>
  overall_status: 'pass' | 'fail' | 'partial'
  review_complete: true
}

interface QAResult {
  status: 'pass' | 'fail' | 'partial'
  passing_features: string[]
  failing_features: Array<{
    feature: string
    root_cause: string
  }>
  console_errors: Array<{
    message: string
    severity: 'low' | 'medium' | 'high'
  }>
  edge_case_results: Array<{
    case: string
    status: 'pass' | 'fail'
    notes: string
  }>
  recommendation: 'ship' | 'fix then ship' | 'needs redesign'
  delivery_summary: string
}

interface SelectorPlan {
  selector: string
  action: 'click' | 'type' | 'noop'
  text?: string
}

interface ChatPayload {
  message?: {
    content?: string
  }
  error?: {
    message?: string
  }
}

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

function log(message: string): void {
  _log('vibe-pipeline', message)
}

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

function promptKeywords(prompt: string): string[] {
  return Array.from(
    new Set(
      prompt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4)
    )
  )
}

function skillGapsFromPrompt(prompt: string, skills: SkillInventoryEntry[]): string[] {
  const keywords = promptKeywords(prompt)
  const inventoryText = skills.map((skill) => `${skill.name} ${skill.description}`.toLowerCase())
  return keywords.filter((keyword) => !inventoryText.some((entry) => entry.includes(keyword)))
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

function defaultProvider(): ProviderContext {
  return {
    providerId: 'ollama',
    model: 'gpt-oss:120b',
    baseUrl: resolveBackendUrl(undefined, DEFAULT_BACKEND_URL),
    transport: 'api'
  }
}

function extractMessageContent(payload: ChatPayload): string {
  const content = payload.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    const errorMessage = payload.error?.message || 'Model response was empty'
    throw new Error(errorMessage)
  }
  return content
}

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
  return extractMessageContent(payload)
}

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
      state: createInitialState(sandboxId)
    }
    this.activeRuns.set(tabId, run)

    try {
      const provider = defaultProvider()
      this.emitStage(run, 'skill_inventory_check')

      const installedSkills = (await listInstalledSkills()).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description
      }))
      const initialSkillGaps = skillGapsFromPrompt(prompt, installedSkills)
      this.emitLog(
        run,
        `Loaded ${installedSkills.length} installed skills. Identified ${initialSkillGaps.length} initial gaps.`
      )
      this.completeStage(run, 'skill_inventory_check')

      this.emitStage(run, 'brainstorm')
      const brief = await this.runBrainstorm(provider, prompt, run.abortController.signal)
      this.emitLog(run, `Brainstorm complete with confidence ${brief.confidence}.`)
      this.completeStage(run, 'brainstorm')

      let skillInventory = installedSkills
      const unresolvedGaps = this.resolveSkillGaps(initialSkillGaps, brief)
      if (unresolvedGaps.length > 0) {
        this.emitStage(run, 'skill_forge')
        for (const gap of unresolvedGaps) {
          const forged = await this.runSkillForge(provider, gap, run.abortController.signal)
          const skillPath = await this.writeSkillToHome(forged)
          const installed = await installSkill(skillPath)
          skillInventory = [
            ...skillInventory,
            {
              id: installed.id,
              name: installed.name,
              description: installed.description
            }
          ]
          this.emitLog(run, `Forged and installed skill ${installed.name} for gap ${gap}.`)
        }
        this.completeStage(run, 'skill_forge')
      }

      this.emitStage(run, 'engineer')
      const manifest = await this.runEngineer(
        provider,
        prompt,
        brief,
        skillInventory,
        run.abortController.signal
      )
      await this.applyEngineerManifest(run, manifest, provider)
      this.completeStage(run, 'engineer')

      this.emitStage(run, 'sandbox')
      if (manifest.installCommand.trim()) {
        const installResult = await this.sandboxManager.exec(sandboxId, manifest.installCommand)
        this.emitLog(run, `Install command completed with exit code ${installResult.exitCode}.`)
        if (installResult.exitCode !== 0) {
          throw new Error(installResult.stderr || 'Sandbox install command failed')
        }
      }
      await this.sandboxManager.exec(
        sandboxId,
        manifest.startCommand,
        { timeoutMs: 0 },
        {
          onStdoutLine: (line) => this.emitLog(run, `[sandbox] ${line}`),
          onStderrLine: (line) => this.emitLog(run, `[sandbox] ${line}`)
        }
      )
      const sandboxPort = await this.sandboxManager.exposePort(sandboxId)
      run.state.sandboxUrl = sandboxPort.url
      this.emit('sandbox-ready', tabId, sandboxPort.url)
      this.emitLog(run, `Sandbox is reachable at ${sandboxPort.url}.`)
      this.completeStage(run, 'sandbox')

      this.emitStage(run, 'browser')
      const browserReport = await this.runBrowserReview(
        provider,
        sandboxPort.url,
        brief.ux_flow,
        run.abortController.signal,
        run
      )
      this.emitLog(run, `Browser review finished with ${browserReport.overall_status}.`)
      this.completeStage(run, 'browser')

      this.emitStage(run, 'qa')
      const qa = await this.runQa(
        provider,
        prompt,
        brief,
        manifest,
        browserReport,
        run.abortController.signal
      )
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

  private emitStage(run: PipelineRun, stageId: StageId): void {
    run.state.activeStage = stageId
    run.state.stages = run.state.stages.map((stage) =>
      stage.id === stageId ? { ...stage, status: 'running', startedAt: Date.now() } : stage
    )
    this.emit('pipeline-stage', run.tabId, stageId)
    log(`tab=${run.tabId} stage=${stageId}`)
  }

  private completeStage(run: PipelineRun, stageId: StageId): void {
    run.state.stages = run.state.stages.map((stage) =>
      stage.id === stageId ? { ...stage, status: 'complete', completedAt: Date.now() } : stage
    )
  }

  private failActiveStage(run: PipelineRun): void {
    const activeStage = run.state.activeStage
    if (!activeStage) return
    run.state.stages = run.state.stages.map((stage) =>
      stage.id === activeStage ? { ...stage, status: 'failed', completedAt: Date.now() } : stage
    )
  }

  private emitLog(run: PipelineRun, line: string): void {
    run.state.log.push(line)
    if (run.state.log.length > 400) {
      run.state.log.shift()
    }
    this.emit('pipeline-log', run.tabId, line)
  }

  private resolveSkillGaps(initialGaps: string[], brief: BrainstormBrief): string[] {
    const stackTokens = [
      brief.stack.frontend,
      brief.stack.backend,
      brief.stack.db,
      ...brief.mvp_features
    ]
      .join(' ')
      .toLowerCase()

    return initialGaps.filter(
      (gap) => stackTokens.includes(gap.toLowerCase()) || gap.includes('skill')
    )
  }

  private async runBrainstorm(
    provider: ProviderContext,
    prompt: string,
    signal: AbortSignal
  ): Promise<BrainstormBrief> {
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
      'Return strict JSON matching the schema.',
      'Produce a concise MVP brief for a vibe-coded app build.'
    ].join(' ')

    const content = await requestChat(provider, systemPrompt, prompt, schema, signal)
    try {
      return JSON.parse(content) as BrainstormBrief
    } catch {
      const retry = await requestChat(
        provider,
        `${systemPrompt} The previous response was invalid. Return only valid JSON.`,
        prompt,
        schema,
        signal
      )
      return JSON.parse(retry) as BrainstormBrief
    }
  }

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

    const systemPrompt = [
      'You are the SkillForge Agent.',
      'Return SKILL.md content for the missing capability.',
      'The markdown must include frontmatter with name and description.'
    ].join(' ')

    const content = await requestChat(
      provider,
      systemPrompt,
      `Forge a skill for this gap: ${gap}`,
      schema,
      signal
    )
    return JSON.parse(content) as SkillForgeResult
  }

  private async writeSkillToHome(skill: SkillForgeResult): Promise<string> {
    const skillDir = join(homedir(), '.claude', 'skills', slugify(skill.name))
    await mkdir(skillDir, { recursive: true })
    const targetPath = join(skillDir, 'SKILL.md')
    await writeFile(targetPath, skill.content, 'utf8')
    return targetPath
  }

  private async runEngineer(
    provider: ProviderContext,
    prompt: string,
    brief: BrainstormBrief,
    skills: SkillInventoryEntry[],
    signal: AbortSignal
  ): Promise<EngineerManifest> {
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
              layer: {
                type: 'string',
                enum: ENGINEER_LAYER_ORDER
              }
            }
          }
        }
      }
    }

    const systemPrompt = [
      'You are the Engineer Agent.',
      'Return strict JSON matching the schema.',
      'Generate a minimal but working app manifest and full file contents.',
      'Prefer Bun, Vite, React, or plain Node only when the brief requires them.'
    ].join(' ')

    const content = await requestChat(
      provider,
      systemPrompt,
      JSON.stringify({ prompt, brief, skills }, null, 2),
      schema,
      signal
    )
    return JSON.parse(content) as EngineerManifest
  }

  private async applyEngineerManifest(
    run: PipelineRun,
    manifest: EngineerManifest,
    provider: ProviderContext
  ): Promise<void> {
    const groupedByLayer = new Map<EngineerFile['layer'], EngineerFile[]>()
    for (const file of manifest.files) {
      const bucket = groupedByLayer.get(file.layer) || []
      bucket.push(file)
      groupedByLayer.set(file.layer, bucket)
    }

    for (const layer of ENGINEER_LAYER_ORDER) {
      const files = groupedByLayer.get(layer) || []
      if (files.length === 0) continue

      for (const file of files) {
        await this.sandboxManager.writeFile(run.sandboxId, file.path, file.content)
        this.emitLog(run, `Wrote ${file.path} (${layer}).`)
      }

      if (!manifest.buildCommand.trim()) continue

      let attempt = 0
      while (attempt < 3) {
        attempt += 1
        const build = await this.sandboxManager.exec(run.sandboxId, manifest.buildCommand)
        this.emitLog(run, `Build check after ${layer} exited with ${build.exitCode}.`)
        if (build.exitCode === 0) {
          break
        }

        if (attempt >= 3) {
          throw new Error(build.stderr || `Build failed after ${layer}`)
        }

        const fixes = await this.requestEngineerFix(
          provider,
          manifest,
          build.stderr || build.stdout
        )
        for (const file of fixes.files) {
          await this.sandboxManager.writeFile(run.sandboxId, file.path, file.content)
          this.emitLog(run, `Applied fix for ${file.path}.`)
        }
      }
    }
  }

  private async requestEngineerFix(
    provider: ProviderContext,
    manifest: EngineerManifest,
    buildError: string
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
              layer: {
                type: 'string',
                enum: ENGINEER_LAYER_ORDER
              }
            }
          }
        }
      }
    }

    const content = await requestChat(
      provider,
      'You are the Engineer Agent fixing a build error. Return only the changed files as strict JSON.',
      JSON.stringify({ buildError, manifest }, null, 2),
      schema
    )
    return JSON.parse(content) as Pick<EngineerManifest, 'files'>
  }

  private async runBrowserReview(
    provider: ProviderContext,
    sandboxUrl: string,
    uxFlow: string[],
    signal: AbortSignal,
    run: PipelineRun
  ): Promise<BrowserReviewResult> {
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
          notes: consoleEntries.map((entry) => `${entry.level}: ${entry.message}`).join('\n')
        })
      } catch (error) {
        const screenshot = await this.browserAgent.screenshot()
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          step,
          status: 'fail',
          screenshot,
          notes: message
        })
        this.emitLog(run, `Browser step failed: ${step} -> ${message}`)
      }
    }

    const consoleEntries = await this.browserAgent.consoleLogs()
    const consoleErrors = consoleEntries
      .filter((entry) => entry.level.toLowerCase().includes('error'))
      .map((entry) => entry.message)
    const consoleWarnings = consoleEntries
      .filter((entry) => entry.level.toLowerCase().includes('warn'))
      .map((entry) => entry.message)

    const edgeCaseResults = await this.runBrowserEdgeCases(sandboxUrl)
    await this.browserAgent.close()

    const passed = results.filter((result) => result.status === 'pass').length
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

    const content = await requestChat(
      provider,
      'You convert UX steps into CSS selector interaction plans. Return strict JSON.',
      JSON.stringify({ step, dom }, null, 2),
      schema,
      signal
    )
    return JSON.parse(content) as SelectorPlan
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
          notes: 'Triggered the first available submit control.'
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
        notes: 'Invalid route loaded without crashing the hidden browser.'
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

  private async runQa(
    provider: ProviderContext,
    prompt: string,
    brief: BrainstormBrief,
    manifest: EngineerManifest,
    browserReport: BrowserReviewResult,
    signal: AbortSignal
  ): Promise<QAResult> {
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
            properties: {
              feature: { type: 'string' },
              root_cause: { type: 'string' }
            }
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
        recommendation: {
          type: 'string',
          enum: ['ship', 'fix then ship', 'needs redesign']
        },
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
    return JSON.parse(content) as QAResult
  }
}
