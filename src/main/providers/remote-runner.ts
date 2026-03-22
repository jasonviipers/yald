import { EventEmitter } from 'events'
import { log as _log } from '../logger'
import { buildInstalledSkillsSystemPrompt, listInstalledSkillsById } from '../skills/store'
import { resolveBackendUrl } from '../../shared/backend-url'
import { executeOllamaTool, getOllamaToolDefinitions, type OllamaToolCall } from './ollama-tools'
import { resolveModelAttachments, resolveProviderForAttachments } from '../attachments'
import type {
  EnrichedError,
  NormalizedEvent,
  ProviderContext,
  PromptHistoryMessage,
  RunOptions
} from '../../shared/types'

const MAX_RING_LINES = 100
const DEFAULT_MAX_TURNS = 8

function log(msg: string): void {
  _log('RemoteRunManager', msg)
}

interface RemoteRunHandle {
  runId: string
  sessionId: string
  provider: ProviderContext
  startedAt: number
  abortController: AbortController
  stdoutTail: string[]
  stderrTail: string[]
  toolCallCount: number
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_name?: string
  tool_calls?: OllamaToolCall[]
}

interface OllamaChatResponse {
  message?: {
    role?: string
    content?: string
    tool_calls?: OllamaToolCall[]
  }
  error?: {
    message?: string
  }
}

function pushRing(buffer: string[], line: string): void {
  buffer.push(line)
  if (buffer.length > MAX_RING_LINES) buffer.shift()
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function buildHistory(options: RunOptions): PromptHistoryMessage[] {
  return Array.isArray(options.history) ? options.history : []
}

async function buildOllamaMessages(options: RunOptions): Promise<OllamaMessage[]> {
  const history = buildHistory(options)
  const messages: OllamaMessage[] = []
  const skillsPrompt = await buildInstalledSkillsSystemPrompt(options.skillIds)
  const attachmentContext = await resolveModelAttachments(options.attachments)
  const userContent = attachmentContext.promptPrefix
    ? `${attachmentContext.promptPrefix}\n\n${options.prompt}`
    : options.prompt

  if (skillsPrompt) {
    messages.push({ role: 'system', content: skillsPrompt })
  }
  messages.push({
    role: 'system',
    content:
      'You are running inside an Ollama agent loop. Use the available tools when they would improve correctness, then finish with a direct answer for the user.'
  })
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  return [
    ...messages,
    ...history.map((message) => ({
      role: message.role,
      content: message.content
    })),
    {
      role: 'user',
      content: userContent,
      images: attachmentContext.images.map((image) => image.base64Data)
    }
  ]
}

function usesCloudHost(provider: ProviderContext): boolean {
  try {
    const url = new URL(resolveBackendUrl(provider.baseUrl))
    return url.hostname === 'ollama.com' || url.hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

async function parseJsonResponse(response: Response): Promise<OllamaChatResponse> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as OllamaChatResponse
  } catch {
    return { error: { message: text } }
  }
}

async function requestOllamaChat(
  provider: ProviderContext,
  messages: OllamaMessage[],
  handle: RemoteRunHandle
): Promise<OllamaChatResponse> {
  const baseUrl = trimSlash(resolveBackendUrl(provider.baseUrl))
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }

  if (usesCloudHost(provider)) {
    if (!provider.apiKey) {
      throw new Error('Ollama Cloud API key is required for ollama.com')
    }
    headers.authorization = `Bearer ${provider.apiKey}`
  } else if (provider.apiKey) {
    headers.authorization = `Bearer ${provider.apiKey}`
  }

  const toolDefinitions = getOllamaToolDefinitions(provider)
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages,
      tools: toolDefinitions,
      stream: false
    }),
    signal: handle.abortController.signal
  })

  const payload = await parseJsonResponse(response)
  pushRing(handle.stdoutTail, JSON.stringify(payload).slice(0, 500))

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        `ollama request failed (${response.status}): ${response.statusText}`
    )
  }

  return payload
}

function splitChunks(text: string): string[] {
  if (text.length <= 600) return [text]
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += 600) {
    chunks.push(text.slice(index, index + 600))
  }
  return chunks
}

function normalizeAssistantContent(payload: OllamaChatResponse): string {
  return payload.message?.content || ''
}

function normalizeToolCalls(payload: OllamaChatResponse): OllamaToolCall[] {
  return Array.isArray(payload.message?.tool_calls) ? payload.message!.tool_calls! : []
}

export class RemoteRunManager extends EventEmitter {
  private activeRuns = new Map<string, RemoteRunHandle>()
  private finishedRuns = new Map<string, RemoteRunHandle>()

