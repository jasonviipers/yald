import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message, PromptHistoryMessage, ProviderContext, VoiceEvent } from '@shared/types'
import {
  connectLiveKitVoice,
  getLiveKitBackendUrl,
  type LiveKitVoiceSession
} from '../lib/livekit-voice'
import { useSessionStore } from '../stores/sessionStore'

type VoiceUiState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error'

interface UseRealtimeVoiceOptions {
  tabId: string | null
  tabMessages: Message[]
  provider: ProviderContext
}

interface PlaybackChunk {
  audioBase64: string
  mimeType: string
  text: string
}

const VAD_THRESHOLD = 0.018
const VAD_SILENCE_MS = 720
const MIN_SPEECH_MS = 180

function buildPromptHistory(messages: Message[]): PromptHistoryMessage[] {
  return messages
    .filter(
      (message): message is Message & { role: 'system' | 'user' | 'assistant' } =>
        message.role === 'system' || message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => ({ role: message.role, content: message.content }))
}

function appendUserMessage(tabId: string, content: string): void {
  useSessionStore.setState((state) => ({
    tabs: state.tabs.map((tab) =>
      tab.id === tabId
        ? {
            ...tab,
            messages: [
              ...tab.messages,
              {
                id: crypto.randomUUID(),
                role: 'user',
                content,
                timestamp: Date.now()
              }
            ]
          }
        : tab
    )
  }))
}

function appendAssistantChunk(tabId: string, messageId: string, text: string): void {
  useSessionStore.setState((state) => ({
    tabs: state.tabs.map((tab) => {
      if (tab.id !== tabId) return tab
      const idx = tab.messages.findIndex((message) => message.id === messageId)
      if (idx === -1) {
        return {
          ...tab,
          messages: [
            ...tab.messages,
            {
              id: messageId,
              role: 'assistant',
              content: text,
              timestamp: Date.now()
            }
          ]
        }
      }

      const updated = [...tab.messages]
      updated[idx] = { ...updated[idx], content: updated[idx].content + text }
      return { ...tab, messages: updated }
    })
  }))
}

function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  return Math.sqrt(sumSq / samples.length)
}

function flattenFrames(frames: Float32Array[]): Float32Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const merged = new Float32Array(total)
  let offset = 0
  for (const frame of frames) {
    merged.set(frame, offset)
    offset += frame.length
  }
  return merged
}

function normalizePcm(samples: Float32Array): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  if (peak < 1e-4 || peak > 0.95) return samples
  const gain = Math.min(0.95 / peak, 8)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

