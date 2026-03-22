export type TtsProvider = 'livekit' | 'none'

export interface AppConfig {
  port: number
  livekit: {
    url: string
    apiKey: string
    apiSecret: string
    tokenTtl: string
    ttsModel: string
    ttsVoice?: string
  }
  ollama: {
    host: string
    apiKey?: string
  }
  elevenlabs: {
    apiKey: string
    sttModel: string
  }
  ttsProvider: TtsProvider
}

export function requireEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  key: string
): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value || 8787)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT value: ${value}`)
  }
  return parsed
}

function parseTtsProvider(value: string | undefined): TtsProvider {
  const provider = (value || 'livekit').trim().toLowerCase()
  if (provider === 'livekit' || provider === 'none') {
    return provider
  }
  throw new Error(`Invalid TTS_PROVIDER value: ${value}`)
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function parseConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): AppConfig {
  return {
    port: parsePort(env.PORT),
    livekit: {
      url: requireEnv(env, 'LIVEKIT_URL'),
      apiKey: requireEnv(env, 'LIVEKIT_API_KEY'),
      apiSecret: requireEnv(env, 'LIVEKIT_API_SECRET'),
      tokenTtl: env.LIVEKIT_TOKEN_TTL?.trim() || '1h',
      ttsModel: env.LIVEKIT_TTS_MODEL?.trim() || 'cartesia/sonic-2',
      ttsVoice: env.LIVEKIT_TTS_VOICE?.trim() || undefined
    },
    ollama: {
      host: trimSlash(env.OLLAMA_HOST?.trim() || 'https://ollama.com'),
      apiKey: env.OLLAMA_API_KEY?.trim() || undefined
    },
    elevenlabs: {
      apiKey: requireEnv(env, 'ELEVENLABS_API_KEY'),
      sttModel: env.ELEVENLABS_STT_MODEL?.trim() || 'scribe_v2'
    },
    ttsProvider: parseTtsProvider(env.TTS_PROVIDER)
  }
}

export const config = parseConfig(process.env)
