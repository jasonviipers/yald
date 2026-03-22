import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  dialog,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  systemPreferences
} from 'electron'
import { join } from 'path'
import { ControlPlane } from './claude/control-plane'
import { log as _log, LOG_FILE, flushLogs } from './logger'
import {
  fetchMarketplaceCatalog,
  installMarketplaceSkill,
  uninstallMarketplaceSkill
} from './marketplace/catalog'
import { installSkill, listInstalledSkills, uninstallSkill } from './skills/store'
import { VisionAgentManager } from './vision/vision-agent-manager'
import { transcribeAudioBase64 } from './voice/transcription'
import { VoiceSessionManager } from './voice/voice-session-manager'
import { IPC } from '../shared/types'
import type {
  CatalogPlugin,
  EnrichedError,
  NormalizedEvent,
  RunOptions,
  SessionMeta,
  ShortcutCommand,
  VisionEvent,
  VisionStartRequest,
  VoiceEvent,
  VoiceTurnRequest
} from '../shared/types'

const DEBUG_MODE = process.env.yald_DEBUG === '1'
const SPACES_DEBUG = DEBUG_MODE || process.env.yald_SPACES_DEBUG === '1'

function log(msg: string): void {
  _log('main', msg)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let screenshotCounter = 0
let toggleSequence = 0

const INTERACTIVE_PTY = false

const controlPlane = new ControlPlane(INTERACTIVE_PTY)
const voiceSessionManager = new VoiceSessionManager()
const visionAgentManager = new VisionAgentManager(captureWindowScreenshotBase64, {
  createTab: () => broadcastShortcutCommand('new_tab'),
  toggleSettings: () => broadcastShortcutCommand('toggle_settings'),
  toggleVoice: () => broadcastShortcutCommand('toggle_voice'),
  hideWindow: () => mainWindow?.hide(),
  moveLeft: () => moveWindowToSector('left'),
  moveRight: () => moveWindowToSector('right'),
  moveUp: () => moveWindowToSector('up'),
  moveDown: () => moveWindowToSector('down')
})

// Keep native width fixed to avoid renderer animation vs setBounds race.
// The UI itself still launches in compact mode; extra width is transparent/click-through.
const BAR_WIDTH = 1040
const PILL_HEIGHT = 720 // Fixed native window height — extra room for expanded UI + shadow buffers
const PILL_BOTTOM_MARGIN = 24

// ─── Broadcast to renderer ───

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function broadcastShortcutCommand(command: ShortcutCommand): void {
  broadcast(IPC.SHORTCUT_COMMAND, command)
}

async function captureWindowScreenshotBase64(): Promise<string> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Main window is not available')
  }

  const image = await mainWindow.webContents.capturePage()
  const png = image.toPNG()
  return png.toString('base64')
}

function snapshotWindowState(reason: string): void {
  if (!SPACES_DEBUG) return
  if (!mainWindow || mainWindow.isDestroyed()) {
    log(`[spaces] ${reason} window=none`)
    return
  }

  const b = mainWindow.getBounds()
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const visibleOnAll = mainWindow.isVisibleOnAllWorkspaces()
  const wcFocused = mainWindow.webContents.isFocused()

  log(
    `[spaces] ${reason} ` +
      `vis=${mainWindow.isVisible()} focused=${mainWindow.isFocused()} wcFocused=${wcFocused} ` +
      `alwaysOnTop=${mainWindow.isAlwaysOnTop()} allWs=${visibleOnAll} ` +
      `bounds=(${b.x},${b.y},${b.width}x${b.height}) ` +
      `cursor=(${cursor.x},${cursor.y}) display=${display.id} ` +
      `workArea=(${display.workArea.x},${display.workArea.y},${display.workArea.width}x${display.workArea.height})`
  )
}

function scheduleToggleSnapshots(toggleId: number, phase: 'show' | 'hide'): void {
  if (!SPACES_DEBUG) return
  const probes = [0, 100, 400, 1200]
  for (const delay of probes) {
    setTimeout(() => {
      snapshotWindowState(`toggle#${toggleId} ${phase} +${delay}ms`)
    }, delay)
  }
}

// ─── Wire ControlPlane events → renderer ───

controlPlane.on('event', (tabId: string, event: NormalizedEvent) => {
  broadcast('yald:normalized-event', tabId, event)
})

