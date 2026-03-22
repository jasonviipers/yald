import { EventEmitter } from 'events'
import { log as _log } from '../logger'
import { resolveBackendUrl } from '../../shared/backend-url'
import type {
  PromptHistoryMessage,
  ProviderContext,
  VoiceEvent,
  VoiceLatencyMetrics,
  VoiceTurnRequest
} from '../../shared/types'
import { transcribeAudioBase64 } from './transcription'
import { runVoiceTurnViaRealtimeBackend } from './realtime-backend-client'
import { synthesizeSpeechChunk } from './tts'

interface ActiveTurn {
  tabId: string
  turnId: string
  provider: ProviderContext
  abortController: AbortController
  startedAt: number
  ttsQueue: Promise<void>
  cancelled: boolean
}

function log(msg: string): void {
  _log('VoiceSessionManager', msg)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeHistory(history: PromptHistoryMessage[] | undefined): PromptHistoryMessage[] {
  return Array.isArray(history) ? history : []
}

function buildMessages(
  history: PromptHistoryMessage[],
  transcript: string
): Array<{ role: string; content: string }> {
  return [...history, { role: 'user', content: transcript }]
}

function emitEvent(emitter: EventEmitter, event: VoiceEvent): void {
  emitter.emit('event', event)
}

function extractSpeakableSegments(
  buffer: string,
  flushAll: boolean
): { segments: string[]; remaining: string } {
  const segments: string[] = []
  let remaining = buffer

  while (remaining.length > 0) {
    const match = remaining.match(/^[\s\S]*?[.!?](?:\s|$)/)
    if (!match) break
    const segment = match[0].trim()
    if (segment) segments.push(segment)
    remaining = remaining.slice(match[0].length)
  }

  if (flushAll) {
    const tail = remaining.trim()
    if (tail) segments.push(tail)
    remaining = ''
  }

  if (!flushAll && remaining.trim().length > 220) {
    const cutoff = remaining.lastIndexOf(' ')
    const segment = remaining.slice(0, cutoff > 40 ? cutoff : remaining.length).trim()
    if (segment) {
      segments.push(segment)
      remaining = remaining.slice(segment.length)
    }
  }

  return { segments, remaining }
}

async function streamOllamaCloudResponse(
  provider: ProviderContext,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
  onText: (chunk: string) => void
): Promise<void> {
  const baseUrl = trimSlash(resolveBackendUrl(provider.baseUrl))
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true
    }),
    signal
  })

  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => response.statusText)
    throw new Error(
      `ollama voice request failed (${response.status}): ${message || response.statusText}`
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        const payload = JSON.parse(line)
        const text = payload?.message?.content
        if (typeof text === 'string' && text) onText(text)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const payload = JSON.parse(trailing)
    const text = payload?.message?.content
    if (typeof text === 'string' && text) onText(text)
  }
}

export class VoiceSessionManager extends EventEmitter {
  private activeTurns = new Map<string, ActiveTurn>()

  async startTurn(request: VoiceTurnRequest): Promise<{ turnId: string }> {
    this.cancelTab(request.tabId)
    const turnId = crypto.randomUUID()
    const active: ActiveTurn = {
      tabId: request.tabId,
      turnId,
      provider: request.provider,
      abortController: new AbortController(),
      startedAt: Date.now(),
      ttsQueue: Promise.resolve(),
      cancelled: false
    }

    this.activeTurns.set(request.tabId, active)
    void this.runTurn(active, request)
    return { turnId }
  }

  cancelTab(tabId: string): boolean {
    const active = this.activeTurns.get(tabId)
    if (!active) return false
    active.cancelled = true
    active.abortController.abort()
    this.activeTurns.delete(tabId)
    emitEvent(this, { type: 'state', tabId, state: 'idle', message: 'Voice turn interrupted' })
    return true
  }

