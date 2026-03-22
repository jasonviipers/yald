import { Room, RoomEvent, Track } from 'livekit-client'
import { resolveBackendUrl } from '@shared/backend-url'
import type { ProviderContext, VoiceEvent, VoiceStyle } from '@shared/types'

const decoder = new TextDecoder()

export interface LiveKitVoiceSession {
  disconnect(): Promise<void>
}

interface ConnectLiveKitVoiceOptions {
  backendUrl: string
  tabId: string
  provider: ProviderContext
  voice?: VoiceStyle
  onEvent: (event: VoiceEvent) => void
  onAudioTrack: () => void
  onDisconnect: (message?: string) => void
}

interface TokenResponse {
  token: string
  url: string
}

export function getLiveKitBackendUrl(provider: ProviderContext): string | null {
  return resolveBackendUrl(provider.baseUrl)
}

async function fetchLiveKitToken(
  backendUrl: string,
  tabId: string,
  provider: ProviderContext,
  voice?: VoiceStyle
): Promise<TokenResponse> {
  const response = await fetch(`${backendUrl}/livekit/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      identity: `voice-${tabId}-${crypto.randomUUID().slice(0, 8)}`,
      roomName: `yald-voice-${tabId}`,
      metadata: JSON.stringify({
        tabId,
        model: provider.model,
        voice
      })
    })
  })

  if (!response.ok) {
    throw new Error(`LiveKit token request failed (${response.status})`)
  }

  return (await response.json()) as TokenResponse
}

export async function connectLiveKitVoice(
  options: ConnectLiveKitVoiceOptions
): Promise<LiveKitVoiceSession> {
  const tokenResponse = await fetchLiveKitToken(
    options.backendUrl,
    options.tabId,
    options.provider,
    options.voice
  )
  const room = new Room()
  const attachedAudioElements = new Set<HTMLMediaElement>()

  const handleDataReceived = (
    payload: Uint8Array,
    _participant?: unknown,
    _kind?: unknown,
    topic?: string
  ) => {
    if (topic && topic !== 'yald.voice') {
      return
    }

    try {
      const text = decoder.decode(payload)
      const event = JSON.parse(text) as VoiceEvent
      if (event && typeof event === 'object' && 'type' in event) {
        options.onEvent(event)
      }
    } catch (error) {
      console.error('[livekit][voice] invalid data payload', error)
    }
  }

  const handleTrackSubscribed = (track: Track): void => {
    if (track.kind !== Track.Kind.Audio) {
      return
    }

    options.onAudioTrack()
    const element = track.attach()
    element.autoplay = true
    element.style.display = 'none'
    document.body.appendChild(element)
    attachedAudioElements.add(element)
    void element.play().catch(() => {})
  }

  const handleDisconnected = (): void => {
    options.onDisconnect()
  }

  room
    .on(RoomEvent.DataReceived, handleDataReceived)
    .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    .on(RoomEvent.Disconnected, handleDisconnected)

  try {
    await room.connect(tokenResponse.url, tokenResponse.token, {
      autoSubscribe: true
    })
    await room.localParticipant.setMicrophoneEnabled(true)
  } catch (error) {
    room.off(RoomEvent.DataReceived, handleDataReceived)
    room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
    room.off(RoomEvent.Disconnected, handleDisconnected)
    throw error
  }

  return {
    async disconnect(): Promise<void> {
      room.off(RoomEvent.DataReceived, handleDataReceived)
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      room.off(RoomEvent.Disconnected, handleDisconnected)

      attachedAudioElements.forEach((element) => {
        element.pause()
        element.remove()
      })
      attachedAudioElements.clear()

      await room.disconnect()
    }
  }
}
