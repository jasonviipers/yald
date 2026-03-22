import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  WrenchIcon,
  FolderOpenIcon,
  CopyIcon,
  CheckIcon,
  CaretRightIcon,
  CaretDownIcon,
  SpinnerGapIcon,
  ArrowCounterClockwiseIcon,
  SquareIcon,
  GlobeIcon,
  QuestionIcon,
  FileTextIcon,
  PencilSimpleIcon,
  FileArrowUpIcon,
  TerminalIcon,
  MagnifyingGlassIcon,
  RobotIcon
} from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors, useThemeStore } from '../lib/theme'
import type { Message } from '@shared/types'

const INITIAL_RENDER_CAP = 100
const PAGE_SIZE = 100
const REMARK_PLUGINS = [remarkGfm]

type GroupedItem =
  | { kind: 'user'; message: Message }
  | { kind: 'assistant'; message: Message }
  | { kind: 'system'; message: Message }
  | { kind: 'tool-group'; messages: Message[] }

function groupMessages(messages: Message[]): GroupedItem[] {
  const result: GroupedItem[] = []
  let toolBuf: Message[] = []
  const flush = () => {
    if (toolBuf.length) {
      result.push({ kind: 'tool-group', messages: [...toolBuf] })
      toolBuf = []
    }
  }
  for (const msg of messages) {
    if (msg.role === 'tool') {
      toolBuf.push(msg)
    } else {
      flush()
      result.push(
        msg.role === 'user'
          ? { kind: 'user', message: msg }
          : msg.role === 'assistant'
            ? { kind: 'assistant', message: msg }
            : { kind: 'system', message: msg }
      )
    }
  }
  flush()
  return result
}

