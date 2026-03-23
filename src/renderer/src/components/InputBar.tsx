import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MicrophoneIcon, ArrowUpIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react'
import { resolveProviderContext, useSessionStore } from '../stores/sessionStore'
import { AttachmentChips } from './AttachmentChips'
import { SlashCommandMenu } from './SlashCommandMenu'
import { AVAILABLE_MODELS } from '../lib/llm'
import { useColors } from '../lib/theme'
import { useRealtimeVoice } from '../hooks/useRealtimeVoice'
import { getFilteredCommandsWithExtras, type SlashCommand } from '../lib/slash-commands'

const INPUT_MIN_HEIGHT = 20
const INPUT_MAX_HEIGHT = 140
const MULTILINE_ENTER_HEIGHT = 52
const MULTILINE_EXIT_HEIGHT = 50
const INLINE_CONTROLS_RESERVED_WIDTH = 104

const BASE_COMMANDS: SlashCommand[] = [
  {
    command: '/clear',
    description: 'Clear conversation history',
    icon: <span style={{ fontSize: 10 }}>✕</span>
  },
  {
    command: '/cost',
    description: 'Show token and duration info',
    icon: <span style={{ fontSize: 10 }}>$</span>
  },
  {
    command: '/skills',
    description: 'Show installed agent skills',
    icon: <span style={{ fontSize: 10 }}>✦</span>
  },
  {
    command: '/model',
    description: 'Show or switch Ollama model',
    icon: <span style={{ fontSize: 10 }}>⌘</span>
  },
  {
    command: '/orchestrator',
    description: 'Toggle specialist orchestrator mode',
    icon: <span style={{ fontSize: 10 }}>◎</span>
  },
  {
    command: '/vibe',
    description: 'Run the vibe code pipeline',
    icon: <span style={{ fontSize: 10 }}>⚡</span>
  },
  {
    command: '/sandbox',
    description: 'Inspect or stop the active sandbox',
    icon: <span style={{ fontSize: 10 }}>□</span>
  },
  {
    command: '/pipeline',
    description: 'Inspect the current pipeline log',
    icon: <span style={{ fontSize: 10 }}>▸</span>
  },
  {
    command: '/help',
    description: 'Show available commands',
    icon: <span style={{ fontSize: 10 }}>?</span>
  }
]

