import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { upgradeWebSocket } from 'hono/bun'
import { cors } from 'hono/cors'
import { config } from './config'
import type { LiveKitTokenRequest, VisionAnalyzeRequest, VoiceTurnRequest } from './types'
import { analyzeVisionScreenshot } from './vision/analyze'
import { getInboundBearerToken, requestOllamaChat } from './voice/llm'
import { processVoiceTurn } from './voice/pipeline'
import { transcribeWithElevenLabs } from './voice/stt'

type UpgradeWebSocket = typeof upgradeWebSocket

function healthPayload(): Record<string, string | boolean> {
  return {
    ok: true,
    backend: 'yald-ollama-backend',
    ollamaHost: config.ollama.host,
    transcriptionMode: 'elevenlabs-stt'
  }
}

async function handleTranscriptions(c: Context): Promise<Response> {
  const formData = await c.req.raw.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: { message: 'Missing audio file' } }, 400)
  }

  try {
    const transcript = await transcribeWithElevenLabs(
      Buffer.from(new Uint8Array(await file.arrayBuffer()))
    )
    return c.json({ text: transcript })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[transcriptions] failed', error)
    return c.json({ error: { message } }, 500)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function realtimeVoiceHandler(upgrade: UpgradeWebSocket): MiddlewareHandler<any> {
  // upgradeWebSocket returns a MiddlewareHandler at runtime; the generic
  // ReturnType resolves to the response promise shape which is not assignable
  // to the handler slot on app.get(), so we cast here once at the boundary.
  return upgrade(() => {
    return {
      onOpen(_event, ws) {
        ws.send(JSON.stringify({ type: 'ready' }))
      },
      async onMessage(event, ws) {
        let request: VoiceTurnRequest | null = null
        try {
          const raw =
            typeof event.data === 'string'
              ? event.data
              : Buffer.from(
                  event.data instanceof ArrayBuffer
                    ? new Uint8Array(event.data)
                    : event.data instanceof Uint8Array
                      ? event.data
                      : new Uint8Array()
                ).toString('utf-8')
          // WebSocket payloads are untyped external JSON.
          const payload = JSON.parse(raw) as { type?: string; request?: VoiceTurnRequest }
          request = payload.request || null

          if (payload.type !== 'start' || !request?.tabId || !request.audioBase64) {
            throw new Error('Invalid realtime voice payload')
          }

          await processVoiceTurn(request, (voiceEvent) => {
            ws.send(JSON.stringify(voiceEvent))
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const tabId = request?.tabId || 'unknown'
          console.error('[realtime/voice] failed', error)
          ws.send(JSON.stringify({ type: 'error', tabId, message, recoverable: true }))
          ws.send(JSON.stringify({ type: 'state', tabId, state: 'error', message }))
        } finally {
          ws.close()
        }
      }
    }
    // upgradeWebSocket's declared return type is a response promise, but Bun's
    // runtime implementation returns a middleware handler. Cast to align types.
  }) as unknown as MiddlewareHandler<any>
}

export function createApp(upgrade: UpgradeWebSocket): Hono {
  const app = new Hono()
  app.use('*', cors())

  app.get('/health', (c) => c.json(healthPayload()))
  app.get('/v1/health', (c) => c.json(healthPayload()))

  app.post('/api/chat', async (c) => {
    try {
      const inboundApiKey = getInboundBearerToken(c.req.header('authorization'))
      // Request JSON comes from an external client and can be any valid Ollama payload shape.
      const body = (await c.req.json()) as Record<string, unknown>
      const payload = await requestOllamaChat(body, inboundApiKey)
      return c.json(payload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[api/chat] failed', error)
      return c.json({ error: { message } }, 500)
    }
  })

  app.post('/api/vision/analyze', async (c) => {
    try {
      const body = (await c.req.json()) as VisionAnalyzeRequest
      if (!body?.tabId || !body?.screenshotBase64 || !body?.provider?.model) {
        return c.json({ error: { message: 'Invalid vision request payload' } }, 400)
      }

      return c.json(await analyzeVisionScreenshot(body))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[api/vision/analyze] failed', error)
      return c.json({ error: { message } }, 500)
    }
  })

  app.post('/audio/transcriptions', handleTranscriptions)
  app.post('/v1/audio/transcriptions', handleTranscriptions)

  const realtimeHandler = realtimeVoiceHandler(upgrade)
  app.get('/realtime/voice', realtimeHandler)
  app.get('/v1/realtime/voice', realtimeHandler)

  app.post('/livekit/token', async (c) => {
    try {
      const body = (await c.req.json()) as LiveKitTokenRequest
      const { createToken } = await import('./livekit/token')
      return c.json(await createToken(body))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.includes('required') ? 400 : 500
      console.error('[livekit/token] failed', error)
      return c.json({ error: { message } }, status)
    }
  })

  app.post('/livekit/webhook', async (c) => {
    try {
      const body = await c.req.text()
      const authHeader = c.req.header('authorization')
      const { verifyAndParse } = await import('./livekit/webhook')
      const event = await verifyAndParse(body, authHeader)
      console.info(
        `[webhook] event=${event.event} roomName=${event.room?.name || ''} participantIdentity=${event.participant?.identity || ''}`
      )
      return c.json({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.toLowerCase().includes('invalid') ? 401 : 500
      console.error('[livekit/webhook] failed', error)
      return c.json({ error: { message } }, status)
    }
  })

  return app
}
