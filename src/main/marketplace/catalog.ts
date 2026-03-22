import { basename } from 'path'
import { log as _log } from '../logger'
import {
  findInstalledSkillByMarketplacePluginId,
  installSkillContent,
  uninstallSkillByMarketplacePluginId
} from '../skills/store'
import type { CatalogPlugin, SkillMeta } from '../../shared/types'

interface MarketplaceSource {
  marketplace: string
  repo: string
  rootPath: string
  author: string
  category: string
  ref: string
}

interface GitHubTreeEntry {
  path: string
  type: 'blob' | 'tree'
}

interface GitHubTreeResponse {
  tree?: GitHubTreeEntry[]
}

const CACHE_TTL_MS = 15 * 60 * 1000
const MARKETPLACE_SOURCES: MarketplaceSource[] = [
  {
    marketplace: 'Anthropic',
    repo: 'anthropics/skills',
    rootPath: 'skills',
    author: 'Anthropic',
    category: 'Agent Skills',
    ref: 'main'
  }
]

const TAG_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with'
])

let cachedCatalog: { expiresAt: number; plugins: CatalogPlugin[] } | null = null

function log(message: string): void {
  _log('marketplace', message)
}

function slugToTitle(value: string): string {
  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function extractFrontmatter(markdown: string): {
  body: string
  description?: string
  tags: string[]
} {
  if (!markdown.startsWith('---\n')) {
    return { body: markdown, tags: [] }
  }

  const end = markdown.indexOf('\n---\n', 4)
  if (end === -1) {
    return { body: markdown, tags: [] }
  }

  const frontmatter = markdown.slice(4, end)
  const body = markdown.slice(end + 5)
  const description = frontmatter.match(/^\s*description:\s*(.+)\s*$/m)?.[1]?.trim()
  const tagsLine = frontmatter.match(/^\s*tags:\s*\[(.+)\]\s*$/m)?.[1]
  const tags = tagsLine
    ? tagsLine
        .split(',')
        .map((tag) => tag.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : []

  return { body, description, tags }
}

function extractSkillName(markdown: string, fallback: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)\s*$/m)?.[1]?.trim()
  return heading || fallback
}

function extractSkillDescription(markdown: string, fallback?: string): string {
  if (fallback) return fallback.slice(0, 220)

  const paragraph = markdown
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#') && !part.startsWith('```'))

  return (paragraph || 'Imported skill').slice(0, 220)
}

function deriveTags(name: string, description: string, frontmatterTags: string[]): string[] {
  const tags = new Set<string>()

  for (const tag of frontmatterTags) {
    tags.add(tag)
  }

  const source = `${name} ${description}`.toLowerCase()
  const keywordTags: Array<{ pattern: RegExp; tag: string }> = [
    { pattern: /\b(api|http|rest|graphql|endpoint)\b/, tag: 'APIs' },
    { pattern: /\b(code|program|typescript|javascript|python|rust|sql)\b/, tag: 'Code' },
    { pattern: /\b(design|ui|ux|figma|brand)\b/, tag: 'Design' },
    { pattern: /\b(docs|documentation|writing|content|copy)\b/, tag: 'Writing' },
    { pattern: /\b(finance|invoice|budget|accounting)\b/, tag: 'Finance' },
    { pattern: /\b(research|analyze|analysis|compare)\b/, tag: 'Research' },
    { pattern: /\b(spreadsheet|excel|csv|sheet)\b/, tag: 'Data' }
  ]

  for (const { pattern, tag } of keywordTags) {
    if (pattern.test(source)) {
      tags.add(tag)
    }
  }

  if (tags.size === 0) {
    for (const token of name.split(/\s+/)) {
      const normalized = token.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!normalized || TAG_STOP_WORDS.has(normalized)) continue
      tags.add(token.replace(/[^a-zA-Z0-9]/g, ''))
      if (tags.size >= 3) break
    }
  }

  return [...tags].filter(Boolean).slice(0, 6)
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'yald-marketplace'
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub request failed (${response.status}): ${body || response.statusText}`)
  }

  return response.text()
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url)
  return JSON.parse(text) as T
}

function buildRawSkillUrl(source: MarketplaceSource, sourcePath: string): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.ref}/${sourcePath}/SKILL.md`
}

async function fetchSourceCatalog(source: MarketplaceSource): Promise<CatalogPlugin[]> {
  const treeUrl = `https://api.github.com/repos/${source.repo}/git/trees/${source.ref}?recursive=1`
  const tree = await fetchJson<GitHubTreeResponse>(treeUrl)
  const skillFiles =
    tree.tree?.filter(
      (entry) =>
        entry.type === 'blob' &&
        entry.path.startsWith(`${source.rootPath}/`) &&
        entry.path.endsWith('/SKILL.md')
    ) || []

  const plugins = await Promise.all(
    skillFiles.map(async (entry) => {
      const sourcePath = entry.path.slice(0, -'/SKILL.md'.length)
      const fallbackInstallName = basename(sourcePath)
      const raw = await fetchText(buildRawSkillUrl(source, sourcePath))
      const parsed = extractFrontmatter(raw)
      const name = extractSkillName(parsed.body, slugToTitle(fallbackInstallName))
      const description = extractSkillDescription(parsed.body, parsed.description)

      return {
        id: `${source.repo}/${sourcePath}`,
        name,
        description,
        version: '0.0.0',
        author: source.author,
        marketplace: source.marketplace,
        repo: source.repo,
        sourcePath,
        installName: fallbackInstallName,
        category: source.category,
        tags: deriveTags(name, description, parsed.tags),
        isSkillMd: true
      } satisfies CatalogPlugin
    })
  )

  return plugins.sort((left, right) => left.name.localeCompare(right.name))
}

export async function fetchMarketplaceCatalog(forceRefresh = false): Promise<CatalogPlugin[]> {
  if (!forceRefresh && cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return cachedCatalog.plugins
  }

  const plugins = (await Promise.all(MARKETPLACE_SOURCES.map(fetchSourceCatalog))).flat()
  cachedCatalog = {
    plugins,
    expiresAt: Date.now() + CACHE_TTL_MS
  }
  log(`Loaded ${plugins.length} marketplace skills`)
  return plugins
}

export async function installMarketplaceSkill(plugin: CatalogPlugin): Promise<SkillMeta> {
  if (!plugin.isSkillMd) {
    throw new Error('Only SKILL.md marketplace entries are supported in Ollama mode')
  }

  const existing = await findInstalledSkillByMarketplacePluginId(plugin.id)
  if (existing) return existing

  const source = MARKETPLACE_SOURCES.find(
    (marketplaceSource) =>
      marketplaceSource.repo === plugin.repo && marketplaceSource.marketplace === plugin.marketplace
  )
  if (!source) {
    throw new Error(`Unknown marketplace source for ${plugin.name}`)
  }

  const raw = await fetchText(buildRawSkillUrl(source, plugin.sourcePath))
  return installSkillContent(raw, {
    sourcePath: `https://github.com/${plugin.repo}/tree/${source.ref}/${plugin.sourcePath}`,
    marketplacePlugin: plugin
  })
}

export async function uninstallMarketplaceSkill(pluginId: string): Promise<void> {
  const removed = await uninstallSkillByMarketplacePluginId(pluginId)
  if (!removed) {
    throw new Error('Marketplace skill is not installed')
  }
}
