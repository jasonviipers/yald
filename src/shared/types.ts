import type React from 'react'

export type ProviderID = 'ollama'

export interface ProviderContext {
  providerId: ProviderID
  model: string
  baseUrl?: string
  apiKey?: string
  transport?: 'api' | 'livekit'
}

export interface PromptHistoryMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface VoiceStyle {
  preset?: 'natural' | 'fast' | 'warm'
  rate?: number
  pitch?: number
  volume?: number
}

export interface VoiceLatencyMetrics {
  sttMs?: number
  firstTokenMs?: number
  firstAudioMs?: number
  totalMs?: number
}

export interface VoiceTurnRequest {
  tabId: string
  audioBase64: string
  provider: ProviderContext
  history?: PromptHistoryMessage[]
  voice?: VoiceStyle
}

export type ShortcutCommand = 'new_tab' | 'toggle_settings' | 'toggle_voice'

export type VisionActionName =
  | 'none'
  | 'create_tab'
  | 'toggle_settings'
  | 'toggle_voice'
  | 'hide_window'
  | 'move_left'
  | 'move_right'
  | 'move_up'
  | 'move_down'

export type VisionSessionState = 'idle' | 'starting' | 'observing' | 'error'

export interface VisionStartRequest {
  tabId: string
  provider: ProviderContext
  intervalMs?: number
  autoAct?: boolean
  prompt?: string
}

export interface VisionFeedback {
  summary: string
  guidance: string
  confidence: 'low' | 'medium' | 'high'
  suggestedAction: VisionActionName
  actionReason?: string
  appliedAction?: VisionActionName
  observedAt: number
  iteration: number
  model: string
}

export type VisionEvent =
  | {
      type: 'state'
      tabId?: string
      state: VisionSessionState
      message?: string
    }
  | {
      type: 'feedback'
      tabId: string
      feedback: VisionFeedback
    }
  | {
      type: 'error'
      tabId?: string
      message: string
      recoverable?: boolean
    }

export type VoiceSessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

// ─── Marketplace / Plugin Types ───

export type PluginStatus = 'not_installed' | 'checking' | 'installing' | 'installed' | 'failed'

export interface CatalogPlugin {
  id: string // unique: `${repo}/${skillPath}` e.g. 'anthropics/skills/skills/xlsx'
  name: string // from SKILL.md or plugin.json
  description: string // from SKILL.md or plugin.json
  version: string // from plugin.json or '0.0.0'
  author: string // from plugin.json or marketplace entry
  marketplace: string // marketplace name from marketplace.json
  repo: string // 'anthropics/skills'
  sourcePath: string // path within repo, e.g. 'skills/xlsx'
  installName: string // individual skill name for SKILL.md skills, bundle name for CLI plugins
  category: string // 'Agent Skills' | 'Knowledge Work' | 'Financial Services'
  tags: string[] // Semantic use-case tags derived from name/description (e.g. 'Design', 'Finance')
  isSkillMd: boolean // true = individual SKILL.md (direct install), false = CLI plugin (bundle install)
}

export interface SessionMeta {
  sessionId: string
  slug?: string
  firstMessage?: string
  lastTimestamp: string
  size: number
  projectPath?: string
}

export type VoiceEvent =
  | {
      type: 'state'
      tabId: string
      state: VoiceSessionState
      message?: string
    }
  | {
      type: 'transcript'
      tabId: string
      text: string
      isFinal: boolean
    }
  | {
      type: 'assistant_text'
      tabId: string
      text: string
      isFinal: boolean
      fullText?: string
    }
  | {
      type: 'audio_chunk'
      tabId: string
      chunkId: string
      audioBase64: string
      mimeType: string
      text: string
      isFinal: boolean
    }
  | {
      type: 'metrics'
      tabId: string
      metrics: VoiceLatencyMetrics
    }
  | {
      type: 'error'
      tabId: string
      message: string
      recoverable?: boolean
    }

export interface SlashCommand {
  command: string
  description: string
  icon: React.ReactNode
}
export interface InitEvent {
  type: 'system'
  subtype: 'init'
  cwd: string
  session_id: string
  tools: string[]
  mcp_servers: Array<{ name: string; status: string }>
  model: string
  permissionMode: string
  agents: string[]
  skills: string[]
  plugins: string[]
  claude_code_version: string
  fast_mode_state: string
  uuid: string
}

export interface StreamEvent {
  type: 'stream_event'
  event: StreamSubEvent
  session_id: string
  parent_tool_use_id: string | null
  uuid: string
}

export type StreamSubEvent =
  | { type: 'message_start'; message: AssistantMessagePayload }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: ContentDelta }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta'
      delta: { stop_reason: string | null }
      usage: UsageData
      context_management?: unknown
    }
  | { type: 'message_stop' }

