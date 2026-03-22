import { describe, expect, test } from 'bun:test'
import { parseConfig } from './config'

describe('parseConfig', () => {
  test('parses required livekit and elevenlabs settings and defaults', () => {
    const config = parseConfig({
      LIVEKIT_URL: 'wss://example.livekit.cloud',
      LIVEKIT_API_KEY: 'key',
      LIVEKIT_API_SECRET: 'secret',
      ELEVENLABS_API_KEY: 'el-key'
    })

    expect(config.port).toBe(8787)
    expect(config.ollama.host).toBe('https://ollama.com')
    expect(config.ttsProvider).toBe('livekit')
    expect(config.elevenlabs.sttModel).toBe('scribe_v2')
  })

  test('throws when livekit credentials are missing', () => {
    expect(() =>
      parseConfig({
        LIVEKIT_URL: 'wss://example.livekit.cloud',
        ELEVENLABS_API_KEY: 'el-key'
      })
    ).toThrow('LIVEKIT_API_KEY')
  })

  test('throws when elevenlabs api key is missing', () => {
    expect(() =>
      parseConfig({
        LIVEKIT_URL: 'wss://example.livekit.cloud',
        LIVEKIT_API_KEY: 'key',
        LIVEKIT_API_SECRET: 'secret'
      })
    ).toThrow('ELEVENLABS_API_KEY')
  })
})
