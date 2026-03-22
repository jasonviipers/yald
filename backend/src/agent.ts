import {
  AutoSubscribe,
  AgentServer,
  WorkerOptions,
  defineAgent,
  inference,
  initializeLogger,
  tts as livekitTts
} from '@livekit/agents'
import type { JobContext } from '@livekit/agents'
import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type RemoteAudioTrack,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource
} from '@livekit/rtc-node'
import { config } from './config'
import { processVoiceTurn } from './voice/pipeline'
import { encodePcm16Wav } from './voice/stt'
import type {
  LiveKitParticipantMetadata,
  PromptHistoryMessage,
  ProviderContext,
  VoiceEvent,
  VoiceTurnCapture,
  VoiceTurnRequest
} from './types'

const historyByIdentity = new Map<string, PromptHistoryMessage[]>()
const encoder = new TextEncoder()
const VAD_THRESHOLD = Math.round(0.018 * 32767)
const VAD_SILENCE_MS = 720
const MIN_SPEECH_MS = 180
const AUDIO_SAMPLE_RATE = 16_000
const AUDIO_CHANNELS = 1

function parseParticipantMetadata(metadata: string): LiveKitParticipantMetadata {
  if (!metadata.trim()) {
    return {}
  }

  try {
    // Participant metadata is arbitrary JSON originating from the client token request.
    return JSON.parse(metadata) as LiveKitParticipantMetadata
  } catch {
    return {}
  }
}

function resolveProvider(metadata: LiveKitParticipantMetadata): ProviderContext {
  return {
    providerId: 'ollama',
    model: metadata.model?.trim() || 'gpt-oss:120b',
    baseUrl: config.ollama.host,
    apiKey: config.ollama.apiKey,
    transport: 'livekit'
  }
}

async function publishEvent(
  ctx: JobContext,
  participantIdentity: string,
  event: VoiceEvent
): Promise<void> {
  await ctx.room.localParticipant?.publishData(encoder.encode(JSON.stringify(event)), {
    reliable: true,
    destination_identities: [participantIdentity],
    topic: 'yald.voice'
  })
}

function rmsLevel(samples: Int16Array): number {
  if (samples.length === 0) {
    return 0
  }

  let sumSq = 0
  for (const sample of samples) {
    sumSq += sample * sample
  }
  return Math.sqrt(sumSq / samples.length)
}

function concatFrames(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const merged = new Int16Array(total)
  let offset = 0
  for (const frame of frames) {
    merged.set(frame, offset)
    offset += frame.length
  }
  return merged
}

function appendHistory(
  identity: string,
  transcript: string | undefined,
  fullText: string | undefined
): void {
  if (!transcript || !fullText) {
    return
  }

  const nextHistory = [...(historyByIdentity.get(identity) || [])]
  nextHistory.push({ role: 'user', content: transcript })
  nextHistory.push({ role: 'assistant', content: fullText })
  historyByIdentity.set(identity, nextHistory)
}

async function waitForRemoteAudioTrack(
  ctx: JobContext,
  participantIdentity: string
): Promise<RemoteAudioTrack> {
  return await new Promise<RemoteAudioTrack>((resolve) => {
    const onTrackSubscribed = (
      track: RemoteAudioTrack,
      _publication: unknown,
      participant: { identity: string }
    ): void => {
      if (participant.identity !== participantIdentity || track.kind !== TrackKind.KIND_AUDIO) {
        return
      }
      ctx.room.off(RoomEvent.TrackSubscribed, onTrackSubscribed)
      resolve(track)
    }

    ctx.room.on(RoomEvent.TrackSubscribed, onTrackSubscribed)
  })
}

function createAssistantAudioPublisher(): {
  source: AudioSource
  track: LocalAudioTrack
  publishOptions: TrackPublishOptions
} {
  const source = new AudioSource(AUDIO_SAMPLE_RATE, AUDIO_CHANNELS)
  const track = LocalAudioTrack.createAudioTrack('assistant-audio', source)
  const publishOptions = new TrackPublishOptions()
  publishOptions.source = TrackSource.SOURCE_MICROPHONE
  return { source, track, publishOptions }
}

