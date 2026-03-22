import type { VoiceEvent, VoiceTurnRequest } from '../../shared/types'
import { resolveBackendUrl, trimTrailingSlash } from '../../shared/backend-url'

function resolveBackendConfig(request: VoiceTurnRequest): { baseUrl: string; apiKey?: string } {
  const baseUrl = resolveBackendUrl(
    request.provider.baseUrl,
    process.env.YALD_VOICE_BACKEND_URL?.trim()
  )
  const apiKey =
    request.provider.apiKey?.trim() || process.env.YALD_VOICE_BACKEND_KEY?.trim() || undefined
  return { baseUrl, apiKey }
}

function toWebSocketUrl(baseUrl: string): string {
  const url = new URL(trimTrailingSlash(baseUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/realtime/voice`
  url.search = ''
  return url.toString()
}

function parseBackendMessage(raw: unknown): VoiceEvent | null {
  if (typeof raw === 'string') {
    const parsed = JSON.parse(raw) as { type?: string }
    if (!parsed?.type || parsed.type === 'ready') return null
    return parsed as VoiceEvent
  }

  if (raw instanceof ArrayBuffer) {
    const parsed = JSON.parse(Buffer.from(raw).toString('utf-8')) as { type?: string }
    if (!parsed?.type || parsed.type === 'ready') return null
    return parsed as VoiceEvent
  }

  if (Buffer.isBuffer(raw)) {
    const parsed = JSON.parse(raw.toString('utf-8')) as { type?: string }
    if (!parsed?.type || parsed.type === 'ready') return null
    return parsed as VoiceEvent
  }

  throw new Error('Unsupported realtime backend payload')
}

export async function runVoiceTurnViaRealtimeBackend(
  request: VoiceTurnRequest,
  signal: AbortSignal,
  emit: (event: VoiceEvent) => void,
  log: (msg: string) => void
): Promise<boolean> {
  const backend = resolveBackendConfig(request)

  const WebSocketCtor = (globalThis as any).WebSocket as
    | (new (url: string) => {
        send(data: string): void
        close(code?: number, reason?: string): void
        addEventListener(type: string, listener: (event: any) => void): void
        removeEventListener(type: string, listener: (event: any) => void): void
      })
    | undefined

  if (!WebSocketCtor) {
    log('Realtime backend skipped: WebSocket client is unavailable in this runtime')
    return false
  }

  const wsUrl = toWebSocketUrl(backend.baseUrl)

  return await new Promise<boolean>((resolve, reject) => {
    let settled = false
    let sawBackendEvent = false
    let sawApplicationError = false

    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }

    const onAbort = () => {
      try {
        socket.close(1000, 'aborted')
      } catch {}
      finish(() => resolve(true))
    }

    const socket = new WebSocketCtor(wsUrl)

    socket.addEventListener('open', () => {
      try {
        socket.send(
          JSON.stringify({
            type: 'start',
            apiKey: backend.apiKey,
            request
          })
        )
      } catch (err: any) {
        finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      }
    })

    socket.addEventListener('message', (event: any) => {
      try {
        const raw =
          typeof event?.data === 'string'
            ? event.data
            : Buffer.isBuffer(event?.data)
              ? event.data.toString('utf-8')
              : String(event?.data ?? '')

        const payload = parseBackendMessage(raw)
        if (!payload) return
        sawBackendEvent = true
        if (payload.type === 'error' || (payload.type === 'state' && payload.state === 'error')) {
          sawApplicationError = true
        }
        emit(payload)
      } catch (err: any) {
        finish(() =>
          reject(new Error(`Realtime backend returned an invalid event: ${err.message}`))
        )
      }
    })

    socket.addEventListener('error', () => {
      if (sawBackendEvent || signal.aborted) return
      finish(() => reject(new Error('Realtime backend connection failed')))
    })

    socket.addEventListener('close', () => {
      if (signal.aborted) {
        finish(() => resolve(true))
        return
      }

      if (sawApplicationError || sawBackendEvent) {
        finish(() => resolve(true))
        return
      }

      finish(() => reject(new Error('Realtime backend closed before sending voice events')))
    })

    signal.addEventListener('abort', onAbort, { once: true })
  })
}