export interface ContentBlock {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

export type ContentDelta =
  | { type: 'text_delta'; text: string }
  | { type: 'input_json_delta'; partial_json: string }

export interface AssistantEvent {
  type: 'assistant'
  message: AssistantMessagePayload
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

export interface AssistantMessagePayload {
  model: string
  id: string
  role: 'assistant'
  content: ContentBlock[]
  stop_reason: string | null
  usage: UsageData
}

export interface RateLimitEvent {
  type: 'rate_limit_event'
  rate_limit_info: {
    status: string
    resetsAt: number
    rateLimitType: string
  }
  session_id: string
  uuid: string
}

export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error'
  is_error: boolean
  duration_ms: number
  num_turns: number
  result: string
  total_cost_usd: number
  session_id: string
  usage: UsageData & {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  permission_denials: string[]
  uuid: string
}

export interface UsageData {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  service_tier?: string
}

export interface PermissionEvent {
  type: 'permission_request'
  tool: { name: string; description?: string; input?: Record<string, unknown> }
  question_id: string
  options: Array<{ id: string; label: string; kind?: string }>
  session_id: string
  uuid: string
}

// Union of all possible top-level events
export type ClaudeEvent =
  | InitEvent
  | StreamEvent
  | AssistantEvent
  | RateLimitEvent
  | ResultEvent
  | PermissionEvent
  | UnknownEvent

export interface UnknownEvent {
  type: string
  [key: string]: unknown
}

export type TabStatus = 'connecting' | 'idle' | 'running' | 'completed' | 'failed' | 'dead'

export interface PermissionRequest {
  questionId: string
  toolTitle: string
  toolDescription?: string
  toolInput?: Record<string, unknown>
  options: Array<{ optionId: string; kind?: string; label: string }>
}

export interface Attachment {
  id: string
  type: 'image' | 'file'
  name: string
  path: string
  mimeType?: string
  /** Base64 data URL for image previews */
  dataUrl?: string
  /** File size in bytes */
  size?: number
}

export interface SkillMeta {
  id: string
  name: string
  description: string
  installedAt: number
  marketplacePluginId?: string
  installName?: string
  repo?: string
  sourcePath?: string
  marketplace?: string
}

export interface TabState {
  id: string
  claudeSessionId: string | null
  sessionProviderId: ProviderID | null
  sessionTransport: 'api' | null
  status: TabStatus
  activeRequestId: string | null
  hasUnread: boolean
  currentActivity: string
  attachments: Attachment[]
  messages: Message[]
  title: string
  /** Last run's result data (cost, tokens, duration) */
  lastResult: RunResult | null
  /** Session metadata from init event */
  sessionModel: string | null
  sessionTools: string[]
  sessionMcpServers: Array<{ name: string; status: string }>
  sessionSkills: string[]
  sessionVersion: string | null
  permissionQueue: PermissionRequest[]
  permissionDenied: { tools: Array<{ toolName: string; toolUseId: string }> } | null
  /** Prompts waiting behind the current run (display text only) */
  queuedPrompts: string[]
  /** Working directory for this tab's session */
  workingDirectory: string
  /** Whether the user explicitly chose a directory (vs. using default home) */
  hasChosenDirectory: boolean
  /** Extra directories accessible via --add-dir (session-preserving) */
  additionalDirs: string[]
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolName?: string
  toolInput?: string
  toolStatus?: 'running' | 'completed' | 'error'
  timestamp: number
}

export interface RunResult {
  totalCostUsd: number
  durationMs: number
  numTurns: number
  usage: UsageData
  sessionId: string
}

// ─── Canonical Events (normalized from raw stream) ───

export type NormalizedEvent =
  | {
      type: 'session_init'
      sessionId: string
      tools: string[]
      model: string
      providerId?: ProviderID
      transport?: 'api'
      mcpServers: Array<{ name: string; status: string }>
      skills: string[]
      version: string
      isWarmup?: boolean
    }
  | { type: 'text_chunk'; text: string }
  | { type: 'tool_call'; toolName: string; toolId: string; index: number }
  | { type: 'tool_call_update'; toolId: string; partialInput: string }
  | { type: 'tool_call_complete'; index: number }
  | { type: 'task_update'; message: AssistantMessagePayload }
  | {
      type: 'task_complete'
      result: string
      costUsd: number
      durationMs: number
      numTurns: number
      usage: UsageData
      sessionId: string
      permissionDenials?: Array<{ toolName: string; toolUseId: string }>
    }
  | { type: 'error'; message: string; isError: boolean; sessionId?: string }
  | { type: 'session_dead'; exitCode: number | null; signal: string | null; stderrTail: string[] }
  | { type: 'rate_limit'; status: string; resetsAt: number; rateLimitType: string }
  | { type: 'usage'; usage: UsageData }
  | {
      type: 'permission_request'
      questionId: string
      toolName: string
      toolDescription?: string
      toolInput?: Record<string, unknown>
      options: Array<{ id: string; label: string; kind?: string }>
    }

// ─── Run Options ───

export interface RunOptions {
  prompt: string
  projectPath: string
  sessionId?: string
  allowedTools?: string[]
  maxTurns?: number
  maxBudgetUsd?: number
  systemPrompt?: string
  model?: string
  hookSettingsPath?: string
  /** Extra directories to add via --add-dir (session-preserving) */
  addDirs?: string[]
  skillIds?: string[]
  provider?: ProviderContext
  history?: PromptHistoryMessage[]
  attachments?: Attachment[]
}

// ─── Control Plane Types ───

export interface TabRegistryEntry {
  tabId: string
  claudeSessionId: string | null
  status: TabStatus
  activeRequestId: string | null
  runPid: number | null
  createdAt: number
  lastActivityAt: number
  promptCount: number
}

export interface HealthReport {
  tabs: Array<{
    tabId: string
    status: TabStatus
    activeRequestId: string | null
    claudeSessionId: string | null
    alive: boolean
  }>
  queueDepth: number
}

export interface EnrichedError {
  message: string
  stderrTail: string[]
  stdoutTail?: string[]
  exitCode: number | null
  elapsedMs: number
  toolCallCount: number
  sawPermissionRequest?: boolean
  permissionDenials?: Array<{ tool_name: string; tool_use_id: string }>
}

// ─── Session History ───

// ─── IPC Channel Names ───

export const IPC = {
  // Request-response (renderer → main)
  START: 'yald:start',
  CREATE_TAB: 'yald:create-tab',
  PROMPT: 'yald:prompt',
  CANCEL: 'yald:cancel',
  STOP_TAB: 'yald:stop-tab',
  RETRY: 'yald:retry',
  STATUS: 'yald:status',
  TAB_HEALTH: 'yald:tab-health',
  CLOSE_TAB: 'yald:close-tab',
  SELECT_DIRECTORY: 'yald:select-directory',
  OPEN_EXTERNAL: 'yald:open-external',
  ATTACH_FILES: 'yald:attach-files',
  TAKE_SCREENSHOT: 'yald:take-screenshot',
  VISION_START: 'yald:vision-start',
  VISION_STOP: 'yald:vision-stop',
  TRANSCRIBE_AUDIO: 'yald:transcribe-audio',
  VOICE_PROCESS_TURN: 'yald:voice-process-turn',
  VOICE_CANCEL: 'yald:voice-cancel',
  PASTE_IMAGE: 'yald:paste-image',
  GET_DIAGNOSTICS: 'yald:get-diagnostics',
  LIST_SKILLS: 'yald:list-skills',
  INSTALL_SKILL: 'yald:install-skill',
  UNINSTALL_SKILL: 'yald:uninstall-skill',
  FETCH_MARKETPLACE: 'yald:fetch-marketplace',
  INSTALL_MARKETPLACE_SKILL: 'yald:install-marketplace-skill',
  UNINSTALL_MARKETPLACE_SKILL: 'yald:uninstall-marketplace-skill',
  LIST_SESSIONS: 'yald:list-sessions',
  RESPOND_PERMISSION: 'yald:respond-permission',
  ANIMATE_HEIGHT: 'yald:animate-height',

  // One-way events (main → renderer)
  TEXT_CHUNK: 'yald:text-chunk',
  TOOL_CALL: 'yald:tool-call',
  TOOL_CALL_UPDATE: 'yald:tool-call-update',
  TOOL_CALL_COMPLETE: 'yald:tool-call-complete',
  TASK_UPDATE: 'yald:task-update',
  TASK_COMPLETE: 'yald:task-complete',
  SESSION_DEAD: 'yald:session-dead',
  SESSION_INIT: 'yald:session-init',
  ERROR: 'yald:error',
  RATE_LIMIT: 'yald:rate-limit',
  VOICE_EVENT: 'yald:voice-event',
  VISION_EVENT: 'yald:vision-event',
  SHORTCUT_COMMAND: 'yald:shortcut-command',

  // Window management
  RESIZE_HEIGHT: 'yald:resize-height',
  SET_WINDOW_WIDTH: 'yald:set-window-width',
  HIDE_WINDOW: 'yald:hide-window',
  WINDOW_SHOWN: 'yald:window-shown',
  SET_IGNORE_MOUSE_EVENTS: 'yald:set-ignore-mouse-events',
  IS_VISIBLE: 'yald:is-visible',

  // Theme
  GET_THEME: 'yald:get-theme',
  THEME_CHANGED: 'yald:theme-changed',

  // Legacy (kept for backward compat during migration)
  STREAM_EVENT: 'yald:stream-event',
  RUN_COMPLETE: 'yald:run-complete',
  RUN_ERROR: 'yald:run-error'
} as const
