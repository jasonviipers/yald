import { create } from 'zustand'
import {
  AVAILABLE_MODELS,
  OLLAMA_BASE_URL,
  type ModelOption,
  type OllamaConfig
} from '@renderer/lib/llm'
import { isOllamaCloudUrl, resolveBackendUrl } from '@shared/backend-url'
import {
  Attachment,
  EnrichedError,
  NormalizedEvent,
  PromptHistoryMessage,
  ProviderContext,
  SkillMeta,
  TabState,
  TabStatus,
  VisionEvent,
  VisionFeedback,
  VisionSessionState
} from '@shared/types'
import { useThemeStore } from '@renderer/lib/theme'

function normalizeModelId(modelId: string): string {
  return modelId.replace(/\[[^\]]+\]/g, '').trim()
}

export function getModelDisplayLabel(modelId: string): string {
  const normalizedId = normalizeModelId(modelId)
  const has1MContext = /\[\s*1m\s*\]/i.test(modelId)
  const known = AVAILABLE_MODELS.find((model) => model.id === normalizedId)
  if (known) return has1MContext ? `${known.label} (1M)` : known.label
  return has1MContext ? `${normalizedId} (1M)` : normalizedId
}

const OLLAMA_CONFIG_KEY = 'yald-ollama-config'
const SELECTED_SKILL_IDS_KEY = 'yald-selected-skill-ids'

function normalizeOllamaConfig(config: OllamaConfig | undefined): OllamaConfig {
  const baseUrl = config?.baseUrl?.trim()
  return {
    apiKey: config?.apiKey?.trim() || undefined,
    baseUrl: baseUrl && !isOllamaCloudUrl(baseUrl) ? baseUrl : undefined
  }
}

function loadOllamaConfig(): OllamaConfig {
  try {
    const raw = localStorage.getItem(OLLAMA_CONFIG_KEY)
    if (raw) return normalizeOllamaConfig(JSON.parse(raw) as OllamaConfig)
  } catch {}
  return {}
}

function saveOllamaConfig(config: OllamaConfig): void {
  try {
    localStorage.setItem(OLLAMA_CONFIG_KEY, JSON.stringify(config))
  } catch {}
}

function loadStoredSkillSelection(): { hasStoredSelection: boolean; skillIds: string[] } {
  try {
    const raw = localStorage.getItem(SELECTED_SKILL_IDS_KEY)
    if (raw === null) return { hasStoredSelection: false, skillIds: [] }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return {
        hasStoredSelection: true,
        skillIds: parsed.filter((value): value is string => typeof value === 'string')
      }
    }
  } catch {}
  return { hasStoredSelection: false, skillIds: [] }
}

function saveSelectedSkillIds(skillIds: string[]): void {
  try {
    localStorage.setItem(SELECTED_SKILL_IDS_KEY, JSON.stringify(skillIds))
  } catch {}
}

function sortSkills(skills: SkillMeta[]): SkillMeta[] {
  return [...skills].sort((a, b) => a.name.localeCompare(b.name))
}

function reconcileSelectedSkillIds(
  installedSkills: SkillMeta[],
  selectedSkillIds: string[],
  hasStoredSelection: boolean
): string[] {
  const installedIds = new Set(installedSkills.map((skill) => skill.id))
  const filtered = selectedSkillIds.filter((skillId) => installedIds.has(skillId))
  if (!hasStoredSelection) return installedSkills.map((skill) => skill.id)
  return filtered
}

interface StaticInfo {
  version: string
  email: string | null
  subscriptionType: string | null
  projectPath: string
  homePath: string
}

