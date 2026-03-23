import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type {
  RunOptions,
  NormalizedEvent,
  HealthReport,
  EnrichedError,
  Attachment,
  CatalogPlugin,
  SandboxExecResult,
  SandboxHandle,
  SandboxOptions,
  SessionMeta,
  ShortcutCommand,
  SkillMeta,
  VisionEvent,
  VisionStartRequest,
  VoiceEvent,
  VoiceTurnRequest
} from '../shared/types'

export interface yaldAPI {
  // ─── Request-response (renderer → main) ───
  start(): Promise<{
    version: string
    auth: { email?: string; subscriptionType?: string; authMethod?: string }
    mcpServers: string[]
    projectPath: string
    homePath: string
  }>
  createTab(): Promise<{ tabId: string }>
  prompt(tabId: string, requestId: string, options: RunOptions): Promise<void>
  cancel(requestId: string): Promise<boolean>
  stopTab(tabId: string): Promise<boolean>
  retry(tabId: string, requestId: string, options: RunOptions): Promise<void>
  status(): Promise<HealthReport>
  tabHealth(): Promise<HealthReport>
  closeTab(tabId: string): Promise<void>
  selectDirectory(): Promise<string | null>
  openExternal(url: string): Promise<boolean>
  attachFiles(): Promise<Attachment[] | null>
  takeScreenshot(): Promise<Attachment | null>
  pasteImage(dataUrl: string): Promise<Attachment | null>
  transcribeAudio(audioBase64: string): Promise<{ error: string | null; transcript: string | null }>
  startVisionSession(request: VisionStartRequest): Promise<void>
  stopVisionSession(): Promise<void>
  processVoiceTurn(request: VoiceTurnRequest): Promise<{ turnId: string }>
  cancelVoiceTurn(tabId: string): Promise<boolean>
  getDiagnostics(): Promise<unknown>
  listSkills(): Promise<SkillMeta[]>
  installSkill(sourcePath?: string): Promise<SkillMeta>
  uninstallSkill(skillId: string): Promise<void>
  fetchMarketplaceCatalog(forceRefresh?: boolean): Promise<CatalogPlugin[]>
  installMarketplaceSkill(plugin: CatalogPlugin): Promise<SkillMeta>
  uninstallMarketplaceSkill(pluginId: string): Promise<void>
  listSessions(projectPath?: string): Promise<SessionMeta[]>
  respondPermission(tabId: string, questionId: string, optionId: string): Promise<boolean>
  sandboxCreate(): Promise<SandboxHandle>
  sandboxExec(id: string, command: string, options?: SandboxOptions): Promise<SandboxExecResult>
  sandboxWriteFile(id: string, relativePath: string, content: string): Promise<void>
  sandboxReadFile(id: string, relativePath: string): Promise<string>
  sandboxExposePort(id: string): Promise<{ port: number; url: string }>
  sandboxGetLogs(id: string): Promise<string>
  sandboxDestroy(id: string): Promise<void>
  browserNavigate(url: string): Promise<void>
  browserScreenshot(): Promise<string>
  browserClick(selector: string): Promise<void>
  browserType(selector: string, text: string): Promise<void>
  browserReadDom(selector: string): Promise<string>
  browserConsoleLogs(): Promise<Array<{ level: string; message: string }>>
  browserClose(): Promise<void>
  runVibePipeline(tabId: string, prompt: string, sandboxId: string): Promise<void>
  stopVibePipeline(tabId: string): Promise<void>
  getTheme(): Promise<{ isDark: boolean }>
  onThemeChange(callback: (isDark: boolean) => void): () => void

  // ─── Window management ───
  resizeHeight(height: number): void
  setWindowWidth(width: number): void
  animateHeight(from: number, to: number, durationMs: number): Promise<void>
  hideWindow(): void
  isVisible(): Promise<boolean>
  /** OS-level click-through for transparent window regions */
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void

  // ─── Event listeners (main → renderer) ───
  onEvent(callback: (tabId: string, event: NormalizedEvent) => void): () => void
  onTabStatusChange(
    callback: (tabId: string, newStatus: string, oldStatus: string) => void
  ): () => void
  onError(callback: (tabId: string, error: EnrichedError) => void): () => void
  onVoiceEvent(callback: (event: VoiceEvent) => void): () => void
  onVisionEvent(callback: (event: VisionEvent) => void): () => void
  onWindowShown(callback: () => void): () => void
  onShortcutCommand(callback: (command: ShortcutCommand) => void): () => void
  onPipelineStage(callback: (tabId: string, stage: string) => void): () => void
  onPipelineLog(callback: (tabId: string, line: string) => void): () => void
  onSandboxReady(callback: (tabId: string, url: string) => void): () => void
  onPipelineComplete(callback: (tabId: string, summary: string) => void): () => void
  onPipelineError(callback: (tabId: string, error: string) => void): () => void
}