async function speakWithLiveKitTts(
  ctx: JobContext,
  participantIdentity: string,
  source: AudioSource,
  text: string,
  tabId: string
): Promise<void> {
  const tts = new inference.tts.TTS({
    model: config.livekit.ttsModel,
    voice: config.livekit.ttsVoice
  })
  const stream = tts.stream()

  await publishEvent(ctx, participantIdentity, { type: 'state', tabId, state: 'speaking' })

  stream.pushText(text)
  stream.flush()
  stream.endInput()

  try {
    for await (const audio of stream) {
      if (audio === livekitTts.SynthesizeStream.END_OF_STREAM) {
        continue
      }
      await source.captureFrame(audio.frame)
    }
    await source.waitForPlayout()
  } finally {
    stream.close()
    await tts.close()
  }
}

async function runParticipantTurn(
  ctx: JobContext,
  participantIdentity: string,
  request: VoiceTurnRequest,
  assistantAudio: AudioSource
): Promise<void> {
  const capture: VoiceTurnCapture = {}
  let deferredListeningState: VoiceEvent | null = null

  await processVoiceTurn(request, (event) => {
    if (event.type === 'transcript' && event.isFinal) {
      capture.transcript = event.text
    }
    if (event.type === 'assistant_text' && event.isFinal) {
      capture.fullText = event.fullText
    }
    if (event.type === 'metrics') {
      capture.metrics = event.metrics
    }
    if (event.type === 'state' && event.state === 'listening') {
      deferredListeningState = event
      return
    }
    void publishEvent(ctx, participantIdentity, event)
  })

  appendHistory(participantIdentity, capture.transcript, capture.fullText)

  if (capture.metrics) {
    const metrics = capture.metrics
    console.info(
      `[${request.tabId}/${participantIdentity}] sttMs=${metrics.sttMs ?? 0} firstTokenMs=${metrics.firstTokenMs ?? 0} totalMs=${metrics.totalMs ?? 0}`
    )
  }

  if (config.ttsProvider === 'livekit' && capture.fullText?.trim()) {
    await speakWithLiveKitTts(
      ctx,
      participantIdentity,
      assistantAudio,
      capture.fullText,
      request.tabId
    )
  }

  if (deferredListeningState) {
    await publishEvent(ctx, participantIdentity, deferredListeningState)
  }
}