interface State {
  tabs: TabState[]
  activeTabId: string
  isExpanded: boolean
  skillsPanelOpen: boolean
  settingsOpen: boolean
  voiceShortcutNonce: number
  visionState: VisionSessionState
  visionFeedback: VisionFeedback | null
  visionError: string | null
  visionTabId: string | null
  staticInfo: StaticInfo | null
  preferredModel: string | null
  ollamaConfig: OllamaConfig
  installedSkills: SkillMeta[]
  selectedSkillIds: string[]
  hasStoredSkillSelection: boolean
  initStaticInfo: () => Promise<void>
  refreshInstalledSkills: () => Promise<void>
  setPreferredModel: (model: string | null) => void
  setOllamaConfig: (config: OllamaConfig) => void
  toggleSkillsPanel: () => void
  closeSkillsPanel: () => void
  toggleSettingsOpen: () => void
  closeSettings: () => void
  requestVoiceToggle: () => void
  startVision: (provider: ProviderContext) => Promise<void>
  stopVision: () => Promise<void>
  toggleVision: (provider: ProviderContext) => Promise<void>
  handleVisionEvent: (event: VisionEvent) => void
  toggleSkillSelection: (skillId: string) => void
  installSkill: (sourcePath?: string) => Promise<void>
  uninstallSkill: (skillId: string) => Promise<void>
  createTab: () => Promise<string>
  selectTab: (tabId: string) => void
  closeTab: (tabId: string) => void
  clearTab: () => void
  toggleExpanded: () => void
  addSystemMessage: (content: string) => void
  sendMessage: (prompt: string, projectPath?: string) => void
  addDirectory: (dir: string) => void
  removeDirectory: (dir: string) => void
  setBaseDirectory: (dir: string) => void
  addAttachments: (attachments: Attachment[]) => void
  removeAttachment: (attachmentId: string) => void
  clearAttachments: () => void
  handleNormalizedEvent: (tabId: string, event: NormalizedEvent) => void
  handleStatusChange: (tabId: string, newStatus: string, oldStatus: string) => void
  handleError: (tabId: string, error: EnrichedError) => void
}

let msgCounter = 0
const nextMsgId = () => `msg-${++msgCounter}`

async function playNotificationIfHidden(): Promise<void> {
  if (!useThemeStore.getState().soundEnabled) return
  try {
  } catch {}
}

function toPromptHistory(messages: TabState['messages']): PromptHistoryMessage[] {
  return messages
    .filter(
      (message): message is typeof message & { role: 'system' | 'user' | 'assistant' } =>
        message.role === 'system' || message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => ({
      role: message.role,
      content: message.content
    }))
}

function resolveProviderContextInternal(
  preferredModel: string | null,
  ollamaConfig: OllamaConfig
): ProviderContext {
  const fallbackModel = AVAILABLE_MODELS[0]?.id || 'gpt-oss:120b'
  return {
    providerId: 'ollama',
    model: preferredModel ?? fallbackModel,
    baseUrl: resolveBackendUrl(ollamaConfig.baseUrl || OLLAMA_BASE_URL),
    apiKey: ollamaConfig.apiKey,
    transport: 'api'
  }
}

export function getAvailableModels(): ModelOption[] {
  return AVAILABLE_MODELS
}

export function resolveProviderContextForUi(
  preferredModel: string | null,
  ollamaConfig: OllamaConfig
): ProviderContext {
  return resolveProviderContextInternal(preferredModel, ollamaConfig)
}

export function resolveProviderContext(
  preferredModel: string | null,
  ollamaConfig: OllamaConfig
): ProviderContext {
  return resolveProviderContextInternal(preferredModel, ollamaConfig)
}

function makeLocalTab(): TabState {
  return {
    id: crypto.randomUUID(),
    claudeSessionId: null,
    sessionProviderId: null,
    sessionTransport: null,
    status: 'idle',
    activeRequestId: null,
    hasUnread: false,
    currentActivity: '',
    attachments: [],
    messages: [],
    title: 'New Tab',
    lastResult: null,
    sessionModel: null,
    sessionTools: [],
    sessionMcpServers: [],
    sessionSkills: [],
    sessionVersion: null,
    permissionQueue: [],
    permissionDenied: null,
    queuedPrompts: [],
    workingDirectory: '~',
    hasChosenDirectory: false,
    additionalDirs: []
  }
}

const initialTab = makeLocalTab()
const storedSkillSelection = loadStoredSkillSelection()