  private async runTurn(active: ActiveTurn, request: VoiceTurnRequest): Promise<void> {
    const { tabId } = active
    const metrics: VoiceLatencyMetrics = {}
    let assistantFullText = ''
    let pendingSpeech = ''
    let firstTokenAt = 0
    let firstAudioAt = 0

    try {
      try {
        const delegated = await runVoiceTurnViaRealtimeBackend(
          request,
          active.abortController.signal,
          (event) => emitEvent(this, event),
          log
        )
        if (delegated) return
      } catch (err: any) {
        log(
          `Realtime backend delegation failed: ${err.message}; falling back to in-app voice pipeline`
        )
      }

      emitEvent(this, { type: 'state', tabId, state: 'transcribing' })
      const sttStartedAt = Date.now()
      const stt = await transcribeAudioBase64({ audioBase64: request.audioBase64 }, (msg) =>
        log(msg)
      )

      metrics.sttMs = Date.now() - sttStartedAt

      if (stt.error) {
        throw new Error(stt.error)
      }

      const transcript = stt.transcript?.trim() || ''
      if (!transcript) {
        emitEvent(this, { type: 'state', tabId, state: 'listening', message: 'No speech detected' })
        emitEvent(this, {
          type: 'metrics',
          tabId,
          metrics: { ...metrics, totalMs: Date.now() - active.startedAt }
        })
        return
      }

      emitEvent(this, { type: 'transcript', tabId, text: transcript, isFinal: true })
      emitEvent(this, { type: 'state', tabId, state: 'thinking' })

      const llmStartedAt = Date.now()
      await streamOllamaCloudResponse(
        active.provider,
        buildMessages(normalizeHistory(request.history), transcript),
        active.abortController.signal,
        (chunk) => {
          if (!firstTokenAt) {
            firstTokenAt = Date.now()
            metrics.firstTokenMs = firstTokenAt - llmStartedAt
          }

          assistantFullText += chunk
          pendingSpeech += chunk
          emitEvent(this, { type: 'assistant_text', tabId, text: chunk, isFinal: false })

          const extracted = extractSpeakableSegments(pendingSpeech, false)
          pendingSpeech = extracted.remaining
          for (const segment of extracted.segments) {
            active.ttsQueue = active.ttsQueue.then(async () => {
              const spoken = await synthesizeSpeechChunk(segment, request.voice, log)
              if (!spoken || active.cancelled) return
              if (!firstAudioAt) {
                firstAudioAt = Date.now()
                metrics.firstAudioMs = firstAudioAt - active.startedAt
              }
              emitEvent(this, {
                type: 'audio_chunk',
                tabId,
                chunkId: crypto.randomUUID(),
                audioBase64: spoken.audio.toString('base64'),
                mimeType: spoken.mimeType,
                text: segment,
                isFinal: false
              })
              emitEvent(this, { type: 'state', tabId, state: 'speaking' })
            })
          }
        }
      )

      const finalSegments = extractSpeakableSegments(pendingSpeech, true).segments
      for (const segment of finalSegments) {
        active.ttsQueue = active.ttsQueue.then(async () => {
          const spoken = await synthesizeSpeechChunk(segment, request.voice, log)
          if (!spoken || active.cancelled) return
          if (!firstAudioAt) {
            firstAudioAt = Date.now()
            metrics.firstAudioMs = Date.now() - active.startedAt
          }
          emitEvent(this, {
            type: 'audio_chunk',
            tabId,
            chunkId: crypto.randomUUID(),
            audioBase64: spoken.audio.toString('base64'),
            mimeType: spoken.mimeType,
            text: segment,
            isFinal: false
          })
          emitEvent(this, { type: 'state', tabId, state: 'speaking' })
        })
      }

      await active.ttsQueue
      emitEvent(this, {
        type: 'assistant_text',
        tabId,
        text: '',
        isFinal: true,
        fullText: assistantFullText
      })

      metrics.totalMs = Date.now() - active.startedAt
      emitEvent(this, { type: 'metrics', tabId, metrics })
      emitEvent(this, { type: 'state', tabId, state: 'listening' })
    } catch (err: any) {
      if (active.abortController.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      log(`Voice turn failed: ${message}`)
      emitEvent(this, { type: 'error', tabId, message, recoverable: true })
      emitEvent(this, { type: 'state', tabId, state: 'error', message })
    } finally {
      const current = this.activeTurns.get(tabId)
      if (current?.turnId === active.turnId) {
        this.activeTurns.delete(tabId)
      }
    }
  }
}