controlPlane.on('tab-status-change', (tabId: string, newStatus: string, oldStatus: string) => {
  broadcast('yald:tab-status-change', tabId, newStatus, oldStatus)
})

controlPlane.on('error', (tabId: string, error: EnrichedError) => {
  broadcast('yald:enriched-error', tabId, error)
})

voiceSessionManager.on('event', (event: VoiceEvent) => {
  broadcast(IPC.VOICE_EVENT, event)
})

visionAgentManager.on('event', (event: VisionEvent) => {
  broadcast(IPC.VISION_EVENT, event)
})

// ─── Window Creation ───

function createWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: screenWidth, height: screenHeight } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea

  const x = dx + Math.round((screenWidth - BAR_WIDTH) / 2)
  const y = dy + screenHeight - PILL_HEIGHT - PILL_BOTTOM_MARGIN

  mainWindow = new BrowserWindow({
    width: BAR_WIDTH,
    height: PILL_HEIGHT,
    x,
    y,
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}), // NSPanel — non-activating, joins all spaces
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: true,
    backgroundColor: '#00000000',
    show: false,
    icon: join(__dirname, '../../resources/icon.icns'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Belt-and-suspenders: panel already joins all spaces and floats,
  // but explicit flags ensure correct behavior on older Electron builds.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    // Enable OS-level click-through for transparent regions.
    // { forward: true } ensures mousemove events still reach the renderer
    // so it can toggle click-through off when cursor enters interactive UI.
    mainWindow?.setIgnoreMouseEvents(true, { forward: true })
    if (process.env.ELECTRON_RENDERER_URL) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  let forceQuit = false
  app.on('before-quit', () => {
    forceQuit = true
  })
  mainWindow.on('close', (e) => {
    if (!forceQuit) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.on('before-input-event', handleFocusedWindowShortcut)
}

function showWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence

  // Position on the display where the cursor currently is (not always primary)
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const { width: sw, height: sh } = display.workAreaSize
  const { x: dx, y: dy } = display.workArea
  mainWindow.setBounds({
    x: dx + Math.round((sw - BAR_WIDTH) / 2),
    y: dy + sh - PILL_HEIGHT - PILL_BOTTOM_MARGIN,
    width: BAR_WIDTH,
    height: PILL_HEIGHT
  })

  // Always re-assert space membership — the flag can be lost after hide/show cycles
  // and must be set before show() so the window joins the active Space, not its
  // last-known Space.
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (SPACES_DEBUG) {
    log(`[spaces] showWindow#${toggleId} source=${source} move-to-display id=${display.id}`)
    snapshotWindowState(`showWindow#${toggleId} pre-show`)
  }
  // As an accessory app (app.dock.hide), show() + focus gives keyboard
  // without deactivating the active app — hover preserved everywhere.
  mainWindow.show()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
  if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'show')
}

function toggleWindow(source = 'unknown'): void {
  if (!mainWindow) return
  const toggleId = ++toggleSequence
  if (SPACES_DEBUG) {
    log(`[spaces] toggle#${toggleId} source=${source} start`)
    snapshotWindowState(`toggle#${toggleId} pre`)
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide()
    if (SPACES_DEBUG) scheduleToggleSnapshots(toggleId, 'hide')
  } else {
    showWindow(source)
  }
}

// ─── Resize ───
// Fixed-height mode: ignore renderer resize events to prevent jank.
// The native window stays at PILL_HEIGHT; all expand/collapse happens inside the renderer.

type WindowSector = 'left' | 'right' | 'up' | 'down'

function moveWindowToSector(sector: WindowSector): void {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const margin = 24
  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const width = Math.min(BAR_WIDTH, display.workArea.width)
  const height = Math.min(PILL_HEIGHT, display.workArea.height)
  const centeredX = display.workArea.x + Math.round((display.workArea.width - width) / 2)
  const bottomY = display.workArea.y + display.workArea.height - height - margin

  let x = centeredX
  let y = bottomY

  switch (sector) {
    case 'left':
      x = display.workArea.x + margin
      break
    case 'right':
      x = display.workArea.x + display.workArea.width - width - margin
      break
    case 'up':
      y = display.workArea.y + margin
      break
    case 'down':
      y = bottomY
      break
  }

  mainWindow.setBounds({ x, y, width, height })
  mainWindow.show()
  mainWindow.webContents.focus()
  broadcast(IPC.WINDOW_SHOWN)
}

