import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { CaretDown, Check, FolderOpen } from '@phosphor-icons/react'
import { useSessionStore, getModelDisplayLabel } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { AVAILABLE_MODELS, OLLAMA_BASE_URL } from '../lib/llm'
import { useColors } from '../lib/theme'

function ModelPicker() {
  const preferredModel = useSessionStore((state) => state.preferredModel)
  const setPreferredModel = useSessionStore((state) => state.setPreferredModel)
  const tab = useSessionStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
  const popoverLayer = usePopoverLayer()
  const colors = useColors()

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ bottom: 0, left: 0 })
  const isBusy = tab?.status === 'running' || tab?.status === 'connecting'

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ bottom: window.innerHeight - rect.top + 6, left: rect.left })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeLabel = (() => {
    if (preferredModel) {
      const model = AVAILABLE_MODELS.find((item) => item.id === preferredModel)
      return model?.label || getModelDisplayLabel(preferredModel)
    }
    if (tab?.sessionModel) return getModelDisplayLabel(tab.sessionModel)
    return AVAILABLE_MODELS[0]?.label || 'Ollama'
  })()

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (isBusy) return
          if (!open) updatePos()
          setOpen((v) => !v)
        }}
        className="flex items-center gap-0.5"
        style={{
          fontSize: 10.5,
          color: colors.textTertiary,
          cursor: isBusy ? 'not-allowed' : 'pointer',
          background: 'none',
          border: 'none',
          padding: '2px 4px',
          borderRadius: 5,
          transition: 'color 0.12s'
        }}
        onMouseEnter={(e) => {
          if (!isBusy) (e.currentTarget as HTMLElement).style.color = colors.textSecondary
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
        }}
        title={isBusy ? 'Stop the task to change model' : 'Switch model'}
      >
        {activeLabel}
        <CaretDown size={9} style={{ opacity: 0.5 }} />
      </button>

      {popoverLayer &&
        open &&
        createPortal(
          <motion.div
            ref={popoverRef}
            data-yald-ui
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed',
              bottom: pos.bottom,
              left: pos.left,
              width: 220,
              pointerEvents: 'auto',
              background: colors.popoverBg,
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              boxShadow: `${colors.popoverShadow}, 0 1px 0 rgba(255,255,255,0.1) inset`,
              border: `1px solid ${colors.popoverBorder}`,
              borderRadius: 12,
              overflow: 'hidden'
            }}
          >
            {/* Scrollable list */}
            <div
              style={{
                padding: '4px',
                maxHeight: 240,
                overflowY: 'auto'
              }}
              className="hide-scrollbar"
            >
              {AVAILABLE_MODELS.map((model) => {
                const selectedModelId =
                  preferredModel || tab?.sessionModel || AVAILABLE_MODELS[0]?.id
                const isSelected = selectedModelId === model.id
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      setPreferredModel(model.id)
                      setOpen(false)
                    }}
                    className="w-full flex items-center justify-between"
                    style={{
                      padding: '7px 10px',
                      fontSize: 11.5,
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                      fontWeight: isSelected ? 500 : 400,
                      background: isSelected ? 'rgba(255,255,255,0.05)' : 'transparent',
                      border: 'none',
                      borderRadius: 7,
                      cursor: 'pointer',
                      transition: 'background 0.1s',
                      letterSpacing: '-0.01em',
                      textAlign: 'left'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.background = 'transparent'
                    }}
                  >
                    {model.label}
                    {isSelected && (
                      <Check size={11} style={{ color: colors.accent, flexShrink: 0 }} />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Fade-out hint when list overflows */}
            {AVAILABLE_MODELS.length > 7 && (
              <div
                style={{
                  height: 20,
                  marginTop: -20,
                  background: `linear-gradient(to bottom, transparent, ${colors.popoverBg})`,
                  pointerEvents: 'none',
                  position: 'relative',
                  zIndex: 1
                }}
              />
            )}
          </motion.div>,
          popoverLayer
        )}
    </>
  )
}

function compactPath(fullPath: string): string {
  if (fullPath === '~') return '~'
  const parts = fullPath.replace(/\/$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || fullPath
}

export function StatusBar() {
  const tab = useSessionStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
  const orchestratorEnabled = useSessionStore(
    (state) => state.orchestratorEnabledByTab[state.activeTabId] ?? true
  )
  const orchestratorContext = useSessionStore(
    (state) => state.orchestratorContextByTab[state.activeTabId] || null
  )
  const toggleOrchestratorMode = useSessionStore((state) => state.toggleOrchestratorMode)
  const colors = useColors()

  if (!tab) return null

  const host = tab.sessionTransport === 'api' ? 'API' : 'Ollama'
  const basePath = tab.hasChosenDirectory ? compactPath(tab.workingDirectory) : '~'

  return (
    <div
      className="flex items-center justify-between"
      style={{
        padding: '0 14px',
        minHeight: 26,
        borderTop: `1px solid rgba(255,255,255,0.04)`
      }}
    >
      <div
        className="flex items-center gap-1.5 min-w-0"
        style={{ fontSize: 10.5, color: colors.textTertiary }}
      >
        <span
          className="flex items-center gap-1"
          style={{
            padding: '1.5px 6px',
            borderRadius: 5,
            background: 'rgba(255,255,255,0.03)',
            letterSpacing: '-0.01em'
          }}
        >
          <FolderOpen size={9.5} style={{ opacity: 0.7 }} />
          {basePath}
        </span>

        <span style={{ opacity: 0.2, fontSize: 9 }}>|</span>

        <ModelPicker />

        <span style={{ opacity: 0.2, fontSize: 9 }}>|</span>

        <button
          onClick={toggleOrchestratorMode}
          className="flex items-center gap-1"
          style={{
            padding: '1.5px 6px',
            borderRadius: 5,
            color: orchestratorEnabled ? colors.accent : colors.textTertiary,
            background: orchestratorEnabled ? colors.accentLight : 'transparent',
            border: `1px solid ${orchestratorEnabled ? colors.accentBorder : 'transparent'}`,
            cursor: 'pointer',
            fontSize: 10.5,
            letterSpacing: '-0.01em',
            transition: 'all 0.15s'
          }}
          title={
            orchestratorContext
              ? `Orchestrator ${orchestratorEnabled ? 'enabled' : 'disabled'} · ${orchestratorContext.intent}`
              : `Orchestrator ${orchestratorEnabled ? 'enabled' : 'disabled'}`
          }
        >
          Orchestrator
          {orchestratorContext && (
            <span style={{ opacity: 0.55 }}>{orchestratorContext.confidence}</span>
          )}
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          style={{
            fontSize: 10,
            padding: '1.5px 7px',
            borderRadius: 5,
            color: colors.textTertiary,
            background: 'rgba(255,255,255,0.03)',
            border: `1px solid rgba(255,255,255,0.05)`,
            letterSpacing: '0.01em'
          }}
          title={
            tab.sessionTransport === 'api' ? tab.sessionModel || OLLAMA_BASE_URL : OLLAMA_BASE_URL
          }
        >
          {host}
        </span>
      </div>
    </div>
  )
}
