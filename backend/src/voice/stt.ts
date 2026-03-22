import { config } from '../config'

export async function transcribeWithElevenLabs(buf: Buffer): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'speech.wav')
  form.append('model_id', config.elevenlabs.sttModel)

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': config.elevenlabs.apiKey
    },
    body: form
  })

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText)
    throw new Error(
      `ElevenLabs STT request failed (${response.status}): ${message || response.statusText}`
    )
  }

  // Response shape: { text: string, ... }
  const payload = (await response.json()) as { text?: unknown }
  return typeof payload.text === 'string' ? payload.text.trim() : ''
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

export function encodePcm16Wav(samples: Int16Array, sampleRate: number, channels: number): Buffer {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true)
  view.setUint16(32, channels * bytesPerSample, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (const sample of samples) {
    view.setInt16(offset, sample, true)
    offset += 2
  }

  return Buffer.from(buffer)
}
