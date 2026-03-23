import { EventEmitter } from 'events'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { Socket } from 'net'
import { homedir } from 'os'
import { dirname, join, resolve, sep } from 'path'
import { log as _log } from './logger'
import type { SandboxExecResult, SandboxHandle, SandboxOptions } from '../shared/types'

// ─── Internal types ───────────────────────────────────────────────────────────

interface InternalSandbox {
  handle: SandboxHandle
  process: ChildProcessWithoutNullStreams | null
  logs: string[]
  resourceTimer: NodeJS.Timeout | null
  /** Exit code of the most recent fire-and-forget server process, null while still running */
  serverExitCode: number | null
}

interface SandboxExecHooks {
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000
const MEMORY_POLL_INTERVAL_MS = 2_000
const MAX_SANDBOX_LOG_LINES = 800
const MAX_RSS_BYTES = 512 * 1024 * 1024
const PORT_SCAN_TIMEOUT_MS = 60_000 // raised: Vite/Bun can take >30s on first run
const PORT_SCAN_INTERVAL_MS = 400

// Patterns ordered by specificity — most specific first.
// Covers: Vite, Bun serve, Next.js, CRA, http-server, express, Hono, custom apps.
//
// Examples matched:
//   ➜  Local:   http://localhost:5173/
//   Local:  http://localhost:3000
//   Bun v1.x running at http://localhost:3000
//   Server running on http://localhost:8080
//   Listening on http://127.0.0.1:4321/
//   ready - started server on 0.0.0.0:3000, url: http://localhost:3000
//   App listening on port 8787
//   Server started on port 3000
//   localhost:5173
//   port 3000
const PORT_PATTERNS: RegExp[] = [
  // Full URL forms (http/https) — highest confidence
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i,
  // "url: http://..." style (Next.js)
  /url:\s*https?:\/\/[^:]+:(\d{2,5})/i,
  // "on port NNNN" / "on PORT NNNN"
  /on\s+port\s+(\d{2,5})/i,
  // "started on NNNN" / "server on NNNN"
  /(?:started|running|listening)\s+on\s+(?:\S+:)?(\d{2,5})/i,
  // "port: NNNN" / "PORT=NNNN"
  /\bport[=:\s]+(\d{2,5})/i,
  // bare "localhost:NNNN"
  /localhost:(\d{2,5})/i,
  // last-resort: any 4–5 digit number preceded by colon
  /:(\d{4,5})\b/
]

// ─── Utilities ────────────────────────────────────────────────────────────────

function log(message: string): void {
  _log('sandbox', message)
}

function shellCommandForPlatform(command: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', command] }
  }
  return { file: '/bin/sh', args: ['-lc', command] }
}

function createSandboxEnv(workdir: string, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = {}
  const allowlist = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA'
  ]

  for (const key of allowlist) {
    const value = process.env[key]
    if (typeof value === 'string' && value) baseEnv[key] = value
  }

  // Always provide HOME — required by npm, bun, node.
  // On Windows we often only get USERPROFILE from the parent environment.
  if (!baseEnv.HOME) {
    baseEnv.HOME = baseEnv.USERPROFILE || homedir()
  }

  // Point Node module resolution exclusively at the sandbox's own node_modules.
  // Without this, Vite (and other tools) resolve plugins from the host Electron
  // app's node_modules when the sandbox does not have its own copy installed yet,
  // causing "Cannot find module '@vitejs/plugin-react'" and similar errors.
  baseEnv.NODE_PATH = join(workdir, 'node_modules')

  // Prevent npm/bun from hoisting installs into a parent node_modules
  baseEnv.npm_config_prefix = workdir
  baseEnv.BUN_INSTALL = workdir

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      baseEnv[key] = value
    }
  }

  return baseEnv
}

