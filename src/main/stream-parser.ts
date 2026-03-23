import { Readable } from 'stream'
import { EventEmitter } from 'events'
import { log as _log } from './logger'
import type { ClaudeEvent } from '../shared/types'

const MAX_BUFFER_BYTES = 8 * 1024 * 1024 // 8 MB — hard ceiling before we declare the stream corrupt
const MAX_LINE_BYTES = 1 * 1024 * 1024 // 1 MB — single line above this is malformed, skip it

function log(message: string): void {
  _log('stream-parser', message)
}

export interface StreamParserEvents {
  event: (parsed: ClaudeEvent) => void
  'parse-error': (raw: string, reason: string) => void
  'buffer-overflow': (byteLength: number) => void
  'line-overflow': (byteLength: number) => void
}

export class StreamParser extends EventEmitter {
  private buffer = ''
  private byteLength = 0
  private lineCount = 0
  private errorCount = 0
  private overflowed = false

  get stats(): Readonly<{ lineCount: number; errorCount: number; byteLength: number }> {
    return { lineCount: this.lineCount, errorCount: this.errorCount, byteLength: this.byteLength }
  }

  on<K extends keyof StreamParserEvents>(event: K, listener: StreamParserEvents[K]): this
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener)
  }

  once<K extends keyof StreamParserEvents>(event: K, listener: StreamParserEvents[K]): this
  once(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.once(event, listener)
  }

  emit<K extends keyof StreamParserEvents>(
    event: K,
    ...args: Parameters<StreamParserEvents[K]>
  ): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  /**
   * Feed a chunk of stdout data into the parser.
   * Emits 'event' for each valid JSON line, 'parse-error' for unparseable lines.
   * Silently drops input after a buffer overflow — caller should destroy the stream.
   */
  feed(chunk: string): void {
    if (this.overflowed) return

    const nextBuffer = this.buffer + chunk
    const nextByteLength = Buffer.byteLength(nextBuffer, 'utf8')

    if (nextByteLength > MAX_BUFFER_BYTES) {
      this.overflowed = true
      this.byteLength = nextByteLength
      log(`buffer overflow at ${this.byteLength} bytes — stream marked corrupt`)
      this.emit('buffer-overflow', this.byteLength)
      return
    }

    this.buffer = nextBuffer
    this.byteLength = nextByteLength
    this.drainLines()
  }

  /**
   * Flush any remaining buffered data. Call when the upstream stream ends.
   * Safe to call multiple times — idempotent after the first flush.
   */
  flush(): void {
    if (this.overflowed) return
    const trimmed = this.buffer.trim()
    if (trimmed) {
      this.parseLine(trimmed)
    }
    this.reset()
  }

  /**
   * Reset internal state. Useful when reusing a parser across reconnections.
   */
  reset(): void {
    this.buffer = ''
    this.byteLength = 0
    this.lineCount = 0
    this.errorCount = 0
    this.overflowed = false
  }

  /**
   * Pipe a Readable through the parser. Returns the parser for chaining.
   * The stream MUST emit strings (set encoding before piping, or use setEncoding).
   * Propagates stream errors as 'parse-error' events so callers have one error surface.
   */
  static fromStream(stream: Readable, encoding: BufferEncoding = 'utf8'): StreamParser {
    const parser = new StreamParser()
    stream.setEncoding(encoding)

    stream.on('data', (chunk: string) => {
      parser.feed(chunk)
    })

    stream.on('end', () => {
      parser.flush()
    })

    stream.on('error', (error: Error) => {
      parser.emit('parse-error', '', `stream error: ${error.message}`)
      parser.reset()
    })

    return parser
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private drainLines(): void {
    let newlineIndex = this.buffer.indexOf('\n')

    while (newlineIndex !== -1) {
      // Slice without including the newline character
      const raw = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)
      this.byteLength = Buffer.byteLength(this.buffer, 'utf8')

      const line = raw.trimEnd()
      if (line.length > 0) {
        const lineBytes = Buffer.byteLength(line, 'utf8')
        if (lineBytes > MAX_LINE_BYTES) {
          log(`line overflow at ${lineBytes} bytes — skipping`)
          this.emit('line-overflow', lineBytes)
        } else {
          this.parseLine(line)
        }
      }

      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  private parseLine(line: string): void {
    this.lineCount += 1

    // Fast-path: NDJSON lines from claude always start with '{'
    // Skip stderr noise, progress bars, and other non-JSON output cheaply
    // without paying for a full JSON.parse attempt
    const firstChar = line.trimStart()[0]
    if (firstChar !== '{' && firstChar !== '[') {
      this.errorCount += 1
      this.emit('parse-error', line, 'non-JSON line (skipped fast-path)')
      return
    }

    try {
      const parsed = JSON.parse(line) as ClaudeEvent
      this.emit('event', parsed)
    } catch (error) {
      this.errorCount += 1
      const reason = error instanceof Error ? error.message : String(error)
      this.emit('parse-error', line, reason)
    }
  }
}
