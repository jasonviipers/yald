import { app } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { log as _log } from '../logger'
import type { CatalogPlugin, SkillMeta } from '../../shared/types'

interface InstalledSkillRecord extends SkillMeta {
  sourcePath?: string
}

interface InstalledSkillDocument {
  meta: SkillMeta
  content: string
}

const SKILL_FILE = 'SKILL.md'
const META_FILE = 'skill.json'

function log(msg: string): void {
  _log('skills', msg)
}

function getSkillsRoot(): string {
  return join(app.getPath('userData'), 'skills')
}

async function ensureSkillsRoot(): Promise<string> {
  const root = getSkillsRoot()
  await mkdir(root, { recursive: true })
  return root
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'skill'
  )
}

async function pathStat(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

async function resolveSkillFile(sourcePath: string): Promise<string> {
  const absolute = resolve(sourcePath)
  const sourceStat = await pathStat(absolute)
  if (!sourceStat) {
    throw new Error('Selected skill path does not exist')
  }

  if (sourceStat.isDirectory()) {
    const nested = join(absolute, SKILL_FILE)
    const nestedStat = await pathStat(nested)
    if (!nestedStat?.isFile()) {
      throw new Error('The selected folder does not contain SKILL.md')
    }
    return nested
  }

  if (!sourceStat.isFile()) {
    throw new Error('The selected skill must be a markdown file or a folder containing SKILL.md')
  }

  return absolute
}

function parseFrontmatter(raw: string): { body: string; name?: string; description?: string } {
  if (!raw.startsWith('---\n')) {
    return { body: raw }
  }

  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) {
    return { body: raw }
  }

  const frontmatter = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const name = frontmatter.match(/^\s*name:\s*(.+)\s*$/m)?.[1]?.trim()
  const description = frontmatter.match(/^\s*description:\s*(.+)\s*$/m)?.[1]?.trim()
  return { body, name, description }
}

function extractTitle(markdown: string, fallback: string): string {
  const heading = markdown.match(/^\s*#\s+(.+)\s*$/m)?.[1]?.trim()
  return heading || fallback
}

function extractDescription(markdown: string): string {
  const firstParagraph = markdown
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .find((part) => part && !part.startsWith('#') && !part.startsWith('```'))
  return (firstParagraph || 'Imported skill').slice(0, 220)
}

async function createSkillId(root: string, baseName: string, content: string): Promise<string> {
  const hash = createHash('sha1').update(content).digest('hex').slice(0, 8)
  let candidate = `${slugify(baseName)}-${hash}`
  let counter = 1

  while (await pathStat(join(root, candidate))) {
    counter += 1
    candidate = `${slugify(baseName)}-${hash}-${counter}`
  }

  return candidate
}

async function readInstalledSkill(dirPath: string): Promise<InstalledSkillDocument | null> {
  try {
    const metaPath = join(dirPath, META_FILE)
    const skillPath = join(dirPath, SKILL_FILE)
    const [metaRaw, content] = await Promise.all([
      readFile(metaPath, 'utf-8'),
      readFile(skillPath, 'utf-8')
    ])

    const meta = JSON.parse(metaRaw) as InstalledSkillRecord
    return {
      meta: {
        id: meta.id,
        name: meta.name,
        description: meta.description,
        installedAt: meta.installedAt,
        marketplacePluginId: meta.marketplacePluginId,
        installName: meta.installName,
        repo: meta.repo,
        sourcePath: meta.sourcePath,
        marketplace: meta.marketplace
      },
      content
    }
  } catch (error) {
    log(`Skipping invalid skill at ${dirPath}: ${(error as Error).message}`)
    return null
  }
}

async function loadInstalledSkillDocuments(): Promise<InstalledSkillDocument[]> {
  const root = await ensureSkillsRoot()
  const entries = await readdir(root, { withFileTypes: true })
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readInstalledSkill(join(root, entry.name)))
  )

  return skills.filter((skill): skill is InstalledSkillDocument => !!skill)
}

function filterInstalledSkillDocuments(
  skills: InstalledSkillDocument[],
  skillIds?: string[]
): InstalledSkillDocument[] {
  if (!Array.isArray(skillIds)) return skills
  const selectedIds = new Set(skillIds.filter(Boolean))
  return skills.filter((skill) => selectedIds.has(skill.meta.id))
}

