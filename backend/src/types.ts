export type ProviderID = 'ollama'

export interface ProviderContext {
  providerId: ProviderID
  model: string
  baseUrl?: string
  apiKey?: string
  transport?: 'api' | 'livekit'
}

export interface PromptHistoryMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface VoiceStyle {
  preset?: 'natural' | 'fast' | 'warm'
  rate?: number
  pitch?: number
  volume?: number
}

export interface VoiceLatencyMetrics {
  sttMs?: number
  firstTokenMs?: number
  firstAudioMs?: number
  totalMs?: number
}

export interface VoiceTurnRequest {
  tabId: string
  audioBase64: string
  provider: ProviderContext
  history?: PromptHistoryMessage[]
  voice?: VoiceStyle
  screenshotBase64?: string
}

export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

export type VoiceEvent =
  | {
      type: 'state'
      tabId: string
      state: VoiceSessionState
      message?: string
    }
  | {
      type: 'transcript'
      tabId: string
      text: string
      isFinal: boolean
    }
  | {
      type: 'assistant_text'
      tabId: string
      text: string
      isFinal: boolean
      fullText?: string
    }
  | {
      type: 'audio_chunk'
      tabId: string
      chunkId: string
      audioBase64: string
      mimeType: string
      text: string
      isFinal: boolean
    }
  | {
      type: 'metrics'
      tabId: string
      metrics: VoiceLatencyMetrics
    }
  | {
      type: 'error'
      tabId: string
      message: string
      recoverable?: boolean
    }

export interface LiveKitTokenRequest {
  identity: string
  roomName: string
  metadata?: string
}

export interface LiveKitTokenResponse {
  token: string
  url: string
}

export interface LiveKitParticipantMetadata {
  tabId?: string
  model?: string
  voice?: VoiceStyle
}

export interface VoiceTurnCapture {
  transcript?: string
  fullText?: string
  metrics?: VoiceLatencyMetrics
}

export type VisionActionName =
  | 'none'
  | 'create_tab'
  | 'toggle_settings'
  | 'toggle_voice'
  | 'hide_window'
  | 'move_left'
  | 'move_right'
  | 'move_up'
  | 'move_down'

export interface VisionAnalyzeRequest {
  tabId: string
  provider: ProviderContext
  screenshotBase64: string
  prompt?: string
  previousSummary?: string
}

export interface VisionAnalyzeResponse {
  summary: string
  guidance: string
  confidence: 'low' | 'medium' | 'high'
  suggestedAction: VisionActionName
  actionReason?: string
  model: string
}