function createSandboxSlug(projectName: string | undefined, id: string): string {
  const normalized = (projectName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const base = normalized || id.slice(0, 8)
  return `${base}-${id.slice(0, 8)}`
}

function pushLogLine(sandbox: InternalSandbox, line: string): void {
  sandbox.logs.push(line)
  if (sandbox.logs.length > MAX_SANDBOX_LOG_LINES) sandbox.logs.shift()
}

/**
 * Resolve a relative path and verify it stays inside the sandbox workdir.
 * Handles both Unix (/) and Windows (\) separators correctly.
 */
function safeSandboxPath(workdir: string, relativePath: string): string {
  const candidate = resolve(workdir, relativePath)
  // Use OS path separator — on Windows sep is '\', on Unix it's '/'
  const prefix = workdir.endsWith(sep) ? workdir : `${workdir}${sep}`
  if (candidate !== workdir && !candidate.startsWith(prefix)) {
    throw new Error(`Sandbox path traversal detected: "${relativePath}" resolves outside workdir`)
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
    const line = buffer.trimEnd()
    if (line) onLine(line)
  })
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Try to connect to a port on a single address. Returns true if the connection
 * succeeds within the timeout, false otherwise.
 */
function tryTcpConnect(port: number, host: string, timeoutMs = 800): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new Socket()
    let settled = false

    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/**
 * Verify a port is accepting connections by trying:
 *   1. TCP connect to 127.0.0.1 (IPv4)
 *   2. TCP connect to ::1        (IPv6 — Vite on Windows binds here by default)
 *   3. HTTP GET to localhost      (fallback for tools that bind to a specific interface)
 *
 * Returns the URL of the first interface that responds, or null if none do.
 */
async function verifyPortOpen(port: number): Promise<{ open: boolean; host: string }> {
  // Try both loopback addresses concurrently
  const [ipv4, ipv6] = await Promise.all([
    tryTcpConnect(port, '127.0.0.1'),
    tryTcpConnect(port, '::1')
  ])

  if (ipv4) return { open: true, host: '127.0.0.1' }
  if (ipv6) return { open: true, host: 'localhost' } // use 'localhost' not '::1' — browser-safe

  // HTTP GET fallback — catches servers that bind to a specific interface
  // and don't respond to raw TCP without an HTTP handshake
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1200)
    const response = await fetch(`http://localhost:${port}/`, {
      signal: controller.signal,
      redirect: 'manual' // 3xx is fine — the server is running
    }).finally(() => clearTimeout(timer))
    // Any HTTP response (including 404, 302) means the server is up
    if (response.status > 0) return { open: true, host: 'localhost' }
  } catch {
    // Connection refused or aborted — server not ready yet
  }

  return { open: false, host: '' }
}

// ─── Port detection ───────────────────────────────────────────────────────────

/**
 * Scan log lines in reverse (most recent first) for a port number.
 * Tries patterns in priority order — stops at the first confident match.
 * Skips ports in reserved ranges (< 1024) and > 65535.
 */
function detectPortFromLogs(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    for (const pattern of PORT_PATTERNS) {
      const match = pattern.exec(line)
      if (!match) continue
      const port = Number(match[1])
      if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
        return port
      }
    }
  }
  return null
}

// ─── SandboxManager ───────────────────────────────────────────────────────────

export class SandboxManager extends EventEmitter {
  private sandboxes = new Map<string, InternalSandbox>()