export async function listInstalledSkills(): Promise<SkillMeta[]> {
  const skills = await loadInstalledSkillDocuments()
  return skills.map((skill) => skill.meta).sort((a, b) => a.name.localeCompare(b.name))
}

export async function listInstalledSkillsById(skillIds?: string[]): Promise<SkillMeta[]> {
  const skills = filterInstalledSkillDocuments(await loadInstalledSkillDocuments(), skillIds)
  return skills.map((skill) => skill.meta).sort((a, b) => a.name.localeCompare(b.name))
}

interface InstallSkillInput {
  raw: string
  sourcePath?: string
  marketplacePlugin?: CatalogPlugin
}

async function writeInstalledSkill({
  raw,
  sourcePath,
  marketplacePlugin
}: InstallSkillInput): Promise<SkillMeta> {
  const root = await ensureSkillsRoot()
  if (!raw.trim()) {
    throw new Error('The selected skill file is empty')
  }

  const { body, name: fmName, description: fmDescription } = parseFrontmatter(raw)
  const fallbackName =
    marketplacePlugin?.installName ||
    sourcePath?.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ||
    'skill'
  const name = extractTitle(body, fmName || fallbackName)
  const description = fmDescription || extractDescription(body)
  const installedAt = Date.now()
  const id = await createSkillId(root, name, raw)
  const targetDir = join(root, id)

  await mkdir(targetDir, { recursive: true })
  await Promise.all([
    writeFile(join(targetDir, SKILL_FILE), raw, 'utf-8'),
    writeFile(
      join(targetDir, META_FILE),
      JSON.stringify(
        {
          id,
          name,
          description,
          installedAt,
          sourcePath,
          marketplacePluginId: marketplacePlugin?.id,
          installName: marketplacePlugin?.installName,
          repo: marketplacePlugin?.repo,
          marketplace: marketplacePlugin?.marketplace
        } satisfies InstalledSkillRecord,
        null,
        2
      ),
      'utf-8'
    )
  ])

  log(`Installed skill ${name}${sourcePath ? ` from ${sourcePath}` : ''}`)
  return {
    id,
    name,
    description,
    installedAt,
    marketplacePluginId: marketplacePlugin?.id,
    installName: marketplacePlugin?.installName,
    repo: marketplacePlugin?.repo,
    sourcePath,
    marketplace: marketplacePlugin?.marketplace
  }
}

export async function installSkill(sourcePath: string): Promise<SkillMeta> {
  const skillFile = await resolveSkillFile(sourcePath)
  const raw = await readFile(skillFile, 'utf-8')
  return writeInstalledSkill({
    raw,
    sourcePath: resolve(sourcePath)
  })
}

export async function installSkillContent(
  content: string,
  options?: {
    sourcePath?: string
    marketplacePlugin?: CatalogPlugin
  }
): Promise<SkillMeta> {
  return writeInstalledSkill({
    raw: content,
    sourcePath: options?.sourcePath,
    marketplacePlugin: options?.marketplacePlugin
  })
}

export async function uninstallSkill(skillId: string): Promise<void> {
  const root = await ensureSkillsRoot()
  const targetDir = resolve(join(root, skillId))
  if (!targetDir.startsWith(resolve(root))) {
    throw new Error('Invalid skill id')
  }

  await rm(targetDir, { recursive: true, force: true })
  log(`Removed skill ${skillId}`)
}

export async function findInstalledSkillByMarketplacePluginId(
  pluginId: string
): Promise<SkillMeta | null> {
  const installedSkills = await listInstalledSkills()
  return installedSkills.find((skill) => skill.marketplacePluginId === pluginId) || null
}

export async function uninstallSkillByMarketplacePluginId(pluginId: string): Promise<boolean> {
  const skill = await findInstalledSkillByMarketplacePluginId(pluginId)
  if (!skill) return false
  await uninstallSkill(skill.id)
  return true
}

export async function buildInstalledSkillsSystemPrompt(
  skillIds?: string[]
): Promise<string | null> {
  const installed = filterInstalledSkillDocuments(await loadInstalledSkillDocuments(), skillIds)
  if (installed.length === 0) return null

  return [
    'You have access to the following installed agent skills.',
    'Use a skill when the user request clearly matches it. Treat each skill as operational guidance.',
    ...installed.map((skill) => `## ${skill.meta.name}\n${skill.content.trim()}`)
  ].join('\n\n')
}