export function ConversationView() {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const sendMessage = useSessionStore((s) => s.sendMessage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [renderOffset, setRenderOffset] = useState(0)
  const isNearBottomRef = useRef(true)
  const prevTabIdRef = useRef(activeTabId)
  const colors = useColors()
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const tab = tabs.find((t) => t.id === activeTabId)

  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      prevTabIdRef.current = activeTabId
      setRenderOffset(0)
      isNearBottomRef.current = true
    }
  }, [activeTabId])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  const msgCount = tab?.messages.length ?? 0
  const lastMsg = tab?.messages[tab.messages.length - 1]
  const scrollTrigger = `${msgCount}:${lastMsg?.content?.length ?? 0}:${tab?.queuedPrompts?.length ?? 0}`

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [scrollTrigger])

  const allMessages = tab?.messages ?? []
  const totalCount = allMessages.length
  const startIndex = Math.max(0, totalCount - INITIAL_RENDER_CAP - renderOffset * PAGE_SIZE)
  const visibleMessages = startIndex > 0 ? allMessages.slice(startIndex) : allMessages
  const hasOlder = startIndex > 0
  const grouped = useMemo(() => groupMessages(visibleMessages), [visibleMessages])
  const hiddenCount = totalCount - visibleMessages.length
  const historicalThreshold = Math.max(0, totalCount - 20)

  if (!tab) return null

  const isRunning = tab.status === 'running' || tab.status === 'connecting'
  const isDead = tab.status === 'dead'
  const isFailed = tab.status === 'failed'
  const showInterrupt = isRunning && tab.messages.some((m) => m.role === 'user')

  if (tab.messages.length === 0) return <EmptyState />

  const handleRetry = () => {
    const last = [...tab.messages].reverse().find((m) => m.role === 'user')
    if (last) sendMessage(last.content)
  }

  return (
    <div data-yald-ui>
      {/* Messages */}
      <div
        ref={scrollRef}
        className="overflow-y-auto overflow-x-hidden conversation-selectable"
        style={{
          maxHeight: expandedUI ? 460 : 336,
          padding: '8px 14px 32px',
          scrollbarWidth: 'thin'
        }}
        onScroll={handleScroll}
      >
        {hasOlder && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <button
              onClick={() => setRenderOffset((o) => o + 1)}
              style={{
                fontSize: 11,
                padding: '4px 12px',
                borderRadius: 9999,
                color: colors.textTertiary,
                border: `1px solid rgba(255,255,255,0.08)`,
                background: 'transparent',
                cursor: 'pointer',
                transition: 'background 0.15s'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.background = 'transparent')
              }
            >
              Load {Math.min(PAGE_SIZE, hiddenCount)} older
            </button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {grouped.map((item, idx) => {
            const isHistorical = startIndex + idx < historicalThreshold
            switch (item.kind) {
              case 'user':
                return (
                  <UserMessage
                    key={item.message.id}
                    message={item.message}
                    skipMotion={isHistorical}
                  />
                )
              case 'assistant':
                return (
                  <AssistantMessage
                    key={item.message.id}
                    message={item.message}
                    skipMotion={isHistorical}
                  />
                )
              case 'tool-group':
                return (
                  <ToolGroup
                    key={`tg-${item.messages[0].id}`}
                    tools={item.messages}
                    skipMotion={isHistorical}
                  />
                )
              case 'system':
                return (
                  <SystemMessage
                    key={item.message.id}
                    message={item.message}
                    skipMotion={isHistorical}
                  />
                )
              default:
                return null
            }
          })}
        </div>

        <AnimatePresence>
          {tab.queuedPrompts.map((p, i) => (
            <QueuedMessage key={`q-${i}`} content={p} />
          ))}
        </AnimatePresence>

        <div ref={bottomRef} />
      </div>

      {/* Activity strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          height: 28,
          marginTop: -28,
          background: `linear-gradient(to bottom, transparent, ${colors.containerBg} 65%)`,
          position: 'relative',
          zIndex: 2
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, minWidth: 0 }}>
          {isRunning && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'flex', gap: 3 }}>
                {[0, 150, 300].map((d) => (
                  <span
                    key={d}
                    className="animate-bounce-dot"
                    style={{
                      width: 3,
                      height: 3,
                      borderRadius: '50%',
                      background: colors.statusRunning,
                      animationDelay: `${d}ms`,
                      display: 'block'
                    }}
                  />
                ))}
              </span>
              <span style={{ color: colors.textSecondary, letterSpacing: '-0.01em' }}>
                {tab.currentActivity || 'Working…'}
              </span>
            </span>
          )}
          {isDead && <span style={{ color: colors.statusError }}>Session ended</span>}
          {isFailed && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: colors.statusError }}>Failed</span>
              <button
                onClick={handleRetry}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  color: colors.accent,
                  fontSize: 11,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                  padding: 0
                }}
              >
                <ArrowCounterClockwiseIcon size={10} />
                Retry
              </button>
            </span>
          )}
        </div>
        <AnimatePresence>{showInterrupt && <InterruptButton tabId={tab.id} />}</AnimatePresence>
      </div>
    </div>
  )
}

// ─── Empty State ───

function EmptyState() {
  const setBaseDirectory = useSessionStore((s) => s.setBaseDirectory)
  const colors = useColors()
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        gap: 10,
        minHeight: 90
      }}
    >
      <button
        onClick={async () => {
          const dir = await window.yald.selectDirectory()
          if (dir) setBaseDirectory(dir)
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          padding: '7px 16px',
          borderRadius: 9999,
          color: colors.accent,
          background: colors.accentLight,
          border: `1px solid ${colors.accentBorder}`,
          cursor: 'pointer',
          transition: 'background 0.15s',
          letterSpacing: '-0.01em'
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLElement).style.background = colors.accentSoft)
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLElement).style.background = colors.accentLight)
        }
      >
        <FolderOpenIcon size={13} /> Choose folder
      </button>
      <span style={{ fontSize: 11, color: colors.textTertiary }}>
        Press <strong style={{ color: colors.textSecondary, fontWeight: 500 }}>⌥ Space</strong> to
        toggle
      </span>
    </div>
  )
}

// ─── Copy Button ───

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const colors = useColors()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
      onClick={copy}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: '2px 6px',
        borderRadius: 6,
        fontSize: 10,
        background: copied ? colors.statusCompleteBg : 'rgba(255,255,255,0.06)',
        color: copied ? colors.statusComplete : colors.textTertiary,
        border: `1px solid ${copied ? colors.statusCompleteBg : 'rgba(255,255,255,0.08)'}`,
        cursor: 'pointer',
        transition: 'all 0.15s',
        letterSpacing: '-0.01em'
      }}
    >
      {copied ? <CheckIcon size={10} /> : <CopyIcon size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </motion.button>
  )
}

// ─── Interrupt Button ───

function InterruptButton({ tabId }: { tabId: string }) {
  const colors = useColors()
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.88 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.88 }}
      transition={{ duration: 0.12 }}
      onClick={() => window.yald.stopTab(tabId)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 8px',
        borderRadius: 9999,
        fontSize: 11,
        cursor: 'pointer',
        color: colors.statusError,
        background: colors.statusErrorBg,
        border: `1px solid rgba(224,112,112,0.2)`,
        transition: 'background 0.15s',
        letterSpacing: '-0.01em'
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'rgba(224,112,112,0.14)')
      }
      onMouseLeave={(e) =>
        ((e.currentTarget as HTMLElement).style.background = colors.statusErrorBg)
      }
    >
      <SquareIcon size={8} weight="fill" /> Interrupt
    </motion.button>
  )
}

// ─── User Message ───

function UserMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const colors = useColors()
  const content = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          padding: '8px 13px',
          maxWidth: '82%',
          background: colors.userBubble,
          color: colors.userBubbleText,
          border: `1px solid ${colors.userBubbleBorder}`,
          borderRadius: '14px 14px 4px 14px',
          boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset',
          backdropFilter: 'blur(12px)',
          letterSpacing: '-0.01em'
        }}
      >
        {message.content}
      </div>
    </div>
  )
  if (skipMotion) return content
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.16, ease: [0.34, 1.2, 0.64, 1] }}
    >
      {content}
    </motion.div>
  )
}

// ─── Queued Message ───

function QueuedMessage({ content }: { content: string }) {
  const colors = useColors()
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 0.5, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 0' }}
    >
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.55,
          padding: '8px 13px',
          maxWidth: '82%',
          background: colors.userBubble,
          color: colors.userBubbleText,
          border: `1px dashed ${colors.userBubbleBorder}`,
          borderRadius: '14px 14px 4px 14px',
          letterSpacing: '-0.01em'
        }}
      >
        {content}
      </div>
    </motion.div>
  )
}

// ─── Table scroll wrapper ───

function TableScrollWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<string | undefined>()
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const { scrollLeft: sl, scrollWidth: sw, clientWidth: cw } = el
    if (sw <= cw + 1) {
      setFade(undefined)
      return
    }
    const l = sl > 1,
      r = sl + cw < sw - 1
    setFade(
      l && r
        ? 'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)'
        : l
          ? 'linear-gradient(to right, transparent, black 24px)'
          : r
            ? 'linear-gradient(to right, black calc(100% - 24px), transparent)'
            : undefined
    )
  }, [])
  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    const t = el.querySelector('table')
    if (t) ro.observe(t)
    return () => ro.disconnect()
  }, [update])
  return (
    <div
      ref={ref}
      onScroll={update}
      style={{ overflowX: 'auto', scrollbarWidth: 'thin', maskImage: fade, WebkitMaskImage: fade }}
    >
      <table>{children}</table>
    </div>
  )
}

// ─── Image Card ───

function ImageCard({
  src,
  alt,
  colors
}: {
  src?: string
  alt?: string
  colors: ReturnType<typeof useColors>
}) {
  const [failed, setFailed] = useState(false)
  if (failed || !src)
    return (
      <button
        type="button"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          margin: '4px 0',
          padding: '6px 10px',
          borderRadius: 8,
          fontSize: 12,
          cursor: 'pointer',
          background: colors.surfacePrimary,
          color: colors.accent,
          border: `1px solid ${colors.toolBorder}`
        }}
        onClick={() => src && window.yald.openExternal(String(src))}
      >
        <GlobeIcon size={12} />
        Image unavailable{alt ? ` — ${alt}` : ''}
      </button>
    )
  return (
    <button
      type="button"
      style={{
        display: 'block',
        margin: '8px 0',
        borderRadius: 10,
        overflow: 'hidden',
        border: `1px solid ${colors.toolBorder}`,
        background: colors.surfacePrimary,
        cursor: 'pointer'
      }}
      onClick={() => window.yald.openExternal(String(src))}
    >
      <img
        src={src}
        alt={alt || 'Image'}
        style={{ display: 'block', width: '100%', maxHeight: 240, objectFit: 'cover' }}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {alt && (
        <div style={{ padding: '4px 8px', fontSize: 11, color: colors.textTertiary }}>{alt}</div>
      )}
    </button>
  )
}

// ─── Assistant Message ───

const AssistantMessage = React.memo(
  function AssistantMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
    const colors = useColors()
    const markdownComponents = useMemo(
      () => ({
        table: ({ children }: any) => <TableScrollWrapper>{children}</TableScrollWrapper>,
        a: ({ href, children }: any) => (
          <button
            type="button"
            style={{
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textUnderlineOffset: 2,
              cursor: 'pointer',
              color: colors.accent,
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit'
            }}
            onClick={() => href && window.yald.openExternal(String(href))}
          >
            {children}
          </button>
        ),
        img: ({ src, alt }: any) => (
          <ImageCard key={String(src || alt || 'image')} src={src} alt={alt} colors={colors} />
        )
      }),
      [colors]
    )

    const inner = (
      <div className="group/msg" style={{ position: 'relative', padding: '4px 0' }}>
        <div
          className="prose-cloud"
          style={{
            fontSize: 13,
            lineHeight: 1.65,
            minWidth: 0,
            maxWidth: '94%',
            letterSpacing: '-0.01em'
          }}
        >
          <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
            {message.content}
          </Markdown>
        </div>
        {message.content.trim() && (
          <div
            className="opacity-0 group-hover/msg:opacity-100 transition-opacity duration-100"
            style={{ position: 'absolute', bottom: 0, right: 0 }}
          >
            <CopyButton text={message.content} />
          </div>
        )}
      </div>
    )
    if (skipMotion) return inner
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
      >
        {inner}
      </motion.div>
    )
  },
  (p, n) => p.message.content === n.message.content && p.skipMotion === n.skipMotion
)

// ─── Tool Group ───

function toolSummary(tools: Message[]): string {
  if (!tools.length) return ''
  const desc = getToolDescription(tools[0].toolName || 'Tool', tools[0].toolInput)
  return tools.length === 1 ? desc : `${desc} +${tools.length - 1} more`
}

function getToolDescription(name: string, input?: string): string {
  if (!input) return name
  try {
    const p = JSON.parse(input)
    switch (name) {
      case 'LS':
        return `List ${p.path || p.dir || '.'}`
      case 'Read':
        return `Read ${p.file_path || p.path || 'file'}`
      case 'Edit':
        return `Edit ${p.file_path || 'file'}`
      case 'Write':
        return `Write ${p.file_path || 'file'}`
      case 'Glob':
        return `Search files: ${p.pattern || ''}`
      case 'Grep':
        return `Search: ${p.pattern || ''}`
      case 'Bash':
        return (p.command || '').length > 58
          ? `${(p.command || '').substring(0, 55)}…`
          : p.command || 'Bash'
      case 'WebSearch':
        return `Search: ${p.query || p.search_query || ''}`
      case 'WebFetch':
        return `Fetch: ${p.url || ''}`
      case 'Agent':
        return `Agent: ${(p.prompt || p.description || '').substring(0, 50)}`
      default:
        return name
    }
  } catch {
    const t = input.trim()
    return t.length > 58 ? `${name}: ${t.substring(0, 55)}…` : t ? `${name}: ${t}` : name
  }
}

function ToolGroup({ tools, skipMotion }: { tools: Message[]; skipMotion?: boolean }) {
  const hasRunning = tools.some((t) => t.toolStatus === 'running')
  const [expanded, setExpanded] = useState(false)
  const colors = useColors()
  const isOpen = expanded || hasRunning

  if (isOpen) {
    const inner = (
      <div style={{ padding: '4px 0' }}>
        {!hasRunning && (
          <button
            onClick={() => setExpanded(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 8,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              padding: 0
            }}
          >
            <CaretDownIcon size={9} style={{ color: colors.textTertiary }} />
            <span style={{ fontSize: 10, color: colors.textTertiary, letterSpacing: '0.02em' }}>
              {tools.length} tool{tools.length !== 1 ? 's' : ''} used
            </span>
          </button>
        )}

        {/* Timeline */}
        <div style={{ position: 'relative', paddingLeft: 22 }}>
          {/* Vertical line */}
          <div
            style={{
              position: 'absolute',
              left: 8,
              top: 4,
              bottom: 4,
              width: 1,
              background: colors.timelineLine
            }}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tools.map((tool) => {
              const isRun = tool.toolStatus === 'running'
              const name = tool.toolName || 'Tool'
              return (
                <div
                  key={tool.id}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8
                  }}
                >
                  {/* Node */}
                  <div
                    style={{
                      position: 'absolute',
                      left: -22,
                      top: 0,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isRun ? colors.toolRunningBg : colors.toolBg,
                      border: `1px solid ${isRun ? colors.toolRunningBorder : colors.toolBorder}`,
                      backdropFilter: 'blur(8px)'
                    }}
                  >
                    {isRun ? (
                      <SpinnerGapIcon
                        size={9}
                        className="animate-spin"
                        style={{ color: colors.statusRunning }}
                      />
                    ) : (
                      <ToolIcon name={name} size={9} />
                    )}
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        fontSize: 11,
                        lineHeight: 1.4,
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: isRun ? colors.textSecondary : colors.textTertiary,
                        letterSpacing: '-0.01em'
                      }}
                    >
                      {getToolDescription(name, tool.toolInput)}
                    </span>
                    {!isRun && (
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 9,
                          marginTop: 2,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background:
                            tool.toolStatus === 'error'
                              ? colors.statusErrorBg
                              : 'rgba(255,255,255,0.05)',
                          color:
                            tool.toolStatus === 'error' ? colors.statusError : colors.textTertiary
                        }}
                      >
                        {tool.toolStatus === 'error' ? 'error' : 'done'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
    if (skipMotion) return inner
    return (
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.15 }}
      >
        {inner}
      </motion.div>
    )
  }

  const inner = (
    <button
      onClick={() => setExpanded(true)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 0',
        background: 'none',
        border: 'none',
        cursor: 'pointer'
      }}
    >
      <CaretRightIcon size={9} style={{ color: colors.textTertiary, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: colors.textTertiary, letterSpacing: '-0.01em' }}>
        {toolSummary(tools)}
      </span>
    </button>
  )
  if (skipMotion) return <div style={{ padding: '2px 0' }}>{inner}</div>
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12 }}
      style={{ padding: '2px 0' }}
    >
      {inner}
    </motion.div>
  )
}