export const useSessionStore = create<State>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  isExpanded: false,
  skillsPanelOpen: false,
  settingsOpen: false,
  voiceShortcutNonce: 0,
  visionState: 'idle',
  visionFeedback: null,
  visionError: null,
  visionTabId: null,
  staticInfo: null,
  preferredModel: null,
  ollamaConfig: loadOllamaConfig(),
  installedSkills: [],
  selectedSkillIds: storedSkillSelection.skillIds,
  hasStoredSkillSelection: storedSkillSelection.hasStoredSelection,

  initStaticInfo: async () => {
    try {
      const [info, installedSkills] = await Promise.all([
        window.yald.start(),
        window.yald.listSkills()
      ])
      const reconciledSkillIds = reconcileSelectedSkillIds(
        installedSkills,
        get().selectedSkillIds,
        get().hasStoredSkillSelection
      )
      saveSelectedSkillIds(reconciledSkillIds)
      set({
        staticInfo: {
          version: info.version,
          email: info.auth?.email || null,
          subscriptionType: info.auth?.subscriptionType || null,
          projectPath: info.projectPath,
          homePath: info.homePath
        },
        installedSkills: sortSkills(installedSkills),
        selectedSkillIds: reconciledSkillIds,
        hasStoredSkillSelection: true
      })
    } catch {}
  },

  refreshInstalledSkills: async () => {
    try {
      const installedSkills = await window.yald.listSkills()
      const reconciledSkillIds = reconcileSelectedSkillIds(
        installedSkills,
        get().selectedSkillIds,
        get().hasStoredSkillSelection
      )
      saveSelectedSkillIds(reconciledSkillIds)
      set({
        installedSkills: sortSkills(installedSkills),
        selectedSkillIds: reconciledSkillIds,
        hasStoredSkillSelection: true
      })
    } catch {}
  },

  setPreferredModel: (model) => set({ preferredModel: model }),

  setOllamaConfig: (config) => {
    const updated = normalizeOllamaConfig(config)
    set({ ollamaConfig: updated })
    saveOllamaConfig(updated)
  },

  toggleSkillsPanel: () =>
    set((state) => ({ skillsPanelOpen: !state.skillsPanelOpen, settingsOpen: false })),

  closeSkillsPanel: () => set({ skillsPanelOpen: false }),

  toggleSettingsOpen: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen, skillsPanelOpen: false })),

  closeSettings: () => set({ settingsOpen: false }),

  requestVoiceToggle: () =>
    set((state) => ({
      voiceShortcutNonce: state.voiceShortcutNonce + 1,
      settingsOpen: false,
      skillsPanelOpen: false
    })),

  startVision: async (provider) => {
    const { activeTabId } = get()
    if (!activeTabId) {
      set({ visionState: 'error', visionError: 'Open a tab before starting vision.' })
      return
    }

    set({
      visionState: 'starting',
      visionError: null,
      visionTabId: activeTabId
    })

    try {
      await window.yald.startVisionSession({
        tabId: activeTabId,
        provider,
        intervalMs: 2200,
        autoAct: true
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        visionState: 'error',
        visionError: `Vision start failed: ${message}`
      })
    }
  },

  stopVision: async () => {
    try {
      await window.yald.stopVisionSession()
    } catch {}

    set({
      visionState: 'idle',
      visionError: null,
      visionTabId: null,
      visionFeedback: null
    })
  },

  toggleVision: async (provider) => {
    const { visionState, stopVision, startVision } = get()
    if (visionState === 'starting' || visionState === 'observing') {
      await stopVision()
      return
    }
    await startVision(provider)
  },

  handleVisionEvent: (event) => {
    set((state) => {
      if (event.type === 'feedback') {
        return {
          visionState: 'observing' as VisionSessionState,
          visionFeedback: event.feedback,
          visionError: null,
          visionTabId: event.tabId
        }
      }

      if (event.type === 'error') {
        return {
          visionState: 'error' as VisionSessionState,
          visionError: event.message
        }
      }

      return {
        visionState: event.state,
        visionError: event.state === 'error' ? event.message || state.visionError : null,
        visionFeedback: event.state === 'idle' ? null : state.visionFeedback,
        visionTabId: event.state === 'idle' ? null : event.tabId || state.visionTabId
      }
    })
  },

  toggleSkillSelection: (skillId) => {
    set((state) => {
      const selectedSkillIds = state.selectedSkillIds.includes(skillId)
        ? state.selectedSkillIds.filter((id) => id !== skillId)
        : [...state.selectedSkillIds, skillId]
      saveSelectedSkillIds(selectedSkillIds)
      return {
        selectedSkillIds,
        hasStoredSkillSelection: true
      }
    })
  },

  installSkill: async (sourcePath) => {
    const installedSkill = await window.yald.installSkill(sourcePath)
    set((state) => {
      const installedSkills = sortSkills(
        state.installedSkills.some((skill) => skill.id === installedSkill.id)
          ? state.installedSkills
          : [...state.installedSkills, installedSkill]
      )
      const selectedSkillIds = state.selectedSkillIds.includes(installedSkill.id)
        ? state.selectedSkillIds
        : [...state.selectedSkillIds, installedSkill.id]
      saveSelectedSkillIds(selectedSkillIds)
      return {
        installedSkills,
        selectedSkillIds,
        hasStoredSkillSelection: true
      }
    })
  },

  uninstallSkill: async (skillId) => {
    await window.yald.uninstallSkill(skillId)
    set((state) => {
      const installedSkills = state.installedSkills.filter((skill) => skill.id !== skillId)
      const selectedSkillIds = state.selectedSkillIds.filter((id) => id !== skillId)
      saveSelectedSkillIds(selectedSkillIds)
      return {
        installedSkills,
        selectedSkillIds,
        hasStoredSkillSelection: true
      }
    })
  },

  createTab: async () => {
    const { tabId } = await window.yald.createTab()
    const newTab = { ...makeLocalTab(), id: tabId }
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
      isExpanded: true,
      skillsPanelOpen: false,
      settingsOpen: false
    }))
    return tabId
  },

  selectTab: (tabId) => {
    const state = get()
    if (tabId === state.activeTabId) {
      const willExpand = !state.isExpanded
      set((prev) => ({
        isExpanded: willExpand,
        settingsOpen: false,
        skillsPanelOpen: false,
        tabs: willExpand
          ? prev.tabs.map((tab) => (tab.id === tabId ? { ...tab, hasUnread: false } : tab))
          : prev.tabs
      }))
    } else {
      set((prev) => ({
        activeTabId: tabId,
        settingsOpen: false,
        skillsPanelOpen: false,
        tabs: prev.tabs.map((tab) => (tab.id === tabId ? { ...tab, hasUnread: false } : tab))
      }))
    }
  },

  toggleExpanded: () => {
    const { activeTabId, isExpanded } = get()
    const willExpand = !isExpanded
    set((state) => ({
      isExpanded: willExpand,
      settingsOpen: false,
      skillsPanelOpen: false,
      tabs: willExpand
        ? state.tabs.map((tab) => (tab.id === activeTabId ? { ...tab, hasUnread: false } : tab))
        : state.tabs
    }))
  },

  closeTab: (tabId) => {
    const { activeTabId, tabs, visionTabId } = get()
    if (tabs.length <= 1) return

    window.yald.closeTab(tabId).catch(() => {})
    if (visionTabId === tabId) {
      void get().stopVision()
    }

    const remaining = tabs.filter((tab) => tab.id !== tabId)
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId)
    const fallbackTab = remaining[Math.max(0, closedIndex - 1)] || remaining[0]

    set({
      tabs: remaining,
      activeTabId: activeTabId === tabId ? fallbackTab.id : activeTabId
    })
  },

  clearTab: () => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              messages: [],
              lastResult: null,
              currentActivity: '',
              permissionQueue: [],
              permissionDenied: null,
              queuedPrompts: []
            }
          : tab
      )
    }))
  },

  addSystemMessage: (content) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              messages: [
                ...tab.messages,
                { id: nextMsgId(), role: 'system' as const, content, timestamp: Date.now() }
              ]
            }
          : tab
      )
    }))
  },

  addDirectory: (dir) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              additionalDirs: tab.additionalDirs.includes(dir)
                ? tab.additionalDirs
                : [...tab.additionalDirs, dir]
            }
          : tab
      )
    }))
  },

  removeDirectory: (dir) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? { ...tab, additionalDirs: tab.additionalDirs.filter((item) => item !== dir) }
          : tab
      )
    }))
  },

  setBaseDirectory: (dir) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              workingDirectory: dir,
              hasChosenDirectory: true,
              claudeSessionId: null,
              sessionProviderId: null,
              sessionTransport: null,
              additionalDirs: []
            }
          : tab
      )
    }))
  },

  addAttachments: (attachments) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, attachments: [...tab.attachments, ...attachments] } : tab
      )
    }))
  },

  removeAttachment: (attachmentId) => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              attachments: tab.attachments.filter((attachment) => attachment.id !== attachmentId)
            }
          : tab
      )
    }))
  },

  clearAttachments: () => {
    const { activeTabId } = get()
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === activeTabId ? { ...tab, attachments: [] } : tab))
    }))
  },

  sendMessage: (prompt, projectPath) => {
    const { activeTabId, tabs, staticInfo, preferredModel, ollamaConfig, selectedSkillIds } = get()
    const tab = tabs.find((item) => item.id === activeTabId)
    const resolvedPath =
      projectPath ||
      (tab?.hasChosenDirectory
        ? tab.workingDirectory
        : staticInfo?.homePath || tab?.workingDirectory || '~')

    if (!tab || tab.status === 'connecting') return

    const isBusy = tab.status === 'running'
    const requestId = crypto.randomUUID()
    const providerContext = resolveProviderContextInternal(preferredModel, ollamaConfig)

    const title =
      tab.messages.length === 0
        ? prompt.length > 30
          ? `${prompt.substring(0, 27)}...`
          : prompt
        : tab.title

    set((state) => ({
      tabs: state.tabs.map((item) => {
        if (item.id !== activeTabId) return item
        const withEffectiveBase = item.hasChosenDirectory
          ? item
          : { ...item, hasChosenDirectory: true, workingDirectory: resolvedPath }

        if (isBusy) {
          return {
            ...withEffectiveBase,
            title,
            attachments: [],
            queuedPrompts: [...withEffectiveBase.queuedPrompts, prompt]
          }
        }

        return {
          ...withEffectiveBase,
          status: 'connecting' as TabStatus,
          activeRequestId: requestId,
          currentActivity: 'Starting...',
          title,
          attachments: [],
          messages: [
            ...withEffectiveBase.messages,
            { id: nextMsgId(), role: 'user' as const, content: prompt, timestamp: Date.now() }
          ]
        }
      })
    }))

    void window.yald
      .prompt(activeTabId, requestId, {
        prompt,
        projectPath: resolvedPath,
        sessionId: tab.claudeSessionId || undefined,
        model: providerContext.model,
        addDirs: tab.additionalDirs,
        skillIds: selectedSkillIds,
        provider: providerContext,
        history: toPromptHistory(tab.messages),
        attachments: tab.attachments
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        get().handleError(activeTabId, {
          message,
          stderrTail: [],
          exitCode: null,
          elapsedMs: 0,
          toolCallCount: 0,
          permissionDenials: []
        })
      })
  },

  handleNormalizedEvent: (tabId, event) => {
    set((state) => {
      const { activeTabId } = state
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        const updated = { ...tab }

        switch (event.type) {
          case 'session_init':
            updated.claudeSessionId = event.sessionId
            updated.sessionProviderId = 'ollama'
            updated.sessionTransport = 'api'
            updated.sessionModel = event.model
            updated.sessionTools = event.tools
            updated.sessionMcpServers = event.mcpServers
            updated.sessionSkills = event.skills
            updated.sessionVersion = event.version
            if (!event.isWarmup) {
              updated.status = 'running'
              updated.currentActivity = 'Thinking...'
              if (updated.queuedPrompts.length > 0) {
                const [nextPrompt, ...rest] = updated.queuedPrompts
                updated.queuedPrompts = rest
                updated.messages = [
                  ...updated.messages,
                  {
                    id: nextMsgId(),
                    role: 'user' as const,
                    content: nextPrompt,
                    timestamp: Date.now()
                  }
                ]
              }
            }
            break

          case 'text_chunk': {
            updated.currentActivity = 'Writing...'
            const lastMsg = updated.messages[updated.messages.length - 1]
            if (lastMsg?.role === 'assistant' && !lastMsg.toolName) {
              updated.messages = [
                ...updated.messages.slice(0, -1),
                { ...lastMsg, content: lastMsg.content + event.text }
              ]
            } else {
              updated.messages = [
                ...updated.messages,
                { id: nextMsgId(), role: 'assistant', content: event.text, timestamp: Date.now() }
              ]
            }
            break
          }

          case 'tool_call':
            updated.currentActivity = `Running ${event.toolName}...`
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'tool',
                content: '',
                toolName: event.toolName,
                toolInput: '',
                toolStatus: 'running',
                timestamp: Date.now()
              }
            ]
            break

          case 'tool_call_update': {
            const messages = [...updated.messages]
            const lastTool = [...messages]
              .reverse()
              .find((message) => message.role === 'tool' && message.toolStatus === 'running')
            if (lastTool) lastTool.toolInput = (lastTool.toolInput || '') + event.partialInput
            updated.messages = messages
            break
          }

          case 'tool_call_complete': {
            const messages = [...updated.messages]
            const runningTool = [...messages]
              .reverse()
              .find((message) => message.role === 'tool' && message.toolStatus === 'running')
            if (runningTool) runningTool.toolStatus = 'completed'
            updated.messages = messages
            break
          }

          case 'task_update':
            break

          case 'task_complete':
            updated.status = 'completed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.lastResult = {
              totalCostUsd: event.costUsd,
              durationMs: event.durationMs,
              numTurns: event.numTurns,
              usage: event.usage,
              sessionId: event.sessionId
            }
            if (event.result) {
              const lastUserIdx = (() => {
                for (let i = updated.messages.length - 1; i >= 0; i -= 1) {
                  if (updated.messages[i].role === 'user') return i
                }
                return -1
              })()
              const hasAnyText = updated.messages
                .slice(lastUserIdx + 1)
                .some((message) => message.role === 'assistant' && !message.toolName)
              if (!hasAnyText) {
                updated.messages = [
                  ...updated.messages,
                  {
                    id: nextMsgId(),
                    role: 'assistant' as const,
                    content: event.result,
                    timestamp: Date.now()
                  }
                ]
              }
            }
            if (tabId !== activeTabId || !state.isExpanded) updated.hasUnread = true
            playNotificationIfHidden()
            break

          case 'error':
            updated.status = 'failed'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Error: ${event.message}`,
                timestamp: Date.now()
              }
            ]
            break

          case 'session_dead':
            updated.status = 'dead'
            updated.activeRequestId = null
            updated.currentActivity = ''
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Session ended unexpectedly (exit ${event.exitCode})`,
                timestamp: Date.now()
              }
            ]
            break

          case 'permission_request':
            updated.messages = [
              ...updated.messages,
              {
                id: nextMsgId(),
                role: 'system',
                content: `Permission request ignored in Ollama mode: ${event.toolName}`,
                timestamp: Date.now()
              }
            ]
            break

          case 'rate_limit':
            if (event.status !== 'allowed') {
              updated.messages = [
                ...updated.messages,
                {
                  id: nextMsgId(),
                  role: 'system',
                  content: `Rate limited (${event.rateLimitType}). Resets at ${new Date(event.resetsAt).toLocaleTimeString()}.`,
                  timestamp: Date.now()
                }
              ]
            }
            break

          case 'usage':
            break
        }

        return updated
      })

      return { tabs }
    })
  },

  handleStatusChange: (tabId, newStatus) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              status: newStatus as TabStatus,
              ...(newStatus === 'idle' ? { currentActivity: '' } : {})
            }
          : tab
      )
    }))
  },

  handleError: (tabId, error) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab
        const lastMsg = tab.messages[tab.messages.length - 1]
        const alreadyHasError = lastMsg?.role === 'system' && lastMsg.content.startsWith('Error:')
        return {
          ...tab,
          status: 'failed' as TabStatus,
          activeRequestId: null,
          currentActivity: '',
          messages: alreadyHasError
            ? tab.messages
            : [
                ...tab.messages,
                {
                  id: nextMsgId(),
                  role: 'system' as const,
                  content: `Error: ${error.message}${error.stderrTail.length > 0 ? '\n\n' + error.stderrTail.slice(-5).join('\n') : ''}`,
                  timestamp: Date.now()
                }
              ]
        }
      })
    }))
  }
}))
