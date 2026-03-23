import { EventEmitter } from 'events'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { Socket } from 'net'
import { homedir, tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { log as _log } from './logger'
import type { SandboxExecResult, SandboxHandle, SandboxOptions } from '../shared/types'

interface InternalSandbox {
  handle: SandboxHandle
  process: ChildProcessWithoutNullStreams | null
  logs: string[]
  resourceTimer: NodeJS.Timeout | null
}

interface SandboxExecHooks {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

const DEFAULT_TIMEOUT_MS = 30000
const MEMORY_POLL_INTERVAL_MS = 2000
const MAX_SANDBOX_LOG_LINES = 600
const MAX_RSS_BYTES = 512 * 1024 * 1024
const PORT_SCAN_TIMEOUT_MS = 30000
const PORT_SCAN_INTERVAL_MS = 500
const PORT_PATTERNS = [
  /http:\/\/localhost:(\d{2,5})/i,
  /localhost:(\d{2,5})/i,
  /\bport\s+(\d{2,5})\b/i
]

function log(message: string): void {
  _log('sandbox', message)
}

function shellCommandForPlatform(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', command]
    }
  }

  return {
    file: '/bin/sh',
    args: ['-lc', command]
  }
}

function createSandboxEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = {}
  const allowlist = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP']

  for (const key of allowlist) {
    const value = process.env[key]
    if (typeof value === 'string' && value) {
      baseEnv[key] = value
    }
  }

  if (!baseEnv.HOME) {
    baseEnv.HOME = homedir()
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      baseEnv[key] = value
    }
  }

  return baseEnv
}

function pushLogLine(sandbox: InternalSandbox, line: string): void {
  sandbox.logs.push(line)
  if (sandbox.logs.length > MAX_SANDBOX_LOG_LINES) {
    sandbox.logs.shift()
  }
}

function safeSandboxPath(workdir: string, relativePath: string): string {
  const candidate = resolve(workdir, relativePath)
  if (
    candidate !== workdir &&
    !candidate.startsWith(`${workdir}\\`) &&
    !candidate.startsWith(`${workdir}/`)
  ) {
    throw new Error('Sandbox path must stay inside the sandbox workdir')
  }
  return candidate
}

function bufferStreamByLine(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buffer += chunk
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      onLine(line)
      newlineIndex = buffer.indexOf('\n')
    }
  })
  stream.on('end', () => {
    const line = buffer.trim()
    if (line) {
      onLine(line)
    }
  })
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function verifyPortOpen(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = new Socket()
    let settled = false

    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolvePromise(result)
    }

    socket.setTimeout(1000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, '127.0.0.1')
  })
}

export class SandboxManager extends EventEmitter {
  private sandboxes = new Map<string, InternalSandbox>()

  async create(): Promise<SandboxHandle> {
    const id = crypto.randomUUID()
    const workdir = join(tmpdir(), 'yald-sandbox', id)
    await mkdir(workdir, { recursive: true })

    const sandbox: InternalSandbox = {
      handle: {
        id,
        workdir,
        status: 'provisioning',
        port: null,
        url: null
      },
      process: null,
      logs: [],
      resourceTimer: null
    }

    this.sandboxes.set(id, sandbox)
    sandbox.handle.status = 'running'
    pushLogLine(sandbox, `[sandbox] created ${workdir}`)
    log(`created sandbox ${id} at ${workdir}`)
    return { ...sandbox.handle }
  }

  getHandle(id: string): SandboxHandle | null {
    const sandbox = this.sandboxes.get(id)
    return sandbox ? { ...sandbox.handle } : null
  }

