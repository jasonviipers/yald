import { readdir, readFile, stat } from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { ProviderContext } from '../../shared/types'

const MAX_FILE_BYTES = 128 * 1024
const MAX_LINES = 240
const MAX_RESULTS = 80
const WALK_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage'
])

type JsonSchema = Record<string, unknown>

export interface OllamaToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: JsonSchema
  }
}

export interface OllamaToolCall {
  function?: {
    name?: string
    arguments?: Record<string, unknown>
  }
}

export interface OllamaToolContext {
  projectPath: string
  addDirs?: string[]
  provider: ProviderContext
  signal: AbortSignal
}

function uniqueRoots(projectPath: string, addDirs: string[] = []): string[] {
  return Array.from(new Set([resolve(projectPath), ...addDirs.map((dir) => resolve(dir))]))
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function isWithinRoot(candidate: string, roots: string[]): boolean {
  return roots.some((root) => candidate === root || candidate.startsWith(`${root}${sep}`))
}

function resolveToolPath(
  inputPath: string | undefined,
  roots: string[],
  projectPath: string
): string {
  const raw = (inputPath || '.').trim()
  const resolvedPath = isAbsolute(raw) ? resolve(raw) : resolve(projectPath, raw)
  if (!isWithinRoot(resolvedPath, roots)) {
    throw new Error(`Path is outside the allowed workspace roots: ${raw}`)
  }
  return resolvedPath
}

function displayPath(targetPath: string, projectPath: string): string {
  const rel = relative(projectPath, targetPath)
  return rel && !rel.startsWith('..') ? normalizePath(rel) : normalizePath(targetPath)
}

function isLikelyTextFile(path: string, content?: Buffer): boolean {
  const lowered = path.toLowerCase()
  const textExtensions = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.md',
    '.txt',
    '.css',
    '.html',
    '.xml',
    '.yml',
    '.yaml',
    '.toml',
    '.rs',
    '.go',
    '.py',
    '.java',
    '.kt',
    '.swift',
    '.c',
    '.cc',
    '.cpp',
    '.h',
    '.hpp',
    '.sh'
  ]
  if (textExtensions.some((extension) => lowered.endsWith(extension))) return true
  if (!content) return false
  return !content.includes(0)
}

async function walkFiles(
  rootPath: string,
  limit: number,
  results: string[] = []
): Promise<string[]> {
  if (results.length >= limit) return results
  const entries = await readdir(rootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (results.length >= limit) break
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue
      await walkFiles(join(rootPath, entry.name), limit, results)
      continue
    }
    if (entry.isFile()) {
      results.push(join(rootPath, entry.name))
    }
  }
  return results
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function compileGlob(pattern: string): RegExp {
  const normalized = normalizePath(pattern.trim())
  let regex = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const nextChar = normalized[index + 1]
    if (char === '*' && nextChar === '*') {
      regex += '.*'
      index += 1
      continue
    }
    if (char === '*') {
      regex += '[^/]*'
      continue
    }
    if (char === '?') {
      regex += '[^/]'
      continue
    }
    regex += escapeRegExp(char)
  }
  return new RegExp(`${regex}$`)
}

function createSearchRegex(pattern: string, caseSensitive: boolean): RegExp {
  try {
    return new RegExp(pattern, caseSensitive ? 'g' : 'gi')
  } catch {
    return new RegExp(escapeRegExp(pattern), caseSensitive ? 'g' : 'gi')
  }
}

async function readTextFile(targetPath: string): Promise<string> {
  const info = await stat(targetPath)
  if (!info.isFile()) throw new Error('Path is not a file')
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`File is too large to inspect safely (${info.size} bytes)`)
  }

  const buffer = await readFile(targetPath)
  if (!isLikelyTextFile(targetPath, buffer)) {
    throw new Error('File does not look like text')
  }
  return buffer.toString('utf-8')
}

async function callOllamaJson(
  provider: ProviderContext,
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<unknown> {
  const baseUrl = trimSlash(provider.baseUrl || 'https://ollama.com')
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }
  if (provider.apiKey) {
    headers.authorization = `Bearer ${provider.apiKey}`
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })

  const text = await response.text()
  let payload: unknown = {}
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { raw: text }
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload
        ? String((payload as any).error?.message || (payload as any).error || response.statusText)
        : response.statusText
    throw new Error(message)
  }

  return payload
}