// ─── System Message ───

function SystemMessage({ message, skipMotion }: { message: Message; skipMotion?: boolean }) {
  const isError = message.content.startsWith('Error:') || message.content.includes('unexpectedly')
  const colors = useColors()
  const inner = (
    <div style={{ padding: '3px 0' }}>
      <div
        style={{
          display: 'inline-block',
          fontSize: 11,
          lineHeight: 1.5,
          padding: '4px 10px',
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          background: isError ? colors.statusErrorBg : 'rgba(255,255,255,0.05)',
          color: isError ? colors.statusError : colors.textTertiary,
          border: `1px solid ${isError ? 'rgba(224,112,112,0.15)' : 'rgba(255,255,255,0.07)'}`
        }}
      >
        {message.content}
      </div>
    </div>
  )
  if (skipMotion) return inner
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
      {inner}
    </motion.div>
  )
}

// ─── Tool Icon ───

function ToolIcon({ name, size = 12 }: { name: string; size?: number }) {
  const colors = useColors()
  const ICONS: Record<string, React.ReactNode> = {
    LS: <FolderOpenIcon size={size} />,
    Read: <FileTextIcon size={size} />,
    Edit: <PencilSimpleIcon size={size} />,
    Write: <FileArrowUpIcon size={size} />,
    Bash: <TerminalIcon size={size} />,
    Glob: <FolderOpenIcon size={size} />,
    Grep: <MagnifyingGlassIcon size={size} />,
    WebSearch: <GlobeIcon size={size} />,
    WebFetch: <GlobeIcon size={size} />,
    Agent: <RobotIcon size={size} />,
    AskUserQuestion: <QuestionIcon size={size} />
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', color: colors.textTertiary }}>
      {ICONS[name] || <WrenchIcon size={size} />}
    </span>
  )
}
