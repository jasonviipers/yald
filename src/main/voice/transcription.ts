import { execFile } from 'child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { basename, join } from 'path'

interface TranscriptionRequest {
  audioBase64: string
}

interface TranscriptionResult {
  error: string | null
  transcript: string | null
  metrics: Record<string, number>
}

function runExecFile(bin: string, args: string[], timeout: number): Promise<string> {
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

async function findInPath(names: string[]): Promise<string> {
  if (process.platform === 'win32') {
    for (const name of names) {
      try {
        const located = await runExecFile('where.exe', [name], 5000)
        const first = located
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
        if (first) return first
      } catch {}
    }
    return ''
  }

  const shellPath = existsSync('/bin/zsh')
    ? '/bin/zsh'
    : existsSync('/bin/bash')
      ? '/bin/bash'
      : '/bin/sh'

  for (const name of names) {
    try {
      const located = await runExecFile(shellPath, ['-lc', `command -v ${name}`], 5000)
      const trimmed = located.trim()
      if (trimmed) return trimmed
    } catch {}
  }
  return ''
}

function getVoiceHint(): string {
  if (process.platform === 'darwin') {
    return (
      'Voice transcription is unavailable.\n' +
      'Start the local voice backend or install a local Whisper binary:\n' +
      '  brew install whisperkit-cli\n' +
      '  brew install whisper-cpp'
    )
  }
  if (process.platform === 'win32') {
    return (
      'Voice transcription is unavailable.\n' +
      'Start the local voice backend or install local Whisper:\n' +
      '  install whisper.cpp, WhisperKit, or another local Whisper runtime'
    )
  }
  return (
    'Voice transcription is unavailable.\n' +
    'Start the local voice backend or install local Whisper:\n' +
    '  install whisper.cpp, WhisperKit, or another local Whisper runtime'
  )
}

function mark(metrics: Record<string, number>, name: string, start: number): void {
  metrics[name] = Date.now() - start
}

export async function transcribeAudioBase64(
  request: TranscriptionRequest,
  log: (msg: string) => void
): Promise<TranscriptionResult> {
  const startedAt = Date.now()
  const metrics: Record<string, number> = {}
  const tmpWav = join(tmpdir(), `yald-voice-${Date.now()}.wav`)

  try {
    let t0 = Date.now()
    const buf = Buffer.from(request.audioBase64, 'base64')
    writeFileSync(tmpWav, buf)
    mark(metrics, 'decode+write_wav', t0)

    t0 = Date.now()
    const candidates = [
      '/opt/homebrew/bin/whisperkit-cli',
      '/usr/local/bin/whisperkit-cli',
      join(homedir(), '.local/bin/whisperkit-cli'),
      '/opt/homebrew/bin/whisper-cli',
      '/usr/local/bin/whisper-cli',
      join(homedir(), '.local/bin/whisper-cli'),
      '/opt/homebrew/bin/whisper',
      '/usr/local/bin/whisper',
      '/usr/bin/whisper',
      '/usr/bin/whisper-cli',
      join(homedir(), '.local/bin/whisper'),
      join(homedir(), 'AppData', 'Roaming', 'Python', 'Scripts', 'whisper.exe'),
      join(
        homedir(),
        'AppData',
        'Local',
        'Programs',
        'Python',
        'Python311',
        'Scripts',
        'whisper.exe'
      ),
      join(
        homedir(),
        'AppData',
        'Local',
        'Programs',
        'Python',
        'Python312',
        'Scripts',
        'whisper.exe'
      ),
      join(
        homedir(),
        'AppData',
        'Local',
        'Programs',
        'Python',
        'Python313',
        'Scripts',
        'whisper.exe'
      )
    ]

    let whisperBin = candidates.find((candidate) => existsSync(candidate)) || ''
    mark(metrics, 'probe_binary_paths', t0)

    if (!whisperBin) {
      t0 = Date.now()
      whisperBin = await findInPath(
        process.platform === 'win32'
          ? ['whisperkit-cli.exe', 'whisper-cli.exe', 'whisper.exe']
          : ['whisperkit-cli', 'whisper-cli', 'whisper']
      )
      mark(metrics, 'probe_binary_whence', t0)
    }

    if (!whisperBin) {
      metrics.total = Date.now() - startedAt
      return { error: getVoiceHint(), transcript: null, metrics }
    }

    const isWhisperKit = whisperBin.includes('whisperkit-cli')
    const isWhisperCpp = !isWhisperKit && whisperBin.includes('whisper-cli')
    log(
      `Transcribing with: ${whisperBin} (backend: ${isWhisperKit ? 'WhisperKit' : isWhisperCpp ? 'whisper-cpp' : 'Python whisper'})`
    )

    let output = ''
    if (isWhisperKit) {
      const reportDir = tmpdir()
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        [
          'transcribe',
          '--audio-path',
          tmpWav,
          '--model',
          'tiny',
          '--without-timestamps',
          '--skip-special-tokens',
          '--report',
          '--report-path',
          reportDir
        ],
        60000
      )
      mark(metrics, 'whisperkit_transcribe_report', t0)

      const wavBasename = basename(tmpWav, '.wav')
      const reportPath = join(reportDir, `${wavBasename}.json`)
      if (existsSync(reportPath)) {
        try {
          t0 = Date.now()
          const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
          const transcript = (report.text || '').trim()
          mark(metrics, 'whisperkit_parse_report_json', t0)
          try {
            unlinkSync(reportPath)
          } catch {}
          try {
            unlinkSync(join(reportDir, `${wavBasename}.srt`))
          } catch {}
          metrics.total = Date.now() - startedAt
          log(`Transcription timing(ms): ${JSON.stringify(metrics)}`)
          return { error: null, transcript, metrics }
        } catch (err: any) {
          log(`WhisperKit JSON parse failed: ${err.message}, falling back to stdout`)
        }
      }
    } else if (isWhisperCpp) {
      const modelCandidates = [
        join(homedir(), '.local/share/whisper/ggml-base.bin'),
        join(homedir(), '.local/share/whisper/ggml-tiny.bin'),
        '/opt/homebrew/share/whisper-cpp/models/ggml-base.bin',
        '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.bin',
        join(homedir(), '.local/share/whisper/ggml-base.en.bin'),
        join(homedir(), '.local/share/whisper/ggml-tiny.en.bin'),
        '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin',
        '/opt/homebrew/share/whisper-cpp/models/ggml-tiny.en.bin',
        '/usr/share/whisper/models/ggml-base.bin',
        '/usr/share/whisper/models/ggml-tiny.bin',
        join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-base.bin'),
        join(homedir(), 'AppData', 'Local', 'whisper', 'ggml-tiny.bin')
      ]
      const modelPath = modelCandidates.find((candidate) => existsSync(candidate)) || ''
      if (!modelPath) {
        metrics.total = Date.now() - startedAt
        return { error: getVoiceHint(), transcript: null, metrics }
      }
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        [
          '-m',
          modelPath,
          '-f',
          tmpWav,
          '--no-timestamps',
          '-l',
          modelPath.includes('.en.') ? 'en' : 'auto'
        ],
        30000
      )
      mark(metrics, 'whisper_cpp_transcribe', t0)
    } else {
      t0 = Date.now()
      output = await runExecFile(
        whisperBin,
        [tmpWav, '--model', 'tiny', '--output_format', 'txt', '--output_dir', tmpdir()],
        30000
      )
      mark(metrics, 'python_whisper_transcribe', t0)
      const txtPath = tmpWav.replace('.wav', '.txt')
      if (existsSync(txtPath)) {
        t0 = Date.now()
        const transcript = readFileSync(txtPath, 'utf-8').trim()
        mark(metrics, 'python_whisper_read_txt', t0)
        try {
          unlinkSync(txtPath)
        } catch {}
        metrics.total = Date.now() - startedAt
        log(`Transcription timing(ms): ${JSON.stringify(metrics)}`)
        return { error: null, transcript, metrics }
      }
      metrics.total = Date.now() - startedAt
      return {
        error: `Whisper output file not found at ${txtPath}. Check disk space and permissions.`,
        transcript: null,
        metrics
      }
    }

    const hallucinations = /^\s*(\[BLANK_AUDIO\]|you\.?|thank you\.?|thanks\.?)\s*$/i
    const transcript = output.replace(/\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/g, '').trim()
    metrics.total = Date.now() - startedAt
    log(`Transcription timing(ms): ${JSON.stringify(metrics)}`)
    return {
      error: null,
      transcript: hallucinations.test(transcript) ? '' : transcript || '',
      metrics
    }
  } catch (err: any) {
    metrics.total = Date.now() - startedAt
    log(`Transcription error: ${err.message}`)
    log(`Transcription timing(ms): ${JSON.stringify({ ...metrics, failed: true })}`)
    return {
      error: `Transcription failed: ${err.message}`,
      transcript: null,
      metrics
    }
  } finally {
    try {
      unlinkSync(tmpWav)
    } catch {}
  }
}
