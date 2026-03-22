import { execFile } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { VoiceStyle } from '../../shared/types'

export interface TtsChunk {
  audio: Buffer
  mimeType: string
}

function execFileAsync(bin: string, args: string[], timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'utf-8', timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || stdout?.trim() || err.message))
        return
      }
      resolve(stdout || '')
    })
  })
}

function execFileBuffer(bin: string, args: string[], timeout = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding: 'buffer', timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(
          new Error(
            Buffer.isBuffer(stderr)
              ? stderr.toString('utf-8').trim() || err.message
              : (stderr as string)?.trim() || err.message
          )
        )
        return
      }
      resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as any))
    })
  })
}

function resolveRate(style?: VoiceStyle): number {
  if (typeof style?.rate === 'number') return style.rate
  switch (style?.preset) {
    case 'fast':
      return 1.15
    case 'warm':
      return 0.92
    default:
      return 1
  }
}

function resolvePitch(style?: VoiceStyle): number {
  if (typeof style?.pitch === 'number') return style.pitch
  return style?.preset === 'warm' ? 0.92 : 1
}

export async function synthesizeSpeechChunk(
  text: string,
  style: VoiceStyle | undefined,
  log: (msg: string) => void
): Promise<TtsChunk | null> {
  const cleaned = text.trim()
  if (!cleaned) return null

  if (process.platform === 'darwin') {
    const workDir = mkdtempSync(join(tmpdir(), 'yald-tts-'))
    const aiffPath = join(workDir, 'speech.aiff')
    const wavPath = join(workDir, 'speech.wav')
    try {
      await execFileAsync('say', [
        '-r',
        String(Math.round(180 * resolveRate(style))),
        '-o',
        aiffPath,
        cleaned
      ])
      await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath])
      return { audio: readFileSync(wavPath), mimeType: 'audio/wav' }
    } catch (err: any) {
      log(`macOS TTS unavailable: ${err.message}`)
      return null
    } finally {
      try {
        unlinkSync(aiffPath)
      } catch {}
      try {
        unlinkSync(wavPath)
      } catch {}
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {}
    }
  }

  if (process.platform === 'win32') {
    const workDir = mkdtempSync(join(tmpdir(), 'yald-tts-'))
    const outPath = join(workDir, 'speech.wav')
    const textPath = join(workDir, 'speech.txt')
    const rate = Math.max(-5, Math.min(5, Math.round((resolveRate(style) - 1) * 10)))
    writeFileSync(textPath, cleaned, 'utf-8')
    try {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          [
            'Add-Type -AssemblyName System.Speech;',
            '$text = Get-Content -Raw $args[0];',
            '$out = $args[1];',
            '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
            `$synth.Rate = ${rate};`,
            '$synth.SetOutputToWaveFile($out);',
            '$synth.Speak($text);',
            '$synth.Dispose();'
          ].join(' '),
          textPath,
          outPath
        ],
        45000
      )
      return { audio: readFileSync(outPath), mimeType: 'audio/wav' }
    } catch (err: any) {
      log(`Windows TTS unavailable: ${err.message}`)
      return null
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {}
    }
  }

  const espeakCandidates = [
    '/usr/bin/espeak',
    '/usr/local/bin/espeak',
    join(homedir(), '.local/bin/espeak')
  ]
  const espeak = espeakCandidates.find((candidate) => existsSync(candidate)) || 'espeak'
  try {
    const output = await execFileBuffer(
      espeak,
      [
        '--stdout',
        '-s',
        String(Math.round(175 * resolveRate(style))),
        '-p',
        String(Math.round(50 * resolvePitch(style))),
        cleaned
      ],
      45000
    )
    return { audio: output, mimeType: 'audio/wav' }
  } catch (err: any) {
    log(`Linux TTS unavailable: ${err.message}`)
    return null
  }
}