  async create(projectName?: string): Promise<SandboxHandle> {
    const id = crypto.randomUUID()
    // Use a unique directory per sandbox so destroy() only ever targets
    // the specific workdir for this id, even when projectName normalizes poorly.
    const slug = createSandboxSlug(projectName, id)
    const workdir = join(homedir(), 'yald-projects', slug)
    await mkdir(workdir, { recursive: true })

    const sandbox: InternalSandbox = {
      handle: { id, workdir, status: 'running', port: null, url: null },
      process: null,
      logs: [],
      resourceTimer: null,
      serverExitCode: null
    }

    this.sandboxes.set(id, sandbox)
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
    if (sandbox.handle.status === 'destroyed') throw new Error(`Sandbox ${id} has been destroyed`)

    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const shell = shellCommandForPlatform(command)
    const detached = process.platform !== 'win32'

    const child = spawn(shell.file, shell.args, {
      cwd: sandbox.handle.workdir,
      env: createSandboxEnv(sandbox.handle.workdir, options.env),
      stdio: 'pipe',
      detached
    })
    if (detached) child.unref()

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

    // timeoutMs === 0  →  fire-and-forget (long-running server process).
    // We do NOT set status to 'failed' when the process eventually exits,
    // because a server process is expected to run indefinitely.
    // We DO track the exit code so exposePort can fail fast if the server died.
    if (timeoutMs === 0) {
      sandbox.serverExitCode = null
      child.once('close', (code) => {
        sandbox.process = null
        sandbox.serverExitCode = code
        this.stopResourceMonitor(sandbox)
        if (code !== null && code !== 0) {
          pushLogLine(sandbox, `[process] exited with code ${code}`)
          log(`sandbox ${id} server process exited with code ${code}`)
        }
      })
      child.once('error', (err) => {
        sandbox.process = null
        sandbox.serverExitCode = -1
        this.stopResourceMonitor(sandbox)
        pushLogLine(sandbox, `[process error] ${err.message}`)
        log(`sandbox ${id} server process error: ${err.message}`)
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
        if (isError) rejectPromise(value as Error)
        else resolvePromise(value as SandboxExecResult)
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          pushLogLine(sandbox, `[timeout] command exceeded ${timeoutMs}ms`)
          void this.killChild(child)
          finish(new Error(`Sandbox command timed out after ${timeoutMs}ms`), true)
        }, timeoutMs)
      }

      child.once('error', (error) => {
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

    // Only mark failed for non-server commands that exit non-zero
    if (result.exitCode !== null && result.exitCode !== 0) {
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

  /**
   * Wait for the sandbox process to print a port number and for that port to
   * accept TCP connections. Polls logs every PORT_SCAN_INTERVAL_MS.
   *
   * Fails immediately if the server process exits with a non-zero code instead
   * of polling for the full timeout — this converts a 60-second wait into an
   * instant actionable error (e.g. "Cannot find module '@vitejs/plugin-react'").
   */
  async exposePort(id: string): Promise<{ port: number; url: string }> {
    const sandbox = this.sandboxes.get(id)
    if (!sandbox) throw new Error(`Sandbox ${id} does not exist`)

    const startedAt = Date.now()

    while (Date.now() - startedAt < PORT_SCAN_TIMEOUT_MS) {
      // Fast-fail: server process already died with an error — no point waiting
      if (sandbox.serverExitCode !== null && sandbox.serverExitCode !== 0) {
        const recentLogs = sandbox.logs.slice(-30).join('\n')
        throw new Error(
          `Server process exited with code ${sandbox.serverExitCode} before exposing a port.\n` +
            `Recent output:\n${recentLogs || '(no output)'}`
        )
      }

      const detectedPort = detectPortFromLogs(sandbox.logs)

      if (detectedPort !== null) {
        const { open, host } = await verifyPortOpen(detectedPort)
        if (open) {
          sandbox.handle.port = detectedPort
          // Use the host that actually responded — on Windows Vite binds to ::1
          // so we use 'localhost' which resolves correctly for both IPv4 and IPv6
          sandbox.handle.url = `http://${host}:${detectedPort}`
          pushLogLine(sandbox, `[port] confirmed ${sandbox.handle.url}`)
          log(`sandbox ${id} port confirmed: ${detectedPort} via ${host}`)
          this.emit('port-detected', id, sandbox.handle.url)
          return { port: detectedPort, url: sandbox.handle.url }
        }
        // Port detected in logs but not yet accepting connections — keep polling
      }

      await wait(PORT_SCAN_INTERVAL_MS)
    }

    // Include recent log tail in the error to make diagnosis possible
    const recentLogs = sandbox.logs.slice(-30).join('\n')
    throw new Error(
      `Sandbox ${id} did not expose a reachable port within ${PORT_SCAN_TIMEOUT_MS}ms.\n` +
        `Recent output:\n${recentLogs || '(no output)'}`
    )
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

    // Kill the server process and wait for OS to release all file handles.
    // On Windows, native binaries (.exe, .node) inside node_modules stay locked
    // until the process that loaded them fully exits. We need a longer wait here.
    if (sandbox.process) {
      await this.killChild(sandbox.process)
      sandbox.process = null
      // Give Windows time to release all file handles after the process exits.
      // Without this, esbuild.exe and rollup.win32-x64-msvc.node stay locked.
      if (process.platform === 'win32') await wait(1500)
    }

    sandbox.handle.status = 'destroyed'
    this.sandboxes.delete(id)

    // Delete the project files but intentionally KEEP node_modules on Windows.
    // Native binaries (.exe, .node) inside node_modules are locked by the OS
    // even after the child process exits, so deletion fails with EPERM/EBUSY.
    // The node_modules are in a permanent yald-projects directory — they will
    // be reused on the next run (install becomes a fast no-op) and the user
    // can remove them manually when done.
    try {
      if (process.platform === 'win32') {
        await this.deleteExceptNodeModules(sandbox.handle.workdir)
      } else {
        await rm(sandbox.handle.workdir, { recursive: true, force: true })
      }
    } catch (error) {
      // Non-fatal — project stays on disk, which is desirable anyway
      log(
        `sandbox ${id} cleanup partial: ${error instanceof Error ? error.message : String(error)}`
      )
    }

    log(`destroyed sandbox ${id}`)
  }

  /**
   * Delete all files in a directory EXCEPT node_modules.
   * Used on Windows where native binaries in node_modules stay locked
   * after the child process exits.
   */
  private async deleteExceptNodeModules(dir: string): Promise<void> {
    const { readdir } = await import('fs/promises')
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    await Promise.allSettled(
      entries
        .filter((name) => name !== 'node_modules')
        .map((name) => rm(join(dir, name), { recursive: true, force: true }))
    )
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private startResourceMonitor(sandbox: InternalSandbox): void {
    this.stopResourceMonitor(sandbox)
    sandbox.resourceTimer = setInterval(() => {
      const rss = process.memoryUsage().rss
      if (rss > MAX_RSS_BYTES) {
        pushLogLine(sandbox, `[resource] rss ${rss} exceeded limit — destroying sandbox`)
        log(`sandbox ${sandbox.handle.id} rss limit exceeded (${rss} bytes)`)
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

    if (process.platform === 'win32') {
      // On Windows, SIGTERM is a no-op for most Node/Bun processes.
      // Use taskkill /F /T to forcefully kill the entire process tree,
      // including child processes Vite spawns (esbuild, etc.).
      try {
        const { execSync } = await import('child_process')
        execSync(`taskkill /PID ${child.pid} /F /T`, { stdio: 'ignore' })
      } catch {
        // Process may have already exited — ignore
      }
      // Wait for the close event to confirm the process is gone
      await Promise.race([new Promise<void>((resolve) => child.once('close', resolve)), wait(3000)])
    } else {
      const pid = child.pid
      if (typeof pid !== 'number') return
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // Process group may already be gone.
      }
      await Promise.race([new Promise<void>((resolve) => child.once('close', resolve)), wait(2000)])
      if (!child.killed && child.exitCode === null) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          // Process group may already be gone.
        }
      }
    }
  }
}
