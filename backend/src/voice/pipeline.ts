import type { VoiceEvent, VoiceTurnRequest } from '../types'
import { buildMessages, streamOllamaResponse } from './llm'
import { transcribeWithElevenLabs } from './stt'

export async function processVoiceTurn(
  request: VoiceTurnRequest,
  emit: (event: VoiceEvent) => void
): Promise<void> {
  const startedAt = Date.now()
  const metrics: { sttMs?: number; firstTokenMs?: number; totalMs?: number } = {}
  const { tabId } = request

  emit({ type: 'state', tabId, state: 'transcribing' })

  const sttStartedAt = Date.now()
  const transcript = (
    await transcribeWithElevenLabs(Buffer.from(request.audioBase64, 'base64'))
  ).trim()
  metrics.sttMs = Date.now() - sttStartedAt

  if (!transcript) {
    metrics.totalMs = Date.now() - startedAt
    emit({ type: 'state', tabId, state: 'listening', message: 'No speech detected' })
    emit({ type: 'metrics', tabId, metrics })
    return
  }

  emit({ type: 'transcript', tabId, text: transcript, isFinal: true })
  emit({ type: 'state', tabId, state: 'thinking' })

  let firstTokenAt = 0
  let fullText = ''
  const llmStartedAt = Date.now()

  await streamOllamaResponse(
    request.provider,
    buildMessages(request.history, transcript),
    (chunk) => {
      if (!firstTokenAt) {
        firstTokenAt = Date.now()
        metrics.firstTokenMs = firstTokenAt - llmStartedAt
      }
      fullText += chunk
      emit({ type: 'assistant_text', tabId, text: chunk, isFinal: false })
    }
  )

  emit({ type: 'assistant_text', tabId, text: '', isFinal: true, fullText })
  metrics.totalMs = Date.now() - startedAt
  emit({ type: 'metrics', tabId, metrics })
  emit({ type: 'state', tabId, state: 'listening' })
}
