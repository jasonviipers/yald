import { config } from '../config'
import type { PromptHistoryMessage, ProviderContext } from '../types'

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function usesOllamaCloud(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl)
    return parsed.hostname === 'ollama.com' || parsed.hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

export function getInboundBearerToken(value: string | undefined): string | undefined {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || undefined
}

function resolveOllamaHeaders(inboundApiKey?: string, baseUrl?: string): HeadersInit {
  const resolvedBaseUrl = trimSlash(baseUrl || config.ollama.host)
  const apiKey = config.ollama.apiKey?.trim() || inboundApiKey?.trim()
  if (!apiKey && usesOllamaCloud(resolvedBaseUrl)) {
    throw new Error('Ollama API key is required')
  }

  return apiKey
    ? {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      }
    : {
        'content-type': 'application/json'
      }
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text()
  if (!text) {
    return {}
  }

  try {
    // External JSON can be any shape, so we normalize it to a generic record here.
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return { raw: text }
  }
}

async function requestChat(
  baseUrl: string,
  headers: HeadersInit,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    const nestedError =
      typeof payload.error === 'object' && payload.error && 'message' in payload.error
        ? String(payload.error.message)
        : undefined
    throw new Error(nestedError || String(payload.raw || response.statusText))
  }

  return payload
}

export async function requestOllamaChat(
  body: Record<string, unknown>,
  inboundApiKey?: string
): Promise<Record<string, unknown>> {
  return requestChat(
    config.ollama.host,
    resolveOllamaHeaders(inboundApiKey, config.ollama.host),
    body
  )
}

export async function requestProviderChat(
  provider: ProviderContext,
  body: Record<string, unknown>,
  inboundApiKey?: string
): Promise<Record<string, unknown>> {
  const baseUrl = trimSlash(provider.baseUrl || config.ollama.host)
  return requestChat(baseUrl, resolveOllamaHeaders(provider.apiKey || inboundApiKey, baseUrl), body)
}

export function buildMessages(
  history: PromptHistoryMessage[] | undefined,
  transcript: string
): Array<{ role: string; content: string }> {
  return [...(Array.isArray(history) ? history : []), { role: 'user', content: transcript }]
}

export async function streamOllamaResponse(
  provider: ProviderContext,
  messages: Array<{ role: string; content: string }>,
  onText: (chunk: string) => void
): Promise<void> {
  const baseUrl = trimSlash(provider.baseUrl || config.ollama.host)
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: resolveOllamaHeaders(provider.apiKey, baseUrl),
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true
    })
  })

  if (!response.ok || !response.body) {
    const message = await response.text().catch(() => response.statusText)
    throw new Error(
      `ollama voice request failed (${response.status}): ${message || response.statusText}`
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        // The streaming payload is provider-controlled JSON and not statically typed.
        const payload = JSON.parse(line) as { message?: { content?: unknown } }
        const text = payload.message?.content
        if (typeof text === 'string' && text) {
          onText(text)
        }
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    // The streaming payload is provider-controlled JSON and not statically typed.
    const payload = JSON.parse(trailing) as { message?: { content?: unknown } }
    const text = payload.message?.content
    if (typeof text === 'string' && text) {
      onText(text)
    }
  }
}