function resampleLinear(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  const ratio = inRate / outRate
  const outLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = pos - i0
    output[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return output
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function useRealtimeVoice({ tabId, tabMessages, provider }: UseRealtimeVoiceOptions) {
  const [isActive, setIsActive] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceUiState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)

  const tabIdRef = useRef(tabId)
  const messagesRef = useRef(tabMessages)
  const liveModeRef = useRef(false)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const speechActiveRef = useRef(false)
  const speechStartedAtRef = useRef(0)
  const lastVoiceAtRef = useRef(0)
  const speechFramesRef = useRef<Float32Array[]>([])
  const processingRef = useRef(false)
  const playbackQueueRef = useRef<PlaybackChunk[]>([])
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const usingSpeechSynthesisRef = useRef(false)
  const liveKitSessionRef = useRef<LiveKitVoiceSession | null>(null)
  const liveKitAudioAvailableRef = useRef(false)
  const assistantMessageIdRef = useRef<string | null>(null)
  const assistantFullTextRef = useRef('')
  const receivedAudioRef = useRef(false)
  const voiceStateRef = useRef<VoiceUiState>('idle')

  tabIdRef.current = tabId
  messagesRef.current = tabMessages
  voiceStateRef.current = voiceState

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = []
    currentAudioRef.current?.pause()
    currentAudioRef.current = null
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    usingSpeechSynthesisRef.current = false
  }, [])

  const playNextChunk = useCallback(() => {
    if (currentAudioRef.current || usingSpeechSynthesisRef.current) return
    const next = playbackQueueRef.current.shift()
    if (!next) {
      if (liveModeRef.current && !processingRef.current) setVoiceState('listening')
      return
    }

    const audio = new Audio(`data:${next.mimeType};base64,${next.audioBase64}`)
    currentAudioRef.current = audio
    setVoiceState('speaking')
    audio.onended = () => {
      currentAudioRef.current = null
      playNextChunk()
    }
    audio.onerror = () => {
      currentAudioRef.current = null
      playNextChunk()
    }
    void audio.play().catch(() => {
      currentAudioRef.current = null
      playNextChunk()
    })
  }, [])

  const speakFallback = useCallback((text: string) => {
    if (!text.trim() || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    usingSpeechSynthesisRef.current = true
    setVoiceState('speaking')
    utterance.onend = () => {
      usingSpeechSynthesisRef.current = false
      if (liveModeRef.current && !processingRef.current) setVoiceState('listening')
    }
    utterance.onerror = () => {
      usingSpeechSynthesisRef.current = false
      if (liveModeRef.current && !processingRef.current) setVoiceState('listening')
    }
    window.speechSynthesis.speak(utterance)
  }, [])

  const interruptActiveTurn = useCallback(() => {
    stopPlayback()
    processingRef.current = false
    if (!liveKitSessionRef.current && tabIdRef.current) {
      void window.yald.cancelVoiceTurn(tabIdRef.current)
    }
  }, [stopPlayback])

  const applyVoiceEvent = useCallback(
    (event: VoiceEvent) => {
      if (event.tabId !== tabIdRef.current) return

      if (event.type === 'state') {
        if (event.state === 'error') {
          processingRef.current = false
          setVoiceState('error')
          if (event.message) setVoiceError(event.message)
          return
        }
        if (event.state === 'listening') processingRef.current = false
        setVoiceState(event.state)
        return
      }

      if (event.type === 'error') {
        processingRef.current = false
        setVoiceState('error')
        setVoiceError(event.message)
        return
      }

      if (event.type === 'transcript' && event.isFinal) {
        appendUserMessage(event.tabId, event.text)
        assistantMessageIdRef.current = crypto.randomUUID()
        assistantFullTextRef.current = ''
        receivedAudioRef.current = liveKitAudioAvailableRef.current
        return
      }

      if (event.type === 'assistant_text') {
        if (!event.isFinal && event.text) {
          const messageId = assistantMessageIdRef.current || crypto.randomUUID()
          assistantMessageIdRef.current = messageId
          assistantFullTextRef.current += event.text
          appendAssistantChunk(event.tabId, messageId, event.text)
          return
        }

        processingRef.current = false
        if (!receivedAudioRef.current && event.fullText) {
          if (!assistantMessageIdRef.current) {
            assistantMessageIdRef.current = crypto.randomUUID()
            appendAssistantChunk(event.tabId, assistantMessageIdRef.current, event.fullText)
          }
          speakFallback(event.fullText)
        } else if (liveModeRef.current) {
          setVoiceState('listening')
        }
        return
      }

      if (event.type === 'audio_chunk') {
        receivedAudioRef.current = true
        playbackQueueRef.current.push({
          audioBase64: event.audioBase64,
          mimeType: event.mimeType,
          text: event.text
        })
        playNextChunk()
        return
      }

      if (event.type === 'metrics') {
        console.info('[yald][voice]', event.metrics)
      }
    },
    [playNextChunk, speakFallback]
  )

  const finalizeUtterance = useCallback(
    async (frames: Float32Array[], sampleRate: number) => {
      if (!tabIdRef.current || frames.length === 0) return
      const merged = flattenFrames(frames)
      const inputRms = rmsLevel(merged)
      if (inputRms < 0.003) return

      processingRef.current = true
      assistantMessageIdRef.current = null
      assistantFullTextRef.current = ''
      receivedAudioRef.current = false
      setVoiceState('transcribing')
      setVoiceError(null)

      const normalized = normalizePcm(resampleLinear(merged, sampleRate, 16000))
      const audioBase64 = bufferToBase64(encodeWav(normalized, 16000))

      try {
        await window.yald.processVoiceTurn({
          tabId: tabIdRef.current,
          audioBase64,
          provider,
          history: buildPromptHistory(messagesRef.current),
          voice: { preset: 'natural' }
        })
      } catch (err: any) {
        processingRef.current = false
        setVoiceState(liveModeRef.current ? 'listening' : 'idle')
        setVoiceError(`Voice request failed: ${err.message}`)
      }
    },
    [provider]
  )

  const stopVoice = useCallback(() => {
    liveModeRef.current = false
    setIsActive(false)
    speechActiveRef.current = false
    speechFramesRef.current = []
    processingRef.current = false
    stopPlayback()

    if (liveKitSessionRef.current) {
      const session = liveKitSessionRef.current
      liveKitSessionRef.current = null
      liveKitAudioAvailableRef.current = false
      void session.disconnect().catch(() => {})
    } else {
      interruptActiveTurn()
    }

    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((track) => track.stop())

    processorRef.current = null
    sourceRef.current = null
    streamRef.current = null

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    setVoiceState('idle')
  }, [interruptActiveTurn, stopPlayback])

  const startVoice = useCallback(async () => {
    if (!tabId) {
      setVoiceError('Open a tab before starting voice.')
      return
    }

    const liveKitBackendUrl = getLiveKitBackendUrl(provider)
    setVoiceError(null)

    if (liveKitBackendUrl) {
      try {
        const session = await connectLiveKitVoice({
          backendUrl: liveKitBackendUrl,
          tabId,
          provider,
          voice: { preset: 'natural' },
          onEvent: applyVoiceEvent,
          onAudioTrack: () => {
            liveKitAudioAvailableRef.current = true
            receivedAudioRef.current = true
          },
          onDisconnect: (message) => {
            liveKitSessionRef.current = null
            liveKitAudioAvailableRef.current = false
            liveModeRef.current = false
            processingRef.current = false
            setIsActive(false)
            setVoiceState('idle')
            if (message) {
              setVoiceError(message)
            }
          }
        })

        liveKitSessionRef.current = session
        liveKitAudioAvailableRef.current = false
        liveModeRef.current = true
        setIsActive(true)
        processingRef.current = false
        receivedAudioRef.current = false
        assistantMessageIdRef.current = null
        assistantFullTextRef.current = ''
        setVoiceState('listening')
        return
      } catch (error) {
        console.warn('[livekit][voice] falling back to legacy transport', error)
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const processor = audioContext.createScriptProcessor(2048, 1, 1)

      liveModeRef.current = true
      setIsActive(true)
      speechActiveRef.current = false
      speechFramesRef.current = []
      processingRef.current = false
      streamRef.current = stream
      audioContextRef.current = audioContext
      sourceRef.current = source
      processorRef.current = processor
      setVoiceError(null)
      setVoiceState('listening')

      processor.onaudioprocess = (event) => {
        if (!liveModeRef.current) return

        const input = event.inputBuffer.getChannelData(0)
        const frame = new Float32Array(input.length)
        frame.set(input)
        const rms = rmsLevel(frame)
        const now = performance.now()
        const aboveThreshold = rms >= VAD_THRESHOLD

        if (aboveThreshold) {
          if (
            voiceStateRef.current === 'speaking' ||
            voiceStateRef.current === 'thinking' ||
            voiceStateRef.current === 'transcribing'
          ) {
            interruptActiveTurn()
            setVoiceState('listening')
          }

          lastVoiceAtRef.current = now
          if (!speechActiveRef.current) {
            speechActiveRef.current = true
            speechStartedAtRef.current = now
            speechFramesRef.current = []
          }
        }

        if (speechActiveRef.current) {
          speechFramesRef.current.push(frame)
          if (!aboveThreshold && now - lastVoiceAtRef.current > VAD_SILENCE_MS) {
            const elapsed = now - speechStartedAtRef.current
            const frames = speechFramesRef.current
            speechActiveRef.current = false
            speechFramesRef.current = []
            if (elapsed >= MIN_SPEECH_MS) {
              void finalizeUtterance(frames, event.inputBuffer.sampleRate)
            }
          }
        }
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
    } catch {
      setVoiceError('Microphone permission denied or unavailable.')
      stopVoice()
    }
  }, [applyVoiceEvent, finalizeUtterance, interruptActiveTurn, provider, stopVoice, tabId])

  const toggleVoice = useCallback(() => {
    if (liveModeRef.current) stopVoice()
    else void startVoice()
  }, [startVoice, stopVoice])

  useEffect(() => {
    const unsubscribe = window.yald.onVoiceEvent(applyVoiceEvent)

    return unsubscribe
  }, [applyVoiceEvent])

  useEffect(() => {
    return () => {
      stopVoice()
    }
  }, [stopVoice])

  const clearVoiceError = useCallback(() => {
    setVoiceError(null)
  }, [])

  return {
    isActive,
    voiceState,
    voiceError,
    toggleVoice,
    stopVoice,
    clearVoiceError
  }
}