function handleFocusedWindowShortcut(event: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown') return

  const commandPressed = input.control || input.meta
  if (!commandPressed || input.alt) return

  const key = input.key
  const loweredKey = key.toLowerCase()

  if (!input.shift && loweredKey === 't') {
    event.preventDefault()
    broadcastShortcutCommand('new_tab')
    return
  }

  if (!input.shift && key === ',') {
    event.preventDefault()
    broadcastShortcutCommand('toggle_settings')
    return
  }

  if (input.shift && loweredKey === 'v') {
    event.preventDefault()
    broadcastShortcutCommand('toggle_voice')
    return
  }

  if (key === 'ArrowLeft') {
    event.preventDefault()
    moveWindowToSector('left')
    return
  }

  if (key === 'ArrowRight') {
    event.preventDefault()
    moveWindowToSector('right')
    return
  }

  if (key === 'ArrowUp') {
    event.preventDefault()
    moveWindowToSector('up')
    return
  }

  if (key === 'ArrowDown') {
    event.preventDefault()
    moveWindowToSector('down')
  }
}

ipcMain.on(IPC.RESIZE_HEIGHT, () => {
  // No-op — fixed height window, no dynamic resize
})

ipcMain.on(IPC.SET_WINDOW_WIDTH, () => {
  // No-op — native width is fixed to keep expand/collapse animation smooth.
})

ipcMain.handle(IPC.ANIMATE_HEIGHT, () => {
  // No-op — kept for API compat, animation handled purely in renderer
})

ipcMain.on(IPC.HIDE_WINDOW, () => {
  mainWindow?.hide()
})

ipcMain.handle(IPC.IS_VISIBLE, () => {
  return mainWindow?.isVisible() ?? false
})

// OS-level click-through toggle — renderer calls this on mousemove
// to enable clicks on interactive UI while passing through transparent areas
ipcMain.on(
  IPC.SET_IGNORE_MOUSE_EVENTS,
  (event, ignore: boolean, options?: { forward?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, options || {})
    }
  }
)

// ─── IPC Handlers (typed, strict) ───

ipcMain.handle(IPC.START, async () => {
  log('IPC START — fetching static app info')

  return {
    version: app.getVersion(),
    auth: { authMethod: 'ollama' },
    mcpServers: [],
    projectPath: process.cwd(),
    homePath: require('os').homedir()
  }
})

ipcMain.handle(IPC.CREATE_TAB, () => {
  const tabId = controlPlane.createTab()
  log(`IPC CREATE_TAB → ${tabId}`)
  return { tabId }
})

ipcMain.handle(
  IPC.PROMPT,
  async (
    _event,
    { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }
  ) => {
    if (DEBUG_MODE) {
      log(`IPC PROMPT: tab=${tabId} req=${requestId} prompt="${options.prompt.substring(0, 100)}"`)
    } else {
      log(`IPC PROMPT: tab=${tabId} req=${requestId}`)
    }

    if (!tabId) {
      throw new Error('No tabId provided — prompt rejected')
    }
    if (!requestId) {
      throw new Error('No requestId provided — prompt rejected')
    }

    try {
      await controlPlane.submitPrompt(tabId, requestId, options)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`PROMPT error: ${msg}`)
      throw err
    }
  }
)

ipcMain.handle(IPC.CANCEL, (_event, requestId: string) => {
  log(`IPC CANCEL: ${requestId}`)
  return controlPlane.cancel(requestId)
})

ipcMain.handle(IPC.STOP_TAB, (_event, tabId: string) => {
  log(`IPC STOP_TAB: ${tabId}`)
  return controlPlane.cancelTab(tabId)
})

ipcMain.handle(
  IPC.RETRY,
  async (
    _event,
    { tabId, requestId, options }: { tabId: string; requestId: string; options: RunOptions }
  ) => {
    log(`IPC RETRY: tab=${tabId} req=${requestId}`)
    return controlPlane.retry(tabId, requestId, options)
  }
)

ipcMain.handle(IPC.STATUS, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.TAB_HEALTH, () => {
  return controlPlane.getHealth()
})