const api: yaldAPI = {
  // ─── Request-response ───
  start: () => ipcRenderer.invoke(IPC.START),
  createTab: () => ipcRenderer.invoke(IPC.CREATE_TAB),
  prompt: (tabId, requestId, options) =>
    ipcRenderer.invoke(IPC.PROMPT, { tabId, requestId, options }),
  cancel: (requestId) => ipcRenderer.invoke(IPC.CANCEL, requestId),
  stopTab: (tabId) => ipcRenderer.invoke(IPC.STOP_TAB, tabId),
  retry: (tabId, requestId, options) =>
    ipcRenderer.invoke(IPC.RETRY, { tabId, requestId, options }),
  status: () => ipcRenderer.invoke(IPC.STATUS),
  tabHealth: () => ipcRenderer.invoke(IPC.TAB_HEALTH),
  closeTab: (tabId) => ipcRenderer.invoke(IPC.CLOSE_TAB, tabId),
  selectDirectory: () => ipcRenderer.invoke(IPC.SELECT_DIRECTORY),
  openExternal: (url) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  attachFiles: () => ipcRenderer.invoke(IPC.ATTACH_FILES),
  takeScreenshot: () => ipcRenderer.invoke(IPC.TAKE_SCREENSHOT),
  pasteImage: (dataUrl) => ipcRenderer.invoke(IPC.PASTE_IMAGE, dataUrl),
  transcribeAudio: (audioBase64) => ipcRenderer.invoke(IPC.TRANSCRIBE_AUDIO, { audioBase64 }),
  startVisionSession: (request) => ipcRenderer.invoke(IPC.VISION_START, request),
  stopVisionSession: () => ipcRenderer.invoke(IPC.VISION_STOP),
  processVoiceTurn: (request) => ipcRenderer.invoke(IPC.VOICE_PROCESS_TURN, request),
  cancelVoiceTurn: (tabId) => ipcRenderer.invoke(IPC.VOICE_CANCEL, tabId),
  getDiagnostics: () => ipcRenderer.invoke(IPC.GET_DIAGNOSTICS),
  listSkills: () => ipcRenderer.invoke(IPC.LIST_SKILLS),
  installSkill: (sourcePath?: string) => ipcRenderer.invoke(IPC.INSTALL_SKILL, sourcePath),
  uninstallSkill: (skillId: string) => ipcRenderer.invoke(IPC.UNINSTALL_SKILL, skillId),
  fetchMarketplaceCatalog: (forceRefresh = false) =>
    ipcRenderer.invoke(IPC.FETCH_MARKETPLACE, forceRefresh),
  installMarketplaceSkill: (plugin: CatalogPlugin) =>
    ipcRenderer.invoke(IPC.INSTALL_MARKETPLACE_SKILL, plugin),
  uninstallMarketplaceSkill: (pluginId: string) =>
    ipcRenderer.invoke(IPC.UNINSTALL_MARKETPLACE_SKILL, pluginId),
  listSessions: (projectPath?: string) => ipcRenderer.invoke(IPC.LIST_SESSIONS, projectPath),
  respondPermission: (tabId: string, questionId: string, optionId: string) =>
    ipcRenderer.invoke(IPC.RESPOND_PERMISSION, { tabId, questionId, optionId }),
  sandboxCreate: () => ipcRenderer.invoke(IPC.SANDBOX_CREATE),
  sandboxExec: (id, command, options) =>
    ipcRenderer.invoke(IPC.SANDBOX_EXEC, { id, command, options }),
  sandboxWriteFile: (id, relativePath, content) =>
    ipcRenderer.invoke(IPC.SANDBOX_WRITE_FILE, { id, relativePath, content }),
  sandboxReadFile: (id, relativePath) =>
    ipcRenderer.invoke(IPC.SANDBOX_READ_FILE, { id, relativePath }),
  sandboxExposePort: (id) => ipcRenderer.invoke(IPC.SANDBOX_EXPOSE_PORT, { id }),
  sandboxGetLogs: (id) => ipcRenderer.invoke(IPC.SANDBOX_GET_LOGS, { id }),
  sandboxDestroy: (id) => ipcRenderer.invoke(IPC.SANDBOX_DESTROY, { id }),
  browserNavigate: (url) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, { url }),
  browserScreenshot: () => ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT),
  browserClick: (selector) => ipcRenderer.invoke(IPC.BROWSER_CLICK, { selector }),
  browserType: (selector, text) => ipcRenderer.invoke(IPC.BROWSER_TYPE, { selector, text }),
  browserReadDom: (selector) => ipcRenderer.invoke(IPC.BROWSER_READ_DOM, { selector }),
  browserConsoleLogs: () => ipcRenderer.invoke(IPC.BROWSER_CONSOLE_LOGS),
  browserClose: () => ipcRenderer.invoke(IPC.BROWSER_CLOSE),
  runVibePipeline: (tabId, prompt, sandboxId) =>
    ipcRenderer.invoke(IPC.RUN_VIBE_PIPELINE, { tabId, prompt, sandboxId }),
  stopVibePipeline: (tabId) => ipcRenderer.invoke(IPC.STOP_VIBE_PIPELINE, { tabId }),
  getTheme: () => ipcRenderer.invoke(IPC.GET_THEME),
  onThemeChange: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, isDark: boolean) => callback(isDark)
    ipcRenderer.on(IPC.THEME_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.THEME_CHANGED, handler)
  },

  // ─── Window management ───
  resizeHeight: (height) => ipcRenderer.send(IPC.RESIZE_HEIGHT, height),
  animateHeight: (from, to, durationMs) =>
    ipcRenderer.invoke(IPC.ANIMATE_HEIGHT, { from, to, durationMs }),
  hideWindow: () => ipcRenderer.send(IPC.HIDE_WINDOW),
  isVisible: () => ipcRenderer.invoke(IPC.IS_VISIBLE),
  setIgnoreMouseEvents: (ignore, options) =>
    ipcRenderer.send(IPC.SET_IGNORE_MOUSE_EVENTS, ignore, options || {}),
  setWindowWidth: (width) => ipcRenderer.send(IPC.SET_WINDOW_WIDTH, width),

  // ─── Event listeners ───
  onEvent: (callback) => {
    // Single unified handler — all normalized events come through one channel
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, event: NormalizedEvent) =>
      callback(tabId, event)
    ipcRenderer.on('yald:normalized-event', handler)
    return () => ipcRenderer.removeListener('yald:normalized-event', handler)
  },

  onTabStatusChange: (callback) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      tabId: string,
      newStatus: string,
      oldStatus: string
    ) => callback(tabId, newStatus, oldStatus)
    ipcRenderer.on('yald:tab-status-change', handler)
    return () => ipcRenderer.removeListener('yald:tab-status-change', handler)
  },

  onError: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, error: EnrichedError) =>
      callback(tabId, error)
    ipcRenderer.on('yald:enriched-error', handler)
    return () => ipcRenderer.removeListener('yald:enriched-error', handler)
  },

  onVoiceEvent: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, event: VoiceEvent) => callback(event)
    ipcRenderer.on(IPC.VOICE_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.VOICE_EVENT, handler)
  },

  onVisionEvent: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, event: VisionEvent) => callback(event)
    ipcRenderer.on(IPC.VISION_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.VISION_EVENT, handler)
  },

  onWindowShown: (callback) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.WINDOW_SHOWN, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_SHOWN, handler)
  },

  onShortcutCommand: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, command: ShortcutCommand) => callback(command)
    ipcRenderer.on(IPC.SHORTCUT_COMMAND, handler)
    return () => ipcRenderer.removeListener(IPC.SHORTCUT_COMMAND, handler)
  },

  onPipelineStage: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, stage: string) =>
      callback(tabId, stage)
    ipcRenderer.on(IPC.PIPELINE_STAGE, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_STAGE, handler)
  },

  onPipelineLog: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, line: string) =>
      callback(tabId, line)
    ipcRenderer.on(IPC.PIPELINE_LOG, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_LOG, handler)
  },

  onSandboxReady: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, url: string) =>
      callback(tabId, url)
    ipcRenderer.on(IPC.SANDBOX_READY, handler)
    return () => ipcRenderer.removeListener(IPC.SANDBOX_READY, handler)
  },

  onPipelineComplete: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, summary: string) =>
      callback(tabId, summary)
    ipcRenderer.on(IPC.PIPELINE_COMPLETE, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_COMPLETE, handler)
  },

  onPipelineError: (callback) => {
    const handler = (_e: Electron.IpcRendererEvent, tabId: string, error: string) =>
      callback(tabId, error)
    ipcRenderer.on(IPC.PIPELINE_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC.PIPELINE_ERROR, handler)
  }
}

contextBridge.exposeInMainWorld('yald', api)
