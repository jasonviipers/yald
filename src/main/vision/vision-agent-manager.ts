import { EventEmitter } from 'events'
import { log as _log } from '../logger'
import { resolveBackendUrl } from '../../shared/backend-url'
import type {
  ProviderContext,
  VisionActionName,
  VisionEvent,
  VisionFeedback,
  VisionStartRequest
} from '../../shared/types'

const DEFAULT_INTERVAL_MS = 2200
const MIN_INTERVAL_MS = 1200
const ACTION_COOLDOWN_MS = 6000

interface VisionAnalyzeResponse {
  summary: string
  guidance: string
  confidence: 'low' | 'medium' | 'high'
  suggestedAction: VisionActionName
  actionReason?: string
  model: string
}

interface ActiveVisionSession {
  request: VisionStartRequest
  iteration: number
  previousSummary?: string
  lastFeedbackKey?: string
  lastAction?: VisionActionName
  lastActionAt?: number
  timer: NodeJS.Timeout | null
  inflightAbortController: AbortController | null
  stopped: boolean
}

interface VisionActionHandlers {
  createTab(): void
  toggleSettings(): void
  toggleVoice(): void
  hideWindow(): void
  moveLeft(): void
  moveRight(): void
  moveUp(): void
  moveDown(): void
}

function log(message: string): void {
  _log('VisionAgentManager', message)
}

function clampInterval(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_INTERVAL_MS
  return Math.max(MIN_INTERVAL_MS, Math.trunc(value))
}

function buildFeedbackKey(response: VisionAnalyzeResponse): string {
  return JSON.stringify([
    response.summary,
    response.guidance,
    response.confidence,
    response.suggestedAction,
    response.actionReason || ''
  ])
}

export class VisionAgentManager extends EventEmitter {
  private activeSession: ActiveVisionSession | null = null

  constructor(
    private readonly captureScreenshotBase64: () => Promise<string>,
    private readonly actions: VisionActionHandlers
  ) {
    super()
  }

  async startSession(request: VisionStartRequest): Promise<void> {
    await this.stopSession()

    const session: ActiveVisionSession = {
      request: {
        ...request,
        intervalMs: clampInterval(request.intervalMs),
        autoAct: request.autoAct ?? true
      },
      iteration: 0,
      timer: null,
      inflightAbortController: null,
      stopped: false
    }

    this.activeSession = session
    this.emitEvent({
      type: 'state',
      tabId: request.tabId,
      state: 'starting',
      message: 'Starting vision agent'
    })

    void this.runCycle(session)
  }

  async stopSession(): Promise<void> {
    const session = this.activeSession
    this.activeSession = null
    if (!session) return

    session.stopped = true
    if (session.timer) {
      clearTimeout(session.timer)
      session.timer = null
    }
    session.inflightAbortController?.abort()
    this.emitEvent({
      type: 'state',
      tabId: session.request.tabId,
      state: 'idle',
      message: 'Vision agent stopped'
    })
  }

  isActive(): boolean {
    return this.activeSession !== null
  }

  private emitEvent(event: VisionEvent): void {
    this.emit('event', event)
  }

  private scheduleNext(session: ActiveVisionSession): void {
    if (session.stopped || this.activeSession !== session) return
    session.timer = setTimeout(() => {
      void this.runCycle(session)
    }, session.request.intervalMs)
  }

  private async runCycle(session: ActiveVisionSession): Promise<void> {
    if (session.stopped || this.activeSession !== session) return

    const { request } = session
    const { tabId } = request
    const abortController = new AbortController()
    session.inflightAbortController = abortController
    session.iteration += 1

    try {
      if (session.iteration === 1) {
        this.emitEvent({
          type: 'state',
          tabId,
          state: 'observing',
          message: 'Vision agent is observing the app'
        })
      }

      const screenshotBase64 = await this.captureScreenshotBase64()
      const feedback = await this.analyzeScreenshot(
        request.provider,
        {
          tabId,
          screenshotBase64,
          prompt: request.prompt,
          previousSummary: session.previousSummary
        },
        abortController.signal
      )

      session.previousSummary = feedback.summary
      const feedbackKey = buildFeedbackKey(feedback)
      let appliedAction: VisionActionName | undefined

      if (request.autoAct) {
        appliedAction = this.applySuggestedAction(session, feedback.suggestedAction)
      }

      if (feedbackKey !== session.lastFeedbackKey || appliedAction) {
        session.lastFeedbackKey = feedbackKey
        const visionFeedback: VisionFeedback = {
          ...feedback,
          appliedAction,
          observedAt: Date.now(),
          iteration: session.iteration
        }
        this.emitEvent({
          type: 'feedback',
          tabId,
          feedback: visionFeedback
        })
      }
    } catch (error) {
      if (abortController.signal.aborted || session.stopped || this.activeSession !== session) {
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      log(`Vision cycle failed: ${message}`)
      this.emitEvent({
        type: 'error',
        tabId,
        message,
        recoverable: true
      })
      this.emitEvent({
        type: 'state',
        tabId,
        state: 'error',
        message
      })
    } finally {
      if (session.inflightAbortController === abortController) {
        session.inflightAbortController = null
      }
      this.scheduleNext(session)
    }
  }

  private applySuggestedAction(
    session: ActiveVisionSession,
    action: VisionActionName
  ): VisionActionName | undefined {
    if (!action || action === 'none') return undefined

    const now = Date.now()
    if (
      session.lastAction === action &&
      session.lastActionAt &&
      now - session.lastActionAt < ACTION_COOLDOWN_MS
    ) {
      return undefined
    }

    switch (action) {
      case 'create_tab':
        this.actions.createTab()
        break
      case 'toggle_settings':
        this.actions.toggleSettings()
        break
      case 'toggle_voice':
        this.actions.toggleVoice()
        break
      case 'hide_window':
        this.actions.hideWindow()
        break
      case 'move_left':
        this.actions.moveLeft()
        break
      case 'move_right':
        this.actions.moveRight()
        break
      case 'move_up':
        this.actions.moveUp()
        break
      case 'move_down':
        this.actions.moveDown()
        break
      default:
        return undefined
    }

    session.lastAction = action
    session.lastActionAt = now
    return action
  }

  private async analyzeScreenshot(
    provider: ProviderContext,
    body: {
      tabId: string
      screenshotBase64: string
      prompt?: string
      previousSummary?: string
    },
    signal: AbortSignal
  ): Promise<VisionAnalyzeResponse> {
    const backendUrl = resolveBackendUrl(provider.baseUrl, process.env.YALD_VOICE_BACKEND_URL)
    const response = await fetch(`${backendUrl}/api/vision/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        ...body,
        provider
      }),
      signal
    })

    const payload = (await response.json()) as Partial<VisionAnalyzeResponse> & {
      error?: { message?: string }
    }

    if (!response.ok) {
      throw new Error(payload.error?.message || `Vision request failed (${response.status})`)
    }

    const summary = payload.summary?.trim()
    const guidance = payload.guidance?.trim()
    const model = payload.model?.trim()
    if (!summary || !guidance || !model) {
      throw new Error('Vision response was incomplete')
    }

    return {
      summary,
      guidance,
      confidence:
        payload.confidence === 'low' || payload.confidence === 'high'
          ? payload.confidence
          : 'medium',
      suggestedAction: payload.suggestedAction || 'none',
      actionReason: payload.actionReason?.trim() || undefined,
      model
    }
  }
}
