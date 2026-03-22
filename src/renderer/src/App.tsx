import { useEffect, useCallback } from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion'
import {
  PaperclipIcon,
  CameraIcon,
  HeadCircuitIcon,
  EyeIcon,
  SquareIcon
} from '@phosphor-icons/react'
import { TabStrip } from './components/TabStrip'
import { ConversationView } from './components/ConversationView'
import { InputBar } from './components/InputBar'
import { StatusBar } from './components/StatusBar'
import { MarketplacePanel } from './components/MarketplacePanel'
import { PopoverLayerProvider } from './components/PopoverLayer'
import { useClaudeEvents } from './hooks/useClaudeEvents'
import { useHealthReconciliation } from './hooks/useHealthReconciliation'
import { resolveProviderContext, useSessionStore } from './stores/sessionStore'
import { spacing, useColors, useThemeStore } from './lib/theme'

const TRANSITION = { duration: 0.26, ease: [0.4, 0, 0.1, 1] as const }

export default function App() {
  useClaudeEvents()
  useHealthReconciliation()

  const activeTabStatus = useSessionStore(
    (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.status
  )
  const addAttachments = useSessionStore((state) => state.addAttachments)
  const addSystemMessage = useSessionStore((state) => state.addSystemMessage)
  const isExpanded = useSessionStore((state) => state.isExpanded)
  const skillsPanelOpen = useSessionStore((state) => state.skillsPanelOpen)
  const toggleSkillsPanel = useSessionStore((state) => state.toggleSkillsPanel)
  const createTab = useSessionStore((state) => state.createTab)
  const toggleSettingsOpen = useSessionStore((state) => state.toggleSettingsOpen)
  const requestVoiceToggle = useSessionStore((state) => state.requestVoiceToggle)
  const preferredModel = useSessionStore((state) => state.preferredModel)
  const ollamaConfig = useSessionStore((state) => state.ollamaConfig)
  const visionState = useSessionStore((state) => state.visionState)
  const visionFeedback = useSessionStore((state) => state.visionFeedback)
  const visionError = useSessionStore((state) => state.visionError)
  const visionTabId = useSessionStore((state) => state.visionTabId)
  const toggleVision = useSessionStore((state) => state.toggleVision)
  const handleVisionEvent = useSessionStore((state) => state.handleVisionEvent)
  const colors = useColors()
  const setSystemTheme = useThemeStore((state) => state.setSystemTheme)
  const expandedUI = useThemeStore((state) => state.expandedUI)
  const prefersReducedMotion = useReducedMotion()
  const transition = prefersReducedMotion ? { duration: 0 } : TRANSITION
  const currentProvider = resolveProviderContext(preferredModel, ollamaConfig)

  useEffect(() => {
    window.yald
      .getTheme()
      .then(({ isDark }) => {
        setSystemTheme(isDark)
      })
      .catch(() => {})

    const unsub = window.yald.onThemeChange((isDark) => {
      setSystemTheme(isDark)
    })
    return unsub
  }, [setSystemTheme])

  useEffect(() => {
    useSessionStore
      .getState()
      .initStaticInfo()
      .then(() => {
        const homeDir = useSessionStore.getState().staticInfo?.homePath || '~'
        const tab = useSessionStore.getState().tabs[0]
        if (!tab) return

        useSessionStore.setState((state) => ({
          tabs: state.tabs.map((item, index) =>
            index === 0 ? { ...item, workingDirectory: homeDir, hasChosenDirectory: false } : item
          )
        }))

        return window.yald.createTab().then(({ tabId }) => {
          useSessionStore.setState((state) => ({
            tabs: state.tabs.map((item, index) => (index === 0 ? { ...item, id: tabId } : item)),
            activeTabId: tabId
          }))
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.yald?.setIgnoreMouseEvents) return
    let lastIgnored: boolean | null = null

    const onMouseMove = (event: MouseEvent) => {
      const el = document.elementFromPoint(event.clientX, event.clientY)
      const isUI = !!(el && el.closest('[data-yald-ui]'))
      const shouldIgnore = !isUI
      if (shouldIgnore !== lastIgnored) {
        lastIgnored = shouldIgnore
        if (shouldIgnore) {
          window.yald.setIgnoreMouseEvents(true, { forward: true })
        } else {
          window.yald.setIgnoreMouseEvents(false)
        }
      }
    }

    const onMouseLeave = () => {
      if (lastIgnored !== true) {
        lastIgnored = true
        window.yald.setIgnoreMouseEvents(true, { forward: true })
      }
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseleave', onMouseLeave)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onMouseLeave)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.yald.onShortcutCommand((command) => {
      if (command === 'new_tab') {
        void createTab()
        return
      }

      if (command === 'toggle_settings') {
        toggleSettingsOpen()
        return
      }

      if (command === 'toggle_voice') {
        requestVoiceToggle()
      }
    })

    return unsubscribe
  }, [createTab, requestVoiceToggle, toggleSettingsOpen])

  useEffect(() => {
    const unsubscribe = window.yald.onVisionEvent(handleVisionEvent)
    return unsubscribe
  }, [handleVisionEvent])

  const isRunning = activeTabStatus === 'running' || activeTabStatus === 'connecting'
  const contentWidth = expandedUI ? 700 : spacing.contentWidth
  const cardExpandedWidth = expandedUI ? 700 : 460
  const cardCollapsedWidth = expandedUI ? 670 : 430
  const cardCollapsedMargin = 15
  const bodyMaxHeight = expandedUI ? 520 : 400
  const panelWidth = isExpanded ? cardExpandedWidth : cardCollapsedWidth

  const handleScreenshot = useCallback(async () => {
    const result = await window.yald.takeScreenshot()
    if (!result) {
      addSystemMessage(
        'Screenshot capture failed. Check screen capture permissions for yald and try again.'
      )
      return
    }
    addAttachments([result])
  }, [addAttachments, addSystemMessage])

  const handleAttachFile = useCallback(async () => {
    const files = await window.yald.attachFiles()
    if (!files || files.length === 0) return
    addAttachments(files)
  }, [addAttachments])

  return (
    <MotionConfig reducedMotion="user">
      <PopoverLayerProvider>
        <div className="flex flex-col justify-end h-full" style={{ background: 'transparent' }}>
          <div
            style={{
              width: contentWidth,
              position: 'relative',
              margin: '0 auto',
              transition: 'width 0.26s cubic-bezier(0.4, 0, 0.1, 1)'
            }}
          >
            <motion.div
              data-yald-ui
              className="overflow-hidden flex flex-col drag-region"
              animate={{
                width: isExpanded ? cardExpandedWidth : cardCollapsedWidth,
                marginBottom: isExpanded ? 10 : -14,
                marginLeft: isExpanded ? 0 : cardCollapsedMargin,
                marginRight: isExpanded ? 0 : cardCollapsedMargin,
                background: isExpanded ? colors.containerBg : colors.containerBgCollapsed,
                borderColor: colors.containerBorder,
                boxShadow: isExpanded ? colors.cardShadow : colors.cardShadowCollapsed
              }}
              transition={transition}
              style={{
                borderWidth: 1,
                borderStyle: 'solid',
                borderRadius: 20,
                position: 'relative',
                zIndex: isExpanded ? 20 : 10
              }}
            >
              <div className="no-drag">
                <TabStrip />
              </div>

              <motion.div
                initial={false}
                animate={{
                  height: isExpanded ? 'auto' : 0,
                  opacity: isExpanded ? 1 : 0
                }}
                transition={transition}
                className="overflow-hidden no-drag"
              >
                <div style={{ maxHeight: bodyMaxHeight }}>
                  <ConversationView />
                  <StatusBar />
                </div>
              </motion.div>
            </motion.div>

            <AnimatePresence>
              {skillsPanelOpen && (
                <motion.div
                  data-yald-ui
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={transition}
                  className="no-drag"
                  style={{
                    width: panelWidth,
                    margin: '0 auto 10px',
                    borderRadius: 20,
                    border: `1px solid ${colors.containerBorder}`,
                    background: colors.containerBg,
                    boxShadow: colors.cardShadow,
                    overflow: 'hidden'
                  }}
                >
                  <MarketplacePanel />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {(visionState !== 'idle' || visionFeedback || visionError) && (
                <motion.div
                  data-yald-ui
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={transition}
                  className="no-drag"
                  style={{
                    width: panelWidth,
                    margin: '0 auto 10px',
                    borderRadius: 18,
                    border: `1px solid ${colors.containerBorder}`,
                    background: colors.containerBg,
                    boxShadow: colors.cardShadow,
                    overflow: 'hidden',
                    padding: '10px 14px'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      marginBottom: visionFeedback || visionError ? 8 : 0
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <EyeIcon size={14} style={{ color: colors.accent }} />
                      <span style={{ fontSize: 12, color: colors.textPrimary }}>Vision Agent</span>
                      <span style={{ fontSize: 11, color: colors.textTertiary }}>
                        {visionState === 'starting'
                          ? 'Starting'
                          : visionState === 'observing'
                            ? 'Observing'
                            : visionState === 'error'
                              ? 'Error'
                              : 'Idle'}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: colors.textTertiary }}>
                      {visionTabId ? `tab ${visionTabId.slice(0, 8)}` : ''}
                    </span>
                  </div>

                  {visionFeedback && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 12, color: colors.textPrimary, lineHeight: 1.45 }}>
                        {visionFeedback.summary}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textSecondary, lineHeight: 1.5 }}>
                        {visionFeedback.guidance}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 12,
                          fontSize: 10,
                          color: colors.textTertiary
                        }}
                      >
                        <span>
                          confidence {visionFeedback.confidence}
                          {visionFeedback.appliedAction &&
                            visionFeedback.appliedAction !== 'none' &&
                            ` · acted: ${visionFeedback.appliedAction}`}
                        </span>
                        <span>{visionFeedback.model}</span>
                      </div>
                    </div>
                  )}

                  {visionError && (
                    <div style={{ fontSize: 11, color: colors.statusError, lineHeight: 1.45 }}>
                      {visionError}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <div
              data-yald-ui
              className="relative"
              style={{ minHeight: 46, zIndex: 15, marginBottom: 10 }}
            >
              <div data-yald-ui className="circles-out">
                <div className="btn-stack">
                  <button
                    className="stack-btn stack-btn-1 glass-surface"
                    title="Attach file"
                    onClick={handleAttachFile}
                    disabled={isRunning}
                  >
                    <PaperclipIcon size={17} />
                  </button>
                  <button
                    className="stack-btn stack-btn-2 glass-surface"
                    title="Take screenshot"
                    onClick={handleScreenshot}
                    disabled={isRunning}
                  >
                    <CameraIcon size={17} />
                  </button>
                  <button
                    className="stack-btn stack-btn-3 glass-surface"
                    title="Skills & Plugins"
                    onClick={toggleSkillsPanel}
                    disabled={isRunning}
                  >
                    <HeadCircuitIcon size={17} />
                  </button>
                  <button
                    className="stack-btn stack-btn-4 glass-surface"
                    title={
                      visionState === 'starting' || visionState === 'observing'
                        ? 'Stop vision agent'
                        : 'Start vision agent'
                    }
                    onClick={() => {
                      void toggleVision(currentProvider)
                    }}
                  >
                    {visionState === 'starting' || visionState === 'observing' ? (
                      <SquareIcon size={15} />
                    ) : (
                      <EyeIcon size={17} />
                    )}
                  </button>
                </div>
              </div>

              <div
                data-yald-ui
                className="glass-surface w-full"
                style={{
                  minHeight: 50,
                  borderRadius: 25,
                  padding: '0 6px 0 16px',
                  background: colors.inputPillBg
                }}
              >
                <InputBar />
              </div>
            </div>
          </div>
        </div>
      </PopoverLayerProvider>
    </MotionConfig>
  )
}