  startRun(
    requestId: string,
    options: RunOptions
  ): { runId: string; sessionId: string; pid: null } {
    if (!options.provider) {
      throw new Error('RemoteRunManager requires provider context')
    }

    const sessionId = options.sessionId || crypto.randomUUID()
    const handle: RemoteRunHandle = {
      runId: requestId,
      sessionId,
      provider: options.provider,
      startedAt: Date.now(),
      abortController: new AbortController(),
      stdoutTail: [],
      stderrTail: [],
      toolCallCount: 0
    }

    this.activeRuns.set(requestId, handle)
    void this.execute(handle, options)
    return { runId: requestId, sessionId, pid: null }
  }

  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    handle.abortController.abort()
    return true
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this.finishedRuns.get(requestId)
    return {
      message:
        exitCode === null
          ? 'Remote Ollama request failed'
          : `Remote provider exited with code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: false,
      permissionDenials: []
    }
  }

  private async execute(handle: RemoteRunHandle, options: RunOptions): Promise<void> {
    const { runId, sessionId } = handle
    const provider = resolveProviderForAttachments(handle.provider, options.attachments)
    handle.provider = provider
    const selectedSkills = await listInstalledSkillsById(options.skillIds)
    const toolDefinitions = getOllamaToolDefinitions(provider)

    const initEvent: NormalizedEvent = {
      type: 'session_init',
      sessionId,
      tools: toolDefinitions.map((tool) => tool.function.name),
      model: provider.model,
      providerId: 'ollama',
      transport: 'api',
      mcpServers: [],
      skills: selectedSkills.map((skill) => skill.name),
      version: 'yald ollama'
    }

    this.emit('normalized', runId, initEvent)

    try {
      log(`Starting remote run ${runId} via ollama:${provider.model}`)

      const messages = await buildOllamaMessages(options)
      const maxTurns = Math.max(1, options.maxTurns || DEFAULT_MAX_TURNS)
      let finalText = ''
      let completedTurns = 0

      for (let turn = 0; turn < maxTurns; turn += 1) {
        completedTurns += 1
        const payload = await requestOllamaChat(provider, messages, handle)
        const assistantText = normalizeAssistantContent(payload)
        const toolCalls = normalizeToolCalls(payload)

        messages.push({
          role: 'assistant',
          content: assistantText,
          tool_calls: toolCalls
        })

        if (assistantText) {
          finalText = assistantText
          for (const chunk of splitChunks(assistantText)) {
            this.emit('normalized', runId, { type: 'text_chunk', text: chunk })
          }
        }

        if (toolCalls.length === 0) {
          this.emit('normalized', runId, {
            type: 'task_complete',
            result: finalText,
            costUsd: 0,
            durationMs: Date.now() - handle.startedAt,
            numTurns: completedTurns,
            usage: {},
            sessionId
          })

          this.finish(runId)
          this.emit('exit', runId, 0, null, sessionId)
          return
        }

        for (let index = 0; index < toolCalls.length; index += 1) {
          const toolCall = toolCalls[index]
          const toolName = toolCall.function?.name || 'Tool'
          const toolArgs =
            toolCall.function?.arguments && typeof toolCall.function.arguments === 'object'
              ? toolCall.function.arguments
              : {}
          const toolId = `${runId}:${turn}:${index}`

          handle.toolCallCount += 1
          this.emit('normalized', runId, {
            type: 'tool_call',
            toolName,
            toolId,
            index
          })
          this.emit('normalized', runId, {
            type: 'tool_call_update',
            toolId,
            partialInput: JSON.stringify(toolArgs, null, 2)
          })

          let toolResult = ''
          try {
            toolResult = await executeOllamaTool(toolName, toolArgs, {
              projectPath: options.projectPath,
              addDirs: options.addDirs,
              provider,
              signal: handle.abortController.signal
            })
          } catch (toolError) {
            const message = toolError instanceof Error ? toolError.message : String(toolError)
            pushRing(handle.stderrTail, `${toolName}: ${message}`)
            toolResult = `Tool error: ${message}`
          }

          messages.push({
            role: 'tool',
            tool_name: toolName,
            content: toolResult
          })

          this.emit('normalized', runId, {
            type: 'tool_call_complete',
            index
          })
        }
      }

      throw new Error(`Ollama agent loop reached the turn limit (${maxTurns})`)
    } catch (error) {
      if (handle.abortController.signal.aborted) {
        pushRing(handle.stderrTail, 'Run aborted by user')
        this.finish(runId)
        this.emit('exit', runId, 130, 'SIGINT', sessionId)
        return
      }

      const message = error instanceof Error ? error.message : String(error)
      pushRing(handle.stderrTail, message)
      log(`Remote run ${runId} failed: ${message}`)
      this.finish(runId)
      this.emit('error', runId, error instanceof Error ? error : new Error(message))
    }
  }

  private finish(requestId: string): void {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return
    this.finishedRuns.set(requestId, handle)
    this.activeRuns.delete(requestId)
    setTimeout(() => this.finishedRuns.delete(requestId), 5000)
  }
}