async function processParticipantAudio(
  ctx: JobContext,
  participantIdentity: string
): Promise<void> {
  const participant = await ctx.waitForParticipant(participantIdentity)
  const metadata = parseParticipantMetadata(participant.metadata)
  const provider = resolveProvider(metadata)
  const tabId = metadata.tabId?.trim() || participant.identity

  const remoteTrack = await waitForRemoteAudioTrack(ctx, participant.identity)
  const stream = new AudioStream(remoteTrack, {
    sampleRate: AUDIO_SAMPLE_RATE,
    numChannels: AUDIO_CHANNELS
  })
  const reader = stream.getReader()

  const { source, track, publishOptions } = createAssistantAudioPublisher()
  await ctx.room.localParticipant?.publishTrack(track, publishOptions)
  ctx.addShutdownCallback(async () => {
    await track.close()
    await source.close()
  })

  let speechActive = false
  let speechStartedAt = 0
  let lastVoiceAt = 0
  let speechFrames: Int16Array[] = []
  let turnInFlight = false

  await publishEvent(ctx, participant.identity, {
    type: 'state',
    tabId,
    state: 'listening'
  })

  const flushTurn = async (): Promise<void> => {
    if (turnInFlight || speechFrames.length === 0) {
      return
    }

    const elapsed = Date.now() - speechStartedAt
    const pcm = concatFrames(speechFrames)
    speechFrames = []
    speechActive = false

    if (elapsed < MIN_SPEECH_MS) {
      return
    }

    turnInFlight = true
    try {
      const wav = encodePcm16Wav(pcm, AUDIO_SAMPLE_RATE, AUDIO_CHANNELS)
      await runParticipantTurn(
        ctx,
        participant.identity,
        {
          tabId,
          audioBase64: wav.toString('base64'),
          provider,
          history: historyByIdentity.get(participant.identity) || [],
          voice: metadata.voice
        },
        source
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[agent] turn failed', error)
      await publishEvent(ctx, participant.identity, {
        type: 'error',
        tabId,
        message,
        recoverable: true
      })
      await publishEvent(ctx, participant.identity, {
        type: 'state',
        tabId,
        state: 'listening',
        message
      })
    } finally {
      turnInFlight = false
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (turnInFlight) {
        continue
      }

      const now = Date.now()
      const aboveThreshold = rmsLevel(value.data) >= VAD_THRESHOLD

      if (aboveThreshold) {
        lastVoiceAt = now
        if (!speechActive) {
          speechActive = true
          speechStartedAt = now
          speechFrames = []
        }
      }

      if (speechActive) {
        speechFrames.push(new Int16Array(value.data))
        if (!aboveThreshold && now - lastVoiceAt > VAD_SILENCE_MS) {
          await flushTurn()
        }
      }
    }

    await flushTurn()
  } finally {
    reader.releaseLock()
  }
}

const workerAgent = defineAgent({
  entry: async (ctx: JobContext): Promise<void> => {
    let participantIdentity = ''
    let roomName = ''

    try {
      await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY)
      const participant = await ctx.waitForParticipant()
      participantIdentity = participant.identity
      roomName = ctx.room.name || ctx.job.room?.name || 'unknown'
      console.info(`[agent] joined room=${roomName} identity=${participant.identity}`)

      const onParticipantDisconnected = async (remoteParticipant: {
        identity: string
      }): Promise<void> => {
        if (remoteParticipant.identity !== participant.identity) {
          return
        }
        historyByIdentity.delete(participant.identity)
        console.info(`[agent] left room=${roomName}`)
        ctx.shutdown('participant_left')
      }

      ctx.room.on(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      ctx.addShutdownCallback(async () => {
        ctx.room.off(RoomEvent.ParticipantDisconnected, onParticipantDisconnected)
      })

      await processParticipantAudio(ctx, participant.identity)
    } catch (error) {
      const tabId = participantIdentity || 'unknown'
      const message = error instanceof Error ? error.message : String(error)
      console.error('[agent] entry failed', error)

      if (participantIdentity) {
        await publishEvent(ctx, participantIdentity, {
          type: 'error',
          tabId,
          message,
          recoverable: true
        })
        await publishEvent(ctx, participantIdentity, {
          type: 'state',
          tabId,
          state: 'listening',
          message
        })
      }

      historyByIdentity.delete(participantIdentity)
      if (roomName) {
        console.info(`[agent] left room=${roomName}`)
      }
      throw error
    }
  }
})

let workerServer: AgentServer | null = null
let loggerInitialized = false

function ensureAgentLogger(): void {
  if (loggerInitialized) {
    return
  }

  initializeLogger({
    pretty: process.env.NODE_ENV !== 'production',
    level: process.env.LOG_LEVEL || 'info'
  })
  loggerInitialized = true
}

export async function startAgentWorker(): Promise<void> {
  if (workerServer) {
    return
  }

  ensureAgentLogger()

  workerServer = new AgentServer(
    new WorkerOptions({
      agent: new URL('./agent.ts', import.meta.url).pathname,
      wsURL: config.livekit.url,
      apiKey: config.livekit.apiKey,
      apiSecret: config.livekit.apiSecret,
      agentName: 'yald-livekit-agent'
    })
  )

  workerServer.run().catch((error) => {
    workerServer = null
    console.error('[agent] worker failed', error)
  })
}

export default workerAgent