  async exec(
    id: string,
    command: string,
    options: SandboxOptions = {},
    hooks: SandboxExecHooks = {}
  ): Promise<SandboxExecResult> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)
    if (sandbox.handle.status === 'destroyed') {
      throw new Error(`Sandbox ${id} has been destroyed`)
    }

    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const shell = shellCommandForPlatform(command)
    const child = spawn(shell.file, shell.args, {
      cwd: sandbox.handle.workdir,
      env: createSandboxEnv(options.env),
      stdio: 'pipe'
    })

    sandbox.process = child
    pushLogLine(sandbox, `$ ${command}`)
    this.startResourceMonitor(sandbox)

    let stdout = ''
    let stderr = ''

    bufferStreamByLine(child.stdout, (line) => {
      stdout += `${line}\n`
      pushLogLine(sandbox, `[stdout] ${line}`)
      hooks.onStdoutLine?.(line)
    })

    bufferStreamByLine(child.stderr, (line) => {
      stderr += `${line}\n`
      pushLogLine(sandbox, `[stderr] ${line}`)
      hooks.onStderrLine?.(line)
    })

    if (timeoutMs === 0) {
      sandbox.handle.status = 'running'
      child.once('close', () => {
        sandbox.process = null
        this.stopResourceMonitor(sandbox)
      })
      return {
        exitCode: null,
        stdout: '',
        stderr: '',
        durationMs: Date.now() - startedAt
      }
    }

    const result = await new Promise<SandboxExecResult>((resolvePromise, rejectPromise) => {
      let finished = false
      let timer: NodeJS.Timeout | null = null

      const finish = (value: SandboxExecResult | Error, isError: boolean): void => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        sandbox.process = null
        this.stopResourceMonitor(sandbox)
        if (isError) {
          rejectPromise(value as Error)
        } else {
          resolvePromise(value as SandboxExecResult)
        }
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pushLogLine(sandbox, `[timeout] command exceeded ${timeoutMs}ms`)
          this.killChild(child)
          finish(new Error(`Sandbox command timed out after ${timeoutMs}ms`), true)
        }, timeoutMs)
      }

      child.once('error', (error) => {
        sandbox.handle.status = 'failed'
        pushLogLine(sandbox, `[error] ${error.message}`)
        finish(error, true)
      })

      child.once('close', (code) => {
        finish(
          {
            exitCode: code,
            stdout: stdout.trimEnd(),
            stderr: stderr.trimEnd(),
            durationMs: Date.now() - startedAt
          },
          false
        )
      })
    })

    if (result.exitCode !== 0) {
      sandbox.handle.status = 'failed'
    }

    return result
  }

  async writeFile(id: string, relativePath: string, content: string): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)

    const targetPath = safeSandboxPath(sandbox.handle.workdir, relativePath)
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
    pushLogLine(sandbox, `[write] ${relativePath}`)
  }

  async readFile(id: string, relativePath: string): Promise<string> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)

    const targetPath = safeSandboxPath(sandbox.handle.workdir, relativePath)
    return readFile(targetPath, 'utf8')
  }

  async exposePort(id: string): Promise<{ port: number; url: string }> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)

    const startedAt = Date.now()
    while (Date.now() - startedAt < PORT_SCAN_TIMEOUT_MS) {
      const detectedPort = this.detectPortFromLogs(sandbox.logs)
      if (detectedPort && (await verifyPortOpen(detectedPort))) {
        sandbox.handle.port = detectedPort
        sandbox.handle.url = `http://127.0.0.1:${detectedPort}`
        pushLogLine(sandbox, `[port] confirmed ${sandbox.handle.url}`)
        return { port: detectedPort, url: sandbox.handle.url }
      }
      await wait(PORT_SCAN_INTERVAL_MS)
    }

    throw new Error(`Sandbox ${id} did not expose a reachable port within 30000ms`)
  }

  getLogs(id: string): string {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)
    return sandbox.logs.join('\n')
  }

  async destroy(id: string): Promise<void> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) return

    this.stopResourceMonitor(sandbox)
    if (sandbox.process) {
      await this.killChild(sandbox.process)
      sandbox.process = null
    }

    sandbox.handle.status = 'destroyed'
    await rm(sandbox.handle.workdir, { recursive: true, force: true })
    this.sandboxes.delete(id)
    log(`destroyed sandbox ${id}`)
  }

  private detectPortFromLogs(lines: string[]): number | null {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]
      for (const pattern of PORT_PATTERNS) {
        const match = pattern.exec(line)
        if (!match) continue
        const value = Number(match[1])
        if (Number.isInteger(value) && value > 0 && value < 65536) {
          return value
        }
      }
    }
    return null
  }

  private startResourceMonitor(sandbox: InternalSandbox): void {
    this.stopResourceMonitor(sandbox)
    sandbox.resourceTimer = setInterval(() => {
      const rss = process.memoryUsage().rss
      pushLogLine(sandbox, `[resource] rss=${rss}`)
      if (rss > MAX_RSS_BYTES) {
        pushLogLine(sandbox, `[resource] rss limit exceeded, destroying sandbox`)
        void this.destroy(sandbox.handle.id)
      }
    }, MEMORY_POLL_INTERVAL_MS)
    sandbox.resourceTimer.unref()
  }

  private stopResourceMonitor(sandbox: InternalSandbox): void {
    if (!sandbox.resourceTimer) return
    clearInterval(sandbox.resourceTimer)
    sandbox.resourceTimer = null
  }

  private async killChild(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.killed || child.exitCode !== null) return

    child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolvePromise) => child.once('close', () => resolvePromise())),
      wait(2000)
    ])

    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL')
    } else if (child.exitCode === null) {
      child.kill('SIGKILL')
    }
  }
}