export function usesOllamaCloud(provider: ProviderContext): boolean {
  try {
    const url = new URL(provider.baseUrl || 'https://ollama.com')
    return url.hostname === 'ollama.com' || url.hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

export function getOllamaToolDefinitions(provider: ProviderContext): OllamaToolDefinition[] {
  const tools: OllamaToolDefinition[] = [
    {
      type: 'function',
      function: {
        name: 'LS',
        description: 'List files and folders in a workspace directory.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative directory path.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'Read',
        description: 'Read a small text file from the workspace.',
        parameters: {
          type: 'object',
          required: ['file_path'],
          properties: {
            file_path: { type: 'string', description: 'Absolute or relative file path.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'Glob',
        description: 'Find files in the workspace matching a glob pattern.',
        parameters: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Glob pattern such as src/**/*.ts.' },
            path: { type: 'string', description: 'Optional directory to search from.' },
            limit: { type: 'integer', description: 'Maximum number of paths to return.' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'Grep',
        description: 'Search workspace text files for a regex or literal pattern.',
        parameters: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Regex or plain text to search for.' },
            path: { type: 'string', description: 'Optional directory to search from.' },
            limit: { type: 'integer', description: 'Maximum number of matches to return.' },
            case_sensitive: {
              type: 'boolean',
              description: 'Whether matching should be case sensitive.'
            }
          }
        }
      }
    }
  ]

  if (usesOllamaCloud(provider) && provider.apiKey) {
    tools.push(
      {
        type: 'function',
        function: {
          name: 'WebSearch',
          description: 'Search the web using Ollama Cloud.',
          parameters: {
            type: 'object',
            required: ['query'],
            properties: {
              query: { type: 'string', description: 'Search query.' },
              max_results: { type: 'integer', description: 'Maximum number of results to return.' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'WebFetch',
          description: 'Fetch and summarize a web page using Ollama Cloud.',
          parameters: {
            type: 'object',
            required: ['url'],
            properties: {
              url: { type: 'string', description: 'URL to fetch.' }
            }
          }
        }
      }
    )
  }

  return tools
}

export async function executeOllamaTool(
  toolName: string,
  args: Record<string, unknown>,
  context: OllamaToolContext
): Promise<string> {
  const roots = uniqueRoots(context.projectPath, context.addDirs)

  switch (toolName) {
    case 'LS': {
      const targetPath = resolveToolPath(
        typeof args.path === 'string' ? args.path : '.',
        roots,
        context.projectPath
      )
      const info = await stat(targetPath)
      if (!info.isDirectory()) throw new Error('Path is not a directory')
      const entries = await readdir(targetPath, { withFileTypes: true })
      return JSON.stringify(
        entries.slice(0, MAX_RESULTS).map((entry) => ({
          name: entry.isDirectory() ? `${entry.name}/` : entry.name,
          type: entry.isDirectory() ? 'directory' : 'file'
        })),
        null,
        2
      )
    }

    case 'Read': {
      const rawPath =
        typeof args.file_path === 'string'
          ? args.file_path
          : typeof args.path === 'string'
            ? args.path
            : ''
      const targetPath = resolveToolPath(rawPath, roots, context.projectPath)
      const text = await readTextFile(targetPath)
      const lines = text.split(/\r?\n/).slice(0, MAX_LINES)
      const numbered = lines.map((line, index) => `${index + 1}: ${line}`)
      return `${displayPath(targetPath, context.projectPath)}\n${numbered.join('\n')}`
    }

    case 'Glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      if (!pattern.trim()) throw new Error('Glob pattern is required')
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(MAX_RESULTS, Math.trunc(args.limit)))
          : MAX_RESULTS
      const searchRoot = resolveToolPath(
        typeof args.path === 'string' ? args.path : '.',
        roots,
        context.projectPath
      )
      const files = await walkFiles(searchRoot, limit * 6)
      const normalizedPattern = normalizePath(pattern)
      const matcher = compileGlob(normalizedPattern)
      const matches = files.filter((file) => {
        const rel = normalizePath(relative(searchRoot, file))
        if (!normalizedPattern.includes('/')) {
          const basename = rel.split('/').pop() || rel
          return compileGlob(normalizedPattern).test(basename)
        }
        return matcher.test(rel)
      })
      return JSON.stringify(
        matches.slice(0, limit).map((file) => displayPath(file, context.projectPath)),
        null,
        2
      )
    }

    case 'Grep': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : ''
      if (!pattern.trim()) throw new Error('Search pattern is required')
      const limit =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.max(1, Math.min(MAX_RESULTS, Math.trunc(args.limit)))
          : 40
      const caseSensitive = Boolean(args.case_sensitive)
      const searchRoot = resolveToolPath(
        typeof args.path === 'string' ? args.path : '.',
        roots,
        context.projectPath
      )
      const regex = createSearchRegex(pattern, caseSensitive)
      const files = await walkFiles(searchRoot, MAX_RESULTS * 8)
      const matches: string[] = []

      for (const file of files) {
        if (matches.length >= limit) break
        let text = ''
        try {
          text = await readTextFile(file)
        } catch {
          continue
        }
        const lines = text.split(/\r?\n/)
        for (let index = 0; index < lines.length; index += 1) {
          regex.lastIndex = 0
          if (!regex.test(lines[index])) continue
          matches.push(
            `${displayPath(file, context.projectPath)}:${index + 1}: ${lines[index].trim()}`
          )
          if (matches.length >= limit) break
        }
      }

      return matches.length > 0 ? matches.join('\n') : 'No matches found'
    }

    case 'WebSearch': {
      if (!usesOllamaCloud(context.provider) || !context.provider.apiKey) {
        throw new Error('WebSearch is only available with an authenticated Ollama Cloud host')
      }
      const query = typeof args.query === 'string' ? args.query : ''
      if (!query.trim()) throw new Error('Search query is required')
      const payload = await callOllamaJson(
        context.provider,
        '/api/web_search',
        {
          query,
          max_results:
            typeof args.max_results === 'number' && Number.isFinite(args.max_results)
              ? Math.max(1, Math.min(10, Math.trunc(args.max_results)))
              : 5
        },
        context.signal
      )
      return JSON.stringify(payload, null, 2)
    }

    case 'WebFetch': {
      if (!usesOllamaCloud(context.provider) || !context.provider.apiKey) {
        throw new Error('WebFetch is only available with an authenticated Ollama Cloud host')
      }
      const url = typeof args.url === 'string' ? args.url : ''
      if (!url.trim()) throw new Error('URL is required')
      const payload = await callOllamaJson(
        context.provider,
        '/api/web_fetch',
        { url },
        context.signal
      )
      return JSON.stringify(payload, null, 2)
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}
