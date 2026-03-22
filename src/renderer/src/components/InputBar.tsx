import React, { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MicrophoneIcon, ArrowUpIcon, SpinnerGapIcon, XIcon } from '@phosphor-icons/react'
import { resolveProviderContext, useSessionStore } from '../stores/sessionStore'
import { AttachmentChips } from './AttachmentChips'
import {
  SlashCommandMenu,
  getFilteredCommandsWithExtras,
  type SlashCommand
} from './SlashCommandMenu'
import { AVAILABLE_MODELS } from '../lib/llm'
import { useColors } from '../lib/theme'
import { useRealtimeVoice } from '../hooks/useRealtimeVoice'

const INPUT_MIN_HEIGHT = 20
const INPUT_MAX_HEIGHT = 140
const MULTILINE_ENTER_HEIGHT = 52
const MULTILINE_EXIT_HEIGHT = 50
const INLINE_CONTROLS_RESERVED_WIDTH = 104

const BASE_COMMANDS: SlashCommand[] = [
  {
    command: '/clear',
    description: 'Clear conversation history',
    icon: <span className="text-[11px]">x</span>
  },
  {
    command: '/cost',
    description: 'Show token and duration info',
    icon: <span className="text-[11px]">x</span>
  },
  {
    command: '/skills',
    description: 'Show installed agent skills',
    icon: <span className="text-[11px]">x</span>
  },
  {
    command: '/model',
    description: 'Show or switch Ollama model',
    icon: <span className="text-[11px]">x</span>
  },
  {
    command: '/help',
    description: 'Show available commands',
    icon: <span className="text-[11px]">x</span>
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
  const preferredModel = useSessionStore((state) => state.preferredModel)
  const ollamaConfig = useSessionStore((state) => state.ollamaConfig)
  const installedSkills = useSessionStore((state) => state.installedSkills)
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
      measure.style.position = 'absolute'
      measure.style.top = '-99999px'
      measure.style.left = '0'
      measure.style.height = '0'
      measure.style.minHeight = '0'
      measure.style.overflow = 'hidden'
      measure.style.visibility = 'hidden'
      measure.style.pointerEvents = 'none'
      measure.style.zIndex = '-1'
      measure.style.resize = 'none'
      measure.style.border = '0'
      measure.style.outline = '0'
      measure.style.boxSizing = 'border-box'
      document.body.appendChild(measure)
      measureRef.current = measure
    }

    const measure = measureRef.current
    const hostWidth = wrapperRef.current?.clientWidth ?? 0
    const inlineWidth = Math.max(120, hostWidth - INLINE_CONTROLS_RESERVED_WIDTH)
    measure.style.width = `${inlineWidth}px`
    measure.style.fontSize = '14px'
    measure.style.lineHeight = '20px'
    measure.style.paddingTop = '15px'
    measure.style.paddingBottom = '15px'
    measure.style.paddingLeft = '0'
    measure.style.paddingRight = '0'

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
            const result = tab.lastResult
            const parts = [
              `$${result.totalCostUsd.toFixed(4)}`,
              `${(result.durationMs / 1000).toFixed(1)}s`,
              `${result.numTurns} turn${result.numTurns !== 1 ? 's' : ''}`
            ]
            if (result.usage.input_tokens) {
              parts.push(
                `${result.usage.input_tokens.toLocaleString()} in / ${(result.usage.output_tokens || 0).toLocaleString()} out`
              )
            }
            addSystemMessage(parts.join(' · '))
          } else {
            addSystemMessage('No run data yet. Send a message first.')
          }
          break
        }
        case '/model': {
          const current =
            preferredModel || tab?.sessionModel || AVAILABLE_MODELS[0]?.id || 'unknown'
          const lines = AVAILABLE_MODELS.map((model) => {
            const active = model.id === current
            return `  ${active ? '●' : '○'} ${model.label} (${model.id})`
          })
          addSystemMessage(
            `Ollama Cloud models\n\n${lines.join('\n')}\n\nSwitch model: type /model <name>`
          )
          break
        }
        case '/skills':
          if (installedSkills.length === 0) {
            addSystemMessage(
              'No agent skills installed yet. Open the Skills Marketplace to install one.'
            )
          } else {
            addSystemMessage(
              `Installed agent skills\n\n${installedSkills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n')}`
            )
          }
          break
        case '/help':
          addSystemMessage(
            [
              '/clear — Clear conversation history',
              '/cost — Show token usage and duration',
              '/skills — Show installed marketplace skills',
              '/model — Show model info or switch model',
              '/help — Show this list'
            ].join('\n')
          )
          break
      }
    },
    [addSystemMessage, clearTab, installedSkills, preferredModel, tab]
  )

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput('')
      setSlashFilter(null)
      executeCommand(cmd)
    },
    [executeCommand]
  )

  const handleSend = useCallback(() => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter || '', BASE_COMMANDS)
      if (filtered.length > 0) {
        handleSlashSelect(filtered[slashIndex])
        return
      }
    }

    const prompt = input.trim()
    const modelMatch = prompt.match(/^\/model\s+(\S+)/i)
    if (modelMatch) {
      const query = modelMatch[1].toLowerCase()
      const match = AVAILABLE_MODELS.find(
        (model) =>
          model.id.toLowerCase().includes(query) || model.label.toLowerCase().includes(query)
      )
      setInput('')
      setSlashFilter(null)
      if (match) {
        setPreferredModel(match.id)
        addSystemMessage(`Model switched to ${match.label} (${match.id})`)
      } else {
        addSystemMessage(`Unknown model "${modelMatch[1]}".`)
      }
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
    sendMessage,
    setPreferredModel,
    showSlashMenu,
    slashFilter,
    slashIndex
  ])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (showSlashMenu) {
      const filtered = getFilteredCommandsWithExtras(slashFilter || '', BASE_COMMANDS)
      if (event.key === 'ArrowDown' && filtered.length > 0) {
        event.preventDefault()
        setSlashIndex((index) => (index + 1) % filtered.length)
        return
      }
      if (event.key === 'ArrowUp' && filtered.length > 0) {
        event.preventDefault()
        setSlashIndex((index) => (index - 1 + filtered.length) % filtered.length)
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
    if (event.key === 'Escape' && !showSlashMenu) {
      window.yald.hideWindow()
    }
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
    ? 'Connecting to backend...'
    : voice.isActive && voice.voiceState === 'listening'
      ? 'Listening... speak naturally'
      : voice.isActive && voice.voiceState === 'transcribing'
        ? 'Transcribing...'
        : voice.isActive && voice.voiceState === 'thinking'
          ? 'Thinking...'
          : voice.isActive && voice.voiceState === 'speaking'
            ? 'Speaking... interrupt anytime'
            : isBusy
              ? 'Type to queue a message...'
              : 'Ask anything...'

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
        <div style={{ paddingTop: 6, marginLeft: -6 }}>
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
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 11,
                paddingBottom: 2
              }}
            />

            <div
              className="flex items-center justify-end gap-1"
              style={{ marginTop: 0, paddingBottom: 4 }}
            >
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
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.1 }}
                  >
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUpIcon size={16} weight="bold" />
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
                fontSize: 14,
                lineHeight: '20px',
                color: colors.textPrimary,
                minHeight: 20,
                maxHeight: INPUT_MAX_HEIGHT,
                paddingTop: 15,
                paddingBottom: 15
              }}
            />

            <div className="flex items-center gap-1 shrink-0 ml-2">
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
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{ duration: 0.1 }}
                  >
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleSend}
                      className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                      style={{ background: colors.sendBg, color: colors.textOnAccent }}
                      title={isBusy ? 'Queue message' : 'Send (Enter)'}
                    >
                      <ArrowUpIcon size={16} weight="bold" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {voice.voiceError && (
        <div className="px-1 pb-2 text-[11px]" style={{ color: colors.statusError }}>
          {voice.voiceError}
        </div>
      )}
    </div>
  )
}

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
  if (isActive) {
    const isWorking = voiceState === 'transcribing' || voiceState === 'thinking'
    return (
      <motion.div
        key="voice-live"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ duration: 0.1 }}
      >
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggle}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: isWorking ? colors.micBg : colors.statusErrorBg,
            color: isWorking ? colors.micColor : colors.statusError
          }}
          title="Stop voice interaction"
        >
          {isWorking ? (
            <SpinnerGapIcon size={16} className="animate-spin" />
          ) : (
            <XIcon size={15} weight="bold" />
          )}
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div
      key="voice-idle"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.1 }}
    >
      <button
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
        disabled={isConnecting}
        className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
        style={{
          background: colors.micBg,
          color: isConnecting ? colors.micDisabled : colors.micColor
        }}
        title="Start realtime voice"
      >
        <MicrophoneIcon size={16} />
      </button>
    </motion.div>
  )
}
