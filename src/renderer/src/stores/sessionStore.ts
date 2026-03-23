import { create } from 'zustand'
import {
  AVAILABLE_MODELS,
  OLLAMA_BASE_URL,
  type ModelOption,
  type OllamaConfig
} from '@renderer/lib/llm'
import { isOllamaCloudUrl, resolveBackendUrl } from '@shared/backend-url'
import {
  buildOrchestratorSystemPrompt,
  buildSpecialistContext,
  createSpecialistLogEntry,
  extractOrchestratorContextUpdate,
  mergeSpecialistContext,
  type SpecialistSharedContext
} from '@shared/orchestrator'
import {
  Attachment,
  EnrichedError,
  NormalizedEvent,
  PipelineStage,
  PromptHistoryMessage,
  ProviderContext,
  SandboxHandle,
  SkillMeta,
  TabState,
  TabStatus,
  VibePipelineState,
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

function createInitialPipelineState(): VibePipelineState {
  return {
    stages: [
      {
        id: 'skill_inventory_check',
        label: 'Skill Inventory',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'brainstorm',
        label: 'Brainstorm',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'skill_forge',
        label: 'Skill Forge',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'engineer',
        label: 'Engineer',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'sandbox',
        label: 'Sandbox',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'browser',
        label: 'Browser',
        status: 'pending',
        startedAt: null,
        completedAt: null
      },
      {
        id: 'qa',
        label: 'QA',
        status: 'pending',
        startedAt: null,
        completedAt: null
      }
    ],
    activeStage: null,
    log: [],
    sandboxId: null,
    sandboxUrl: null,
    deliverySummary: null,
    error: null
  }
}

function isPipelineStageId(value: string): value is PipelineStage['id'] {
  return [
    'skill_inventory_check',
    'brainstorm',
    'skill_forge',
    'engineer',
    'sandbox',
    'browser',
    'qa'
  ].includes(value)
}

function updatePipelineStageState(
  pipelineState: VibePipelineState,
  activeStage: PipelineStage['id'] | null,
  stageStatus: PipelineStage['status']
): VibePipelineState {
  const now = Date.now()

  return {
    ...pipelineState,
    activeStage: stageStatus === 'running' ? activeStage : pipelineState.activeStage,
    stages: pipelineState.stages.map((stage) => {
      if (activeStage && stage.id === activeStage) {
        return {
          ...stage,
          status: stageStatus,
          startedAt: stageStatus === 'running' ? (stage.startedAt ?? now) : stage.startedAt,
          completedAt: stageStatus === 'running' ? null : now
        }
      }

      if (activeStage && stageStatus === 'running' && stage.status === 'running') {
        return {
          ...stage,
          status: 'complete',
          completedAt: stage.completedAt ?? now
        }
      }

      return stage
    })
  }
}

function appendPipelineLog(pipelineState: VibePipelineState, line: string): VibePipelineState {
  return {
    ...pipelineState,
    log: [...pipelineState.log, line].slice(-200)
  }
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
  orchestratorEnabledByTab: Record<string, boolean>
  orchestratorContextByTab: Record<string, SpecialistSharedContext | null>
  pipelineStateByTab: Record<string, VibePipelineState>
  pipelineTabId: string | null
  sandboxId: string | null
  sandboxUrl: string | null
  sandboxStatus: SandboxHandle['status'] | null
  pipelineStage: string | null
  pipelineLog: string[]
  pipelineSummary: string | null
  pipelineError: string | null
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
  toggleOrchestratorMode: () => void
  setOrchestratorEnabled: (enabled: boolean, tabId?: string) => void
  startVibePipeline: (prompt: string) => Promise<void>
  stopVibePipeline: () => Promise<void>
  handlePipelineStage: (tabId: string, stage: string) => void
  handlePipelineLog: (tabId: string, line: string) => void
  handleSandboxReady: (tabId: string, url: string) => void
  handlePipelineComplete: (tabId: string, summary: string) => void
  handlePipelineError: (tabId: string, error: string) => void
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
  orchestratorEnabledByTab: { [initialTab.id]: true },
  orchestratorContextByTab: { [initialTab.id]: null },
  pipelineStateByTab: {},
  pipelineTabId: null,
  sandboxId: null,
  sandboxUrl: null,
  sandboxStatus: null,
  pipelineStage: null,
  pipelineLog: [],
  pipelineSummary: null,
  pipelineError: null,
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

  toggleOrchestratorMode: () => {
    const { activeTabId, orchestratorEnabledByTab } = get()
    if (!activeTabId) return
    const current = orchestratorEnabledByTab[activeTabId] ?? true
    get().setOrchestratorEnabled(!current, activeTabId)
  },

  setOrchestratorEnabled: (enabled, tabId) => {
    const targetTabId = tabId || get().activeTabId
    if (!targetTabId) return
    set((state) => ({
      orchestratorEnabledByTab: {
        ...state.orchestratorEnabledByTab,
        [targetTabId]: enabled
      },
      orchestratorContextByTab: enabled
        ? state.orchestratorContextByTab
        : {
            ...state.orchestratorContextByTab,
            [targetTabId]: null
          }
    }))
  },

  startVibePipeline: async (prompt) => {
    const { activeTabId, tabs } = get()
    const tab = tabs.find((item) => item.id === activeTabId)
    if (!activeTabId || !tab) return

    const effectivePrompt = prompt.trim()
    if (!effectivePrompt) return

    let skillInventoryCount = get().installedSkills.length
    try {
      const installedSkills = await window.yald.listSkills()
      skillInventoryCount = installedSkills.length
      set({ installedSkills: sortSkills(installedSkills) })
    } catch {}

    set((state) => {
      const pipelineState = appendPipelineLog(
        updatePipelineStageState(createInitialPipelineState(), 'skill_inventory_check', 'running'),
        `[pipeline] starting`
      )
      const pipelineStateWithSkills = appendPipelineLog(
        pipelineState,
        `[pipeline] skills available ${skillInventoryCount}`
      )

      return {
        pipelineTabId: activeTabId,
        pipelineStage: 'skill_inventory_check',
        pipelineLog: pipelineStateWithSkills.log,
        pipelineSummary: null,
        pipelineError: null,
        sandboxUrl: null,
        sandboxStatus: 'provisioning',
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [activeTabId]: {
            ...pipelineStateWithSkills,
            sandboxId: null,
            sandboxUrl: null
          }
        },
        tabs: state.tabs.map((item) =>
          item.id === activeTabId
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: nextMsgId(),
                    role: 'user' as const,
                    content: effectivePrompt,
                    timestamp: Date.now()
                  }
                ]
              }
            : item
        )
      }
    })

    try {
      const sandbox = await window.yald.sandboxCreate()
      set((state) => {
        const current = state.pipelineStateByTab[activeTabId] ?? createInitialPipelineState()
        const withSandbox = appendPipelineLog(
          appendPipelineLog(
            {
              ...current,
              sandboxId: sandbox.id
            },
            `[pipeline] sandbox created ${sandbox.id}`
          ),
          `[pipeline] using skills inventory from window.yald.listSkills()`
        )

        return {
          sandboxId: sandbox.id,
          sandboxStatus: sandbox.status,
          pipelineLog: withSandbox.log,
          pipelineStateByTab: {
            ...state.pipelineStateByTab,
            [activeTabId]: withSandbox
          }
        }
      })

      await window.yald.runVibePipeline(activeTabId, effectivePrompt, sandbox.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      get().handlePipelineError(activeTabId, message)
    }
  },

  stopVibePipeline: async () => {
    const { pipelineTabId, sandboxId } = get()
    if (pipelineTabId) {
      try {
        await window.yald.stopVibePipeline(pipelineTabId)
      } catch {}
    }
    if (sandboxId) {
      try {
        await window.yald.sandboxDestroy(sandboxId)
      } catch {}
    }
    set((state) => {
      const nextPipelineStateByTab = { ...state.pipelineStateByTab }
      if (pipelineTabId) {
        const current = nextPipelineStateByTab[pipelineTabId] ?? createInitialPipelineState()
        nextPipelineStateByTab[pipelineTabId] = {
          ...current,
          activeStage: null,
          sandboxUrl: null,
          error: current.error,
          log: [...current.log, '[pipeline] stopped'].slice(-200)
        }
      }

      return {
        pipelineStateByTab: nextPipelineStateByTab,
        pipelineTabId: null,
        sandboxId: null,
        sandboxUrl: null,
        sandboxStatus: 'destroyed',
        pipelineStage: null,
        pipelineLog: [],
        pipelineSummary: null,
        pipelineError: null
      }
    })
  },

  handlePipelineStage: (tabId, stage) => {
    set((state) => {
      if (state.pipelineTabId && state.pipelineTabId !== tabId) return state
      const current = state.pipelineStateByTab[tabId] ?? createInitialPipelineState()
      const nextPipelineState = isPipelineStageId(stage)
        ? updatePipelineStageState(current, stage, 'running')
        : current

      return {
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [tabId]: nextPipelineState
        },
        pipelineTabId: tabId,
        pipelineStage: stage,
        pipelineLog: nextPipelineState.log,
        pipelineSummary: nextPipelineState.deliverySummary,
        pipelineError: null,
        sandboxId: nextPipelineState.sandboxId,
        sandboxUrl: nextPipelineState.sandboxUrl,
        sandboxStatus: state.sandboxStatus
      }
    })
  },

  handlePipelineLog: (tabId, line) => {
    set((state) => {
      if (state.pipelineTabId && state.pipelineTabId !== tabId) return state
      const current = state.pipelineStateByTab[tabId] ?? createInitialPipelineState()
      const nextPipelineState = appendPipelineLog(current, line)
      return {
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [tabId]: nextPipelineState
        },
        pipelineTabId: tabId,
        pipelineLog: nextPipelineState.log
      }
    })
  },

  handleSandboxReady: (tabId, url) => {
    set((state) => {
      if (state.pipelineTabId && state.pipelineTabId !== tabId) return state
      const current = state.pipelineStateByTab[tabId] ?? createInitialPipelineState()
      const nextPipelineState = appendPipelineLog(
        {
          ...current,
          sandboxUrl: url
        },
        `[pipeline] sandbox ready ${url}`
      )
      return {
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [tabId]: nextPipelineState
        },
        pipelineTabId: tabId,
        sandboxUrl: url,
        sandboxStatus: 'running',
        pipelineLog: nextPipelineState.log
      }
    })
  },

  handlePipelineComplete: (tabId, summary) => {
    set((state) => {
      if (state.pipelineTabId && state.pipelineTabId !== tabId) return state
      const current = state.pipelineStateByTab[tabId] ?? createInitialPipelineState()
      const activeStage = current.activeStage
      const completedState =
        activeStage && isPipelineStageId(activeStage)
          ? updatePipelineStageState(current, activeStage, 'complete')
          : current
      const nextPipelineState = appendPipelineLog(
        {
          ...completedState,
          activeStage: null,
          deliverySummary: summary
        },
        '[pipeline] complete'
      )
      return {
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [tabId]: nextPipelineState
        },
        pipelineTabId: tabId,
        pipelineStage: null,
        pipelineSummary: summary,
        pipelineLog: nextPipelineState.log
      }
    })

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              messages: [
                ...tab.messages,
                {
                  id: nextMsgId(),
                  role: 'assistant' as const,
                  content: summary,
                  timestamp: Date.now()
                }
              ]
            }
          : tab
      )
    }))
  },

  handlePipelineError: (tabId, error) => {
    set((state) => {
      const current = state.pipelineStateByTab[tabId] ?? createInitialPipelineState()
      const activeStage = current.activeStage
      const failedState =
        activeStage && isPipelineStageId(activeStage)
          ? updatePipelineStageState(current, activeStage, 'failed')
          : current
      const nextPipelineState = appendPipelineLog(
        {
          ...failedState,
          activeStage: null,
          error
        },
        `[pipeline] error ${error}`
      )

      return {
        pipelineStateByTab: {
          ...state.pipelineStateByTab,
          [tabId]: nextPipelineState
        },
        pipelineTabId: tabId,
        pipelineError: error,
        pipelineStage: null,
        pipelineLog: nextPipelineState.log,
        sandboxStatus: state.sandboxStatus === 'destroyed' ? state.sandboxStatus : 'failed'
      }
    })
  },

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
      orchestratorEnabledByTab: {
        ...state.orchestratorEnabledByTab,
        [tabId]: state.orchestratorEnabledByTab[state.activeTabId] ?? true
      },
      orchestratorContextByTab: {
        ...state.orchestratorContextByTab,
        [tabId]: null
      },
      pipelineStateByTab: {
        ...state.pipelineStateByTab,
        [tabId]: createInitialPipelineState()
      },
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
      set((prev) => {
        const pipelineState = prev.pipelineStateByTab[tabId] ?? null
        return {
          activeTabId: tabId,
          settingsOpen: false,
          skillsPanelOpen: false,
          pipelineTabId: pipelineState
            ? tabId
            : prev.pipelineTabId === tabId
              ? tabId
              : prev.pipelineTabId,
          sandboxId: pipelineState?.sandboxId ?? null,
          sandboxUrl: pipelineState?.sandboxUrl ?? null,
          sandboxStatus: pipelineState?.error
            ? 'failed'
            : pipelineState?.sandboxUrl
              ? 'running'
              : pipelineState?.sandboxId
                ? 'provisioning'
                : null,
          pipelineStage: pipelineState?.activeStage ?? null,
          pipelineLog: pipelineState?.log ?? [],
          pipelineSummary: pipelineState?.deliverySummary ?? null,
          pipelineError: pipelineState?.error ?? null,
          tabs: prev.tabs.map((tab) => (tab.id === tabId ? { ...tab, hasUnread: false } : tab))
        }
      })
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
    const { activeTabId, tabs, visionTabId, pipelineTabId } = get()
    if (tabs.length <= 1) return

    window.yald.closeTab(tabId).catch(() => {})
    if (visionTabId === tabId) {
      void get().stopVision()
    }
    if (pipelineTabId === tabId) {
      void get().stopVibePipeline()
    }

    const remaining = tabs.filter((tab) => tab.id !== tabId)
    const closedIndex = tabs.findIndex((tab) => tab.id === tabId)
    const fallbackTab = remaining[Math.max(0, closedIndex - 1)] || remaining[0]

    const nextOrchestratorEnabledByTab = Object.fromEntries(
      Object.entries(get().orchestratorEnabledByTab).filter(([key]) => key !== tabId)
    )
    const nextOrchestratorContextByTab = Object.fromEntries(
      Object.entries(get().orchestratorContextByTab).filter(([key]) => key !== tabId)
    )
    const nextPipelineStateByTab = Object.fromEntries(
      Object.entries(get().pipelineStateByTab).filter(([key]) => key !== tabId)
    )

    set({
      tabs: remaining,
      activeTabId: activeTabId === tabId ? fallbackTab.id : activeTabId,
      orchestratorEnabledByTab: nextOrchestratorEnabledByTab,
      orchestratorContextByTab: nextOrchestratorContextByTab,
      pipelineStateByTab: nextPipelineStateByTab
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
    const {
      activeTabId,
      tabs,
      staticInfo,
      preferredModel,
      ollamaConfig,
      selectedSkillIds,
      installedSkills,
      orchestratorEnabledByTab
    } = get()
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
    const effectivePrompt = prompt || 'See attached files'
    const orchestratorEnabled = orchestratorEnabledByTab[activeTabId] ?? true
    const orchestratorContext = orchestratorEnabled
      ? buildSpecialistContext({
          taskId: requestId,
          userPrompt: effectivePrompt,
          installedSkills,
          workingDirectory: resolvedPath,
          projectPath: staticInfo?.projectPath
        })
      : null
    if (orchestratorEnabled && orchestratorContext?.intent === 'vibe_code') {
      void get().startVibePipeline(effectivePrompt)
      return
    }
    const systemPrompt =
      orchestratorEnabled && orchestratorContext
        ? buildOrchestratorSystemPrompt(orchestratorContext)
        : undefined

    const title =
      tab.messages.length === 0
        ? effectivePrompt.length > 30
          ? `${effectivePrompt.substring(0, 27)}...`
          : effectivePrompt
        : tab.title

    set((state) => ({
      orchestratorContextByTab:
        orchestratorEnabled && orchestratorContext
          ? {
              ...state.orchestratorContextByTab,
              [activeTabId]: {
                ...orchestratorContext,
                log: [
                  ...orchestratorContext.log,
                  createSpecialistLogEntry(
                    'orchestrator',
                    'info',
                    'prompt_dispatched',
                    {
                      tabId: activeTabId,
                      attachmentCount: tab.attachments.length,
                      selectedSkillIds
                    },
                    orchestratorContext.confidence
                  )
                ]
              }
            }
          : state.orchestratorContextByTab,
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
            queuedPrompts: [...withEffectiveBase.queuedPrompts, effectivePrompt]
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
            {
              id: nextMsgId(),
              role: 'user' as const,
              content: effectivePrompt,
              timestamp: Date.now()
            }
          ]
        }
      })
    }))

    void window.yald
      .prompt(activeTabId, requestId, {
        prompt: effectivePrompt,
        projectPath: resolvedPath,
        sessionId: tab.claudeSessionId || undefined,
        model: providerContext.model,
        addDirs: tab.additionalDirs,
        skillIds: selectedSkillIds,
        provider: providerContext,
        history: toPromptHistory(tab.messages),
        attachments: tab.attachments,
        systemPrompt
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
      let nextOrchestratorContextByTab = state.orchestratorContextByTab
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
            const lastAssistantIndex = (() => {
              for (let i = updated.messages.length - 1; i >= 0; i -= 1) {
                if (updated.messages[i].role === 'assistant' && !updated.messages[i].toolName) {
                  return i
                }
              }
              return -1
            })()
            const specialistContext = state.orchestratorContextByTab[tabId]
            if (specialistContext && lastAssistantIndex !== -1) {
              const lastAssistant = updated.messages[lastAssistantIndex]
              const parsed = extractOrchestratorContextUpdate(lastAssistant.content)
              if (parsed.cleanedText !== lastAssistant.content) {
                updated.messages = [
                  ...updated.messages.slice(0, lastAssistantIndex),
                  {
                    ...lastAssistant,
                    content: parsed.cleanedText
                  },
                  ...updated.messages.slice(lastAssistantIndex + 1)
                ]
              }
              nextOrchestratorContextByTab = {
                ...nextOrchestratorContextByTab,
                [tabId]: mergeSpecialistContext(specialistContext, parsed.update)
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

      return {
        tabs,
        orchestratorContextByTab: nextOrchestratorContextByTab
      }
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
      orchestratorContextByTab: state.orchestratorContextByTab[tabId]
        ? {
            ...state.orchestratorContextByTab,
            [tabId]: {
              ...state.orchestratorContextByTab[tabId]!,
              log: [
                ...state.orchestratorContextByTab[tabId]!.log,
                createSpecialistLogEntry(
                  'orchestrator',
                  'error',
                  'run_failed',
                  {
                    message: error.message,
                    exitCode: error.exitCode,
                    elapsedMs: error.elapsedMs
                  },
                  state.orchestratorContextByTab[tabId]!.confidence
                )
              ]
            }
          }
        : state.orchestratorContextByTab,
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