export function InputBar() {
  const [input, setInput] = useState('')
  const [slashFilter, setSlashFilter] = useState<string | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [isMultiLine, setIsMultiLine] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLTextAreaElement | null>(null)

  const sendMessage = useSessionStore((state) => state.sendMessage)
  const clearTab = useSessionStore((state) => state.clearTab)
  const addSystemMessage = useSessionStore((state) => state.addSystemMessage)
  const addAttachments = useSessionStore((state) => state.addAttachments)
  const removeAttachment = useSessionStore((state) => state.removeAttachment)
  const setPreferredModel = useSessionStore((state) => state.setPreferredModel)
  const setOrchestratorEnabled = useSessionStore((state) => state.setOrchestratorEnabled)
  const startVibePipeline = useSessionStore((state) => state.startVibePipeline)
  const stopVibePipeline = useSessionStore((state) => state.stopVibePipeline)
  const preferredModel = useSessionStore((state) => state.preferredModel)
  const ollamaConfig = useSessionStore((state) => state.ollamaConfig)
  const installedSkills = useSessionStore((state) => state.installedSkills)
  const orchestratorEnabled = useSessionStore(
    (state) => state.orchestratorEnabledByTab[state.activeTabId] ?? true
  )
  const orchestratorContext = useSessionStore(
    (state) => state.orchestratorContextByTab[state.activeTabId] || null
  )
  const pipelineState = useSessionStore(
    (state) => state.pipelineStateByTab[state.activeTabId] || null
  )
  const voiceShortcutNonce = useSessionStore((state) => state.voiceShortcutNonce)
  const activeTabId = useSessionStore((state) => state.activeTabId)
  const tab = useSessionStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
  const colors = useColors()

  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'
  const isConnecting = tab?.status === 'connecting'
  const hasContent = input.trim().length > 0 || (tab?.attachments?.length ?? 0) > 0
  const canSend = Boolean(tab) && !isConnecting && hasContent
  const attachments = tab?.attachments || []
  const showSlashMenu = slashFilter !== null && !isConnecting
  const currentProvider = resolveProviderContext(preferredModel, ollamaConfig)

  const voice = useRealtimeVoice({
    tabId: activeTabId || null,
    tabMessages: tab?.messages || [],
    provider: currentProvider
  })
  const { clearVoiceError, toggleVoice } = voice

  useEffect(() => {
    textareaRef.current?.focus()
  }, [activeTabId])
  useEffect(() => {
    const unsub = window.yald.onWindowShown(() => {
      textareaRef.current?.focus()
    })
    return unsub
  }, [])
  useEffect(() => {
    if (voiceShortcutNonce === 0) return
    clearVoiceError()
    toggleVoice()
  }, [clearVoiceError, toggleVoice, voiceShortcutNonce])

  const measureInlineHeight = useCallback((value: string): number => {
    if (typeof document === 'undefined') return 0
    if (!measureRef.current) {
      const measure = document.createElement('textarea')
      measure.setAttribute('aria-hidden', 'true')
      measure.tabIndex = -1
      Object.assign(measure.style, {
        position: 'absolute',
        top: '-99999px',
        left: '0',
        height: '0',
        minHeight: '0',
        overflow: 'hidden',
        visibility: 'hidden',
        pointerEvents: 'none',
        zIndex: '-1',
        resize: 'none',
        border: '0',
        outline: '0',
        boxSizing: 'border-box'
      })
      document.body.appendChild(measure)
      measureRef.current = measure
    }
    const measure = measureRef.current
    const hostWidth = wrapperRef.current?.clientWidth ?? 0
    const inlineWidth = Math.max(120, hostWidth - INLINE_CONTROLS_RESERVED_WIDTH)
    Object.assign(measure.style, {
      width: `${inlineWidth}px`,
      fontSize: '13.5px',
      lineHeight: '20px',
      paddingTop: '15px',
      paddingBottom: '15px',
      paddingLeft: '0',
      paddingRight: '0'
    })
    const computed = textareaRef.current ? window.getComputedStyle(textareaRef.current) : null
    if (computed) {
      measure.style.fontFamily = computed.fontFamily
      measure.style.letterSpacing = computed.letterSpacing
      measure.style.fontWeight = computed.fontWeight
    }
    measure.value = value || ' '
    return measure.scrollHeight
  }, [])

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `${INPUT_MIN_HEIGHT}px`
    const naturalHeight = el.scrollHeight
    const clampedHeight = Math.min(naturalHeight, INPUT_MAX_HEIGHT)
    el.style.height = `${clampedHeight}px`
    el.style.overflowY = naturalHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
    if (naturalHeight <= INPUT_MAX_HEIGHT) el.scrollTop = 0
    const inlineHeight = measureInlineHeight(input)
    setIsMultiLine((prev) =>
      prev ? inlineHeight > MULTILINE_EXIT_HEIGHT : inlineHeight > MULTILINE_ENTER_HEIGHT
    )
  }, [input, measureInlineHeight])

  useLayoutEffect(() => {
    autoResize()
  }, [autoResize, input, isMultiLine])
  useEffect(() => {
    return () => {
      if (measureRef.current) {
        measureRef.current.remove()
        measureRef.current = null
      }
    }
  }, [])

  const updateSlashFilter = useCallback((value: string) => {
    const match = value.match(/^(\/[a-zA-Z-]*)$/)
    if (match) {
      setSlashFilter(match[1])
      setSlashIndex(0)
    } else {
      setSlashFilter(null)
    }
  }, [])

  const executeCommand = useCallback(
    (cmd: SlashCommand) => {
      switch (cmd.command) {
        case '/clear':
          clearTab()
          addSystemMessage('Conversation cleared.')
          break
        case '/cost': {
          if (tab?.lastResult) {
            const r = tab.lastResult
            addSystemMessage(
              [
                `$${r.totalCostUsd.toFixed(4)}`,
                `${(r.durationMs / 1000).toFixed(1)}s`,
                `${r.numTurns} turn${r.numTurns !== 1 ? 's' : ''}`,
                ...(r.usage.input_tokens
                  ? [
                      `${r.usage.input_tokens.toLocaleString()} in / ${(r.usage.output_tokens || 0).toLocaleString()} out`
                    ]
                  : [])
              ].join(' · ')
            )
          } else {
            addSystemMessage('No run data yet. Send a message first.')
          }
          break
        }
        case '/model': {
          const current =
            preferredModel || tab?.sessionModel || AVAILABLE_MODELS[0]?.id || 'unknown'
          addSystemMessage(
            `Ollama Cloud models\n\n${AVAILABLE_MODELS.map((m) => `  ${m.id === current ? '●' : '○'} ${m.label} (${m.id})`).join('\n')}\n\nSwitch: /model <n>`
          )
          break
        }
        case '/skills':
          addSystemMessage(
            installedSkills.length === 0
              ? 'No skills installed. Open Skills to install one.'
              : `Installed skills\n\n${installedSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`
          )
          break
        case '/orchestrator':
          addSystemMessage(
            orchestratorContext
              ? `Orchestrator ${orchestratorEnabled ? 'enabled' : 'disabled'}\n\nintent: ${orchestratorContext.intent}\nconfidence: ${orchestratorContext.confidence}\nsubtasks: ${orchestratorContext.plan.subtasks.length}`
              : `Orchestrator ${orchestratorEnabled ? 'enabled' : 'disabled'}`
          )
          break
        case '/vibe':
          addSystemMessage('Usage: /vibe <prompt>')
          break
        case '/sandbox':
          addSystemMessage('Usage: /sandbox status or /sandbox stop')
          break
        case '/pipeline':
          addSystemMessage('Usage: /pipeline log')
          break
        case '/help':
          addSystemMessage(
            BASE_COMMANDS.map((command) => `${command.command} — ${command.description}`).join('\n')
          )
          break
      }
    },
    [
      addSystemMessage,
      clearTab,
      installedSkills,
      orchestratorContext,
      orchestratorEnabled,
      pipelineState,
      preferredModel,
      tab
    ]
  )

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput('')
      setSlashFilter(null)
      executeCommand(cmd)
    },
    [executeCommand]
  )

  const handleSend = useCallback(async () => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter || '', BASE_COMMANDS)
      if (filtered.length > 0) {
        handleSlashSelect(filtered[slashIndex])
        return
      }
    }
    const prompt = input.trim()
    const modelMatch = prompt.match(/^\/model\s+(\S+)/i)
    const orchestratorMatch = prompt.match(/^\/orchestrator(?:\s+(on|off|status))?$/i)
    const vibeMatch = prompt.match(/^\/vibe(?:\s+([\s\S]+))?$/i)
    const sandboxMatch = prompt.match(/^\/sandbox(?:\s+(status|stop))?$/i)
    const pipelineMatch = prompt.match(/^\/pipeline(?:\s+(log))?$/i)

    if (modelMatch) {
      const q = modelMatch[1].toLowerCase()
      const match = AVAILABLE_MODELS.find(
        (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
      )
      setInput('')
      setSlashFilter(null)
      if (match) {
        setPreferredModel(match.id)
        addSystemMessage(`Model switched to ${match.label}`)
      } else {
        addSystemMessage(`Unknown model "${modelMatch[1]}".`)
      }
      return
    }
    if (orchestratorMatch) {
      const action = (orchestratorMatch[1] || 'status').toLowerCase()
      setInput('')
      setSlashFilter(null)
      if (action === 'on') {
        setOrchestratorEnabled(true)
        addSystemMessage('Orchestrator enabled.')
      } else if (action === 'off') {
        setOrchestratorEnabled(false)
        addSystemMessage('Orchestrator disabled.')
      } else executeCommand({ command: '/orchestrator', description: '', icon: null })
      return
    }
    if (vibeMatch) {
      const vibePrompt = (vibeMatch[1] || '').trim()
      setInput('')
      setSlashFilter(null)
      if (!vibePrompt) {
        executeCommand({ command: '/vibe', description: '', icon: null })
        return
      }
      await startVibePipeline(vibePrompt)
      return
    }
    if (sandboxMatch) {
      const action = (sandboxMatch[1] || 'status').toLowerCase()
      setInput('')
      setSlashFilter(null)
      if (action === 'stop') {
        await stopVibePipeline()
        addSystemMessage('Sandbox stopped.')
        return
      }
      if (!pipelineState?.sandboxId) {
        addSystemMessage('No active sandbox.')
        return
      }
      let resourceLine = 'resource usage unavailable'
      try {
        const logs = await window.yald.sandboxGetLogs(pipelineState.sandboxId)
        const m = [...logs.matchAll(/\[resource\]\s+rss=(\d+)/g)].at(-1)
        if (m?.[1]) resourceLine = `rss ${(Number(m[1]) / (1024 * 1024)).toFixed(1)} MB`
      } catch {}
      addSystemMessage(
        [
          `sandbox id: ${pipelineState.sandboxId}`,
          `status: ${pipelineState.error ? 'failed' : pipelineState.sandboxUrl ? 'running' : 'provisioning'}`,
          `url: ${pipelineState.sandboxUrl || 'not exposed yet'}`,
          `resource: ${resourceLine}`
        ].join('\n')
      )
      return
    }
    if (pipelineMatch) {
      setInput('')
      setSlashFilter(null)
      addSystemMessage(
        !pipelineState || pipelineState.log.length === 0
          ? 'No pipeline log.'
          : `Pipeline log\n\n${pipelineState.log.join('\n')}`
      )
      return
    }
    if (!prompt && attachments.length === 0) return
    if (isConnecting) return
    setInput('')
    setSlashFilter(null)
    if (textareaRef.current) textareaRef.current.style.height = `${INPUT_MIN_HEIGHT}px`
    sendMessage(prompt || 'See attached files')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [
    addSystemMessage,
    attachments.length,
    handleSlashSelect,
    input,
    isConnecting,
    pipelineState,
    sendMessage,
    startVibePipeline,
    setOrchestratorEnabled,
    setPreferredModel,
    showSlashMenu,
    slashFilter,
    slashIndex,
    stopVibePipeline
  ])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter || '', BASE_COMMANDS)
      if (event.key === 'ArrowDown' && filtered.length > 0) {
        event.preventDefault()
        setSlashIndex((i) => (i + 1) % filtered.length)
        return
      }
      if (event.key === 'ArrowUp' && filtered.length > 0) {
        event.preventDefault()
        setSlashIndex((i) => (i - 1 + filtered.length) % filtered.length)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (filtered.length > 0) handleSlashSelect(filtered[slashIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashFilter(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
    if (event.key === 'Escape' && !showSlashMenu) window.yald.hideWindow()
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    setInput(value)
    updateSlashFilter(value)
  }

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent) => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          const blob = item.getAsFile()
          if (!blob) return
          const reader = new FileReader()
          reader.onload = async () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : ''
            const attachment = await window.yald.pasteImage(dataUrl)
            if (attachment) addAttachments([attachment])
          }
          reader.readAsDataURL(blob)
          return
        }
      }
    },
    [addAttachments]
  )

  const placeholder = isConnecting
    ? 'Connecting…'
    : voice.isActive && voice.voiceState === 'listening'
      ? 'Listening…'
      : voice.isActive && voice.voiceState === 'transcribing'
        ? 'Transcribing…'
        : voice.isActive && voice.voiceState === 'thinking'
          ? 'Thinking…'
          : voice.isActive && voice.voiceState === 'speaking'
            ? 'Speaking… interrupt anytime'
            : isBusy
              ? 'Queue a message…'
              : 'Ask anything…'

  // ─── Shared button styles ───
  const actionBtnStyle = {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s'
  } as const

  return (
    <div ref={wrapperRef} data-yald-ui className="flex flex-col w-full relative">
      <AnimatePresence>
        {showSlashMenu && (
          <SlashCommandMenu
            filter={slashFilter || ''}
            selectedIndex={slashIndex}
            onSelect={handleSlashSelect}
            anchorRect={wrapperRef.current?.getBoundingClientRect() ?? null}
            extraCommands={BASE_COMMANDS}
          />
        )}
      </AnimatePresence>

      {attachments.length > 0 && (
        <div style={{ paddingTop: 6, marginLeft: -4 }}>
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      <div className="w-full" style={{ minHeight: 50 }}>
        {isMultiLine ? (
          <div className="w-full">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              rows={1}
              className="w-full bg-transparent resize-none"
              style={{
                fontSize: 13.5,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 11,
                paddingBottom: 2,
                letterSpacing: '-0.012em'
              }}
            />
            <div className="flex items-center justify-end gap-1" style={{ paddingBottom: 6 }}>
              <VoiceButtons
                isActive={voice.isActive}
                voiceState={voice.voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={() => {
                  voice.clearVoiceError()
                  voice.toggleVoice()
                }}
              />
              <AnimatePresence>
                {canSend && !voice.isActive && (
                  <motion.div
                    key="send"
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.1 }}
                  >
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      style={{
                        ...actionBtnStyle,
                        background: colors.sendBg,
                        color: colors.textOnAccent
                      }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = colors.sendHover
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = colors.sendBg
                      }}
                    >
                      <ArrowUpIcon size={15} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex items-center w-full" style={{ minHeight: 50 }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={placeholder}
              rows={1}
              className="flex-1 bg-transparent resize-none"
              style={{
                fontSize: 13.5,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 15,
                paddingBottom: 15,
                letterSpacing: '-0.012em'
              }}
            />
            <div className="flex items-center gap-1 shrink-0 ml-1.5">
              <VoiceButtons
                isActive={voice.isActive}
                voiceState={voice.voiceState}
                isConnecting={isConnecting}
                colors={colors}
                onToggle={() => {
                  voice.clearVoiceError()
                  voice.toggleVoice()
                }}
              />
              <AnimatePresence>
                {canSend && !voice.isActive && (
                  <motion.div
                    key="send"
                    initial={{ opacity: 0, scale: 0.75 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.75 }}
                    transition={{ duration: 0.1 }}
                  >
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={handleSend}
                      style={{
                        ...actionBtnStyle,
                        background: colors.sendBg,
                        color: colors.textOnAccent
                      }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = colors.sendHover
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.background = colors.sendBg
                      }}
                    >
                      <ArrowUpIcon size={15} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {voice.voiceError && (
        <div
          style={{
            padding: '0 2px 8px',
            fontSize: 10.5,
            color: colors.statusError,
            letterSpacing: '-0.01em'
          }}
        >
          {voice.voiceError}
        </div>
      )}
    </div>
  )
}

// ─── VoiceButtons ─────────────────────────────────────────────────────────────

function VoiceButtons({
  isActive,
  voiceState,
  isConnecting,
  colors,
  onToggle
}: {
  isActive: boolean
  voiceState: string
  isConnecting: boolean
  colors: ReturnType<typeof useColors>
  onToggle: () => void
}) {
  const btnBase = {
    width: 34,
    height: 34,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    cursor: 'pointer',
    transition: 'background 0.12s, color 0.12s'
  } as const

  if (isActive) {
    const isWorking = voiceState === 'transcribing' || voiceState === 'thinking'
    return (
      <motion.div
        key="voice-live"
        initial={{ opacity: 0, scale: 0.75 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.75 }}
        transition={{ duration: 0.1 }}
      >
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggle}
          style={{
            ...btnBase,
            background: isWorking ? colors.micBg : colors.statusErrorBg,
            color: isWorking ? colors.micColor : colors.statusError
          }}
          title="Stop voice"
        >
          {isWorking ? (
            <SpinnerGapIcon size={15} className="animate-spin" />
          ) : (
            <XIcon size={14} weight="bold" />
          )}
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div
      key="voice-idle"
      initial={{ opacity: 0, scale: 0.75 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.75 }}
      transition={{ duration: 0.1 }}
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
        disabled={isConnecting}
        style={{
          ...btnBase,
          background: colors.micBg,
          color: isConnecting ? colors.micDisabled : colors.micColor
        }}
        onMouseEnter={(e) => {
          if (!isConnecting)
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.09)'
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = colors.micBg
        }}
        title="Start realtime voice"
      >
        <MicrophoneIcon size={15} />
      </button>
    </motion.div>
  )
}