ipcMain.handle(IPC.CLOSE_TAB, (_event, tabId: string) => {
  log(`IPC CLOSE_TAB: ${tabId}`)
  controlPlane.closeTab(tabId)
})

ipcMain.handle(IPC.SELECT_DIRECTORY, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top (not behind other apps).
  // Unparented avoids modal dimming on the transparent overlay.
  // Activation is fine here — user is actively interacting with yald.
  if (process.platform === 'darwin') app.focus()
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
  const result =
    process.platform === 'darwin'
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle(IPC.OPEN_EXTERNAL, async (_event, url: string) => {
  try {
    // Parse with URL constructor to reject malformed/ambiguous payloads
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!parsed.hostname) return false
    await shell.openExternal(parsed.href)
    return true
  } catch {
    return false
  }
})

ipcMain.handle(IPC.ATTACH_FILES, async () => {
  if (!mainWindow) return null
  // macOS: activate app so unparented dialog appears on top
  if (process.platform === 'darwin') app.focus()
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
      {
        name: 'Code',
        extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'md', 'json', 'yaml', 'toml']
      }
    ]
  }
  const result =
    process.platform === 'darwin'
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(mainWindow, options)
  if (result.canceled || result.filePaths.length === 0) return null

  const { basename, extname } = require('path')
  const { readFileSync, statSync } = require('fs')

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
  const mimeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.yaml': 'text/yaml',
    '.toml': 'text/toml'
  }

  return result.filePaths.map((fp: string) => {
    const ext = extname(fp).toLowerCase()
    const mime = mimeMap[ext] || 'application/octet-stream'
    const stat = statSync(fp)
    let dataUrl: string | undefined

    // Generate preview data URL for images (max 2MB to keep IPC fast)
    if (IMAGE_EXTS.has(ext) && stat.size < 2 * 1024 * 1024) {
      try {
        const buf = readFileSync(fp)
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`
      } catch {}
    }

    return {
      id: crypto.randomUUID(),
      type: IMAGE_EXTS.has(ext) ? 'image' : 'file',
      name: basename(fp),
      path: fp,
      mimeType: mime,
      dataUrl,
      size: stat.size
    }
  })
})

ipcMain.handle(IPC.TAKE_SCREENSHOT, async () => {
  if (!mainWindow) return null

  if (SPACES_DEBUG) snapshotWindowState('screenshot pre-hide')
  mainWindow.hide()
  await new Promise((r) => setTimeout(r, 300))

  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)

    const timestamp = Date.now()
    const screenshotPath = join(tmpdir(), `yald-screenshot-${timestamp}.png`)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(display.size.width, 1),
        height: Math.max(display.size.height, 1)
      }
    })
    const preferredDisplayId = String(display.id)
    const source =
      sources.find((item) => item.display_id === preferredDisplayId) ||
      sources.find((item) => item.thumbnail && !item.thumbnail.isEmpty()) ||
      sources[0]

    if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
      log('Screenshot failed: no capturable screen source was available')
      return null
    }

    const buf = source.thumbnail.toPNG()
    writeFileSync(screenshotPath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `screenshot ${++screenshotCounter}.png`,
      path: screenshotPath,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
      size: buf.length
    }
  } catch (err: any) {
    log(`Screenshot failed: ${err.message}`)
    return null
  } finally {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.focus()
    }
    broadcast(IPC.WINDOW_SHOWN)
    if (SPACES_DEBUG) {
      log('[spaces] screenshot restore show+focus')
      snapshotWindowState('screenshot restore immediate')
      setTimeout(() => snapshotWindowState('screenshot restore +200ms'), 200)
    }
  }
})

let pasteCounter = 0
ipcMain.handle(IPC.PASTE_IMAGE, async (_event, dataUrl: string) => {
  try {
    const { writeFileSync } = require('fs')
    const { join } = require('path')
    const { tmpdir } = require('os')

    // Parse data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/(\w+));base64,(.+)$/)
    if (!match) return null

    const [, mimeType, ext, base64Data] = match
    const buf = Buffer.from(base64Data, 'base64')
    const timestamp = Date.now()
    const filePath = join(tmpdir(), `yald-paste-${timestamp}.${ext}`)
    writeFileSync(filePath, buf)

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: `pasted image ${++pasteCounter}.${ext}`,
      path: filePath,
      mimeType,
      dataUrl,
      size: buf.length
    }
  } catch {
    return null
  }
})

ipcMain.handle(IPC.TRANSCRIBE_AUDIO, async (_event, arg: string | { audioBase64: string }) => {
  const audioBase64 = typeof arg === 'string' ? arg : arg?.audioBase64 || ''
  const result = await transcribeAudioBase64({ audioBase64 }, (msg) => log(msg))
  return { error: result.error, transcript: result.transcript }
})

ipcMain.handle(IPC.VISION_START, async (_event, request: VisionStartRequest) => {
  log(`IPC VISION_START: tab=${request.tabId}`)
  await visionAgentManager.startSession(request)
})

ipcMain.handle(IPC.VISION_STOP, async () => {
  log('IPC VISION_STOP')
  await visionAgentManager.stopSession()
})

ipcMain.handle(IPC.VOICE_PROCESS_TURN, async (_event, request: VoiceTurnRequest) => {
  log(`IPC VOICE_PROCESS_TURN: tab=${request.tabId}`)
  return voiceSessionManager.startTurn(request)
})

ipcMain.handle(IPC.VOICE_CANCEL, async (_event, tabId: string) => {
  log(`IPC VOICE_CANCEL: tab=${tabId}`)
  return voiceSessionManager.cancelTab(tabId)
})

ipcMain.handle(IPC.GET_DIAGNOSTICS, () => {
  const { readFileSync, existsSync } = require('fs')
  const health = controlPlane.getHealth()

  let recentLogs = ''
  if (existsSync(LOG_FILE)) {
    try {
      const content = readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      recentLogs = lines.slice(-100).join('\n')
    } catch {}
  }

  return {
    health,
    logPath: LOG_FILE,
    recentLogs,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    appVersion: app.getVersion(),
    transport: 'api'
  }
})

ipcMain.handle(IPC.LIST_SKILLS, async () => {
  log('IPC LIST_SKILLS')
  return listInstalledSkills()
})

ipcMain.handle(IPC.INSTALL_SKILL, async (_event, sourcePath?: string) => {
  let selectedPath = sourcePath

  if (!selectedPath) {
    if (!mainWindow) {
      throw new Error('Main window is not available')
    }
    if (process.platform === 'darwin') app.focus()

    const options: Electron.OpenDialogOptions = {
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Skill Markdown', extensions: ['md'] }]
    }
    const result =
      process.platform === 'darwin'
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(mainWindow, options)

    if (result.canceled || result.filePaths.length === 0) {
      throw new Error('Skill installation cancelled')
    }

    selectedPath = result.filePaths[0]
  }

  log(`IPC INSTALL_SKILL: ${selectedPath}`)
  return installSkill(selectedPath)
})

ipcMain.handle(IPC.UNINSTALL_SKILL, async (_event, skillId: string) => {
  log(`IPC UNINSTALL_SKILL: ${skillId}`)
  await uninstallSkill(skillId)
})

ipcMain.handle(IPC.FETCH_MARKETPLACE, async (_event, forceRefresh?: boolean) => {
  log(`IPC FETCH_MARKETPLACE: refresh=${forceRefresh ? 'yes' : 'no'}`)
  return fetchMarketplaceCatalog(Boolean(forceRefresh))
})

ipcMain.handle(IPC.INSTALL_MARKETPLACE_SKILL, async (_event, plugin: CatalogPlugin) => {
  log(`IPC INSTALL_MARKETPLACE_SKILL: ${plugin.id}`)
  return installMarketplaceSkill(plugin)
})

ipcMain.handle(IPC.UNINSTALL_MARKETPLACE_SKILL, async (_event, pluginId: string) => {
  log(`IPC UNINSTALL_MARKETPLACE_SKILL: ${pluginId}`)
  await uninstallMarketplaceSkill(pluginId)
})

ipcMain.handle(IPC.LIST_SESSIONS, async (): Promise<SessionMeta[]> => [])

ipcMain.handle(
  IPC.RESPOND_PERMISSION,
  async (
    _event,
    payload: {
      tabId: string
      questionId: string
      optionId: string
    }
  ) => controlPlane.respondToPermission(payload.tabId, payload.questionId, payload.optionId)
)

// ─── Theme Detection ───

ipcMain.handle(IPC.GET_THEME, () => {
  return { isDark: nativeTheme.shouldUseDarkColors }
})

nativeTheme.on('updated', () => {
  broadcast(IPC.THEME_CHANGED, nativeTheme.shouldUseDarkColors)
})

// ─── Permission Preflight ───
// Request all required macOS permissions upfront on first launch so the user
// is never interrupted mid-session by a permission prompt.

async function requestPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return

  // ── Microphone (for voice input via Whisper) ──
  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone')
    if (micStatus === 'not-determined') {
      await systemPreferences.askForMediaAccess('microphone')
    }
  } catch (err: any) {
    log(`Permission preflight: microphone check failed — ${err.message}`)
  }

  // ── Accessibility (for global ⌥+Space shortcut) ──
  // globalShortcut works without it on modern macOS; Cmd+Shift+K is always the fallback.
  // Screen Recording: not requested upfront — macOS 15 Sequoia shows an alarming
  // "bypass private window picker" dialog. Let the OS prompt naturally if/when
  // the screenshot feature is actually used.
}

// ─── App Lifecycle ───

app.whenReady().then(async () => {
  // macOS: become an accessory app. Accessory apps can have key windows (keyboard works)
  // without deactivating the currently active app (hover preserved in browsers).
  // This is how Spotlight, Alfred, Raycast work.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  }

  // Request permissions upfront so the user is never interrupted mid-session.
  await requestPermissions()

  createWindow()
  snapshotWindowState('after createWindow')

  if (SPACES_DEBUG) {
    mainWindow?.on('show', () => snapshotWindowState('event window show'))
    mainWindow?.on('hide', () => snapshotWindowState('event window hide'))
    mainWindow?.on('focus', () => snapshotWindowState('event window focus'))
    mainWindow?.on('blur', () => snapshotWindowState('event window blur'))
    mainWindow?.webContents.on('focus', () => snapshotWindowState('event webContents focus'))
    mainWindow?.webContents.on('blur', () => snapshotWindowState('event webContents blur'))

    app.on('browser-window-focus', () => snapshotWindowState('event app browser-window-focus'))
    app.on('browser-window-blur', () => snapshotWindowState('event app browser-window-blur'))

    screen.on('display-added', (_e, display) => {
      log(`[spaces] event display-added id=${display.id}`)
      snapshotWindowState('event display-added')
    })
    screen.on('display-removed', (_e, display) => {
      log(`[spaces] event display-removed id=${display.id}`)
      snapshotWindowState('event display-removed')
    })
    screen.on('display-metrics-changed', (_e, display, changedMetrics) => {
      log(
        `[spaces] event display-metrics-changed id=${display.id} changed=${changedMetrics.join(',')}`
      )
      snapshotWindowState('event display-metrics-changed')
    })
  }

  // Primary: Option+Space (2 keys, doesn't conflict with shell)
  // Fallback: Cmd+Shift+K kept as secondary shortcut
  const registered = globalShortcut.register('Alt+Space', () => toggleWindow('shortcut Alt+Space'))
  if (!registered) {
    log('Alt+Space shortcut registration failed — macOS input sources may claim it')
  }
  const hideToggleRegistered = globalShortcut.register('CommandOrControl+H', () =>
    toggleWindow('shortcut Cmd/Ctrl+H')
  )
  if (!hideToggleRegistered) {
    log('Cmd/Ctrl+H shortcut registration failed')
  }
  globalShortcut.register('CommandOrControl+Shift+K', () =>
    toggleWindow('shortcut Cmd/Ctrl+Shift+K')
  )

  const trayIconPath = join(__dirname, '../../resources/trayTemplate.png')
  const trayIcon = nativeImage.createFromPath(trayIconPath)
  trayIcon.setTemplateImage(true)
  tray = new Tray(trayIcon)
  tray.setToolTip('yald — Ollama UI')
  tray.on('click', () => toggleWindow('tray click'))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show yald', click: () => showWindow('tray menu') },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        }
      }
    ])
  )

  // app 'activate' fires when macOS brings the app to the foreground (e.g. after
  // webContents.focus() triggers applicationDidBecomeActive on some macOS versions).
  // Using showWindow here instead of toggleWindow prevents the re-entry race where
  // a summon immediately hides itself because activate fires mid-show.
  app.on('activate', () => showWindow('app activate'))
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  void visionAgentManager.stopSession()
  controlPlane.shutdown()
  flushLogs()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
