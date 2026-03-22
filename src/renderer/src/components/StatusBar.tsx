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
    setPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
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
    if (tab?.sessionModel) {
      return getModelDisplayLabel(tab.sessionModel)
    }
    return AVAILABLE_MODELS[0]?.label || 'Ollama'
  })()

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (isBusy) return
          if (!open) updatePos()
          setOpen((value) => !value)
        }}
        className="flex items-center gap-0.5 text-[10px] rounded-full px-1.5 py-0.5 transition-colors"
        style={{ color: colors.textTertiary, cursor: isBusy ? 'not-allowed' : 'pointer' }}
        title={isBusy ? 'Stop the task to change model' : 'Switch model'}
      >
        {activeLabel}
        <CaretDown size={10} style={{ opacity: 0.6 }} />
      </button>

      {popoverLayer &&
        open &&
        createPortal(
          <motion.div
            ref={popoverRef}
            data-yald-ui
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="rounded-xl"
            style={{
              position: 'fixed',
              bottom: pos.bottom,
              left: pos.left,
              width: 210,
              pointerEvents: 'auto',
              background: colors.popoverBg,
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: colors.popoverShadow,
              border: `1px solid ${colors.popoverBorder}`
            }}
          >
            <div className="py-1">
              {AVAILABLE_MODELS.map((model) => {
                const isSelected =
                  preferredModel === model.id ||
                  (!preferredModel && model.id === AVAILABLE_MODELS[0]?.id)
                return (
                  <button
                    key={model.id}
                    onClick={() => {
                      setPreferredModel(model.id)
                      setOpen(false)
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] transition-colors"
                    style={{
                      color: isSelected ? colors.textPrimary : colors.textSecondary,
                      fontWeight: isSelected ? 600 : 400
                    }}
                  >
                    {model.label}
                    {isSelected && <Check size={12} style={{ color: colors.accent }} />}
                  </button>
                )
              })}
            </div>
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
  const colors = useColors()

  if (!tab) return null

  const host = tab.sessionTransport === 'api' ? 'Backend API' : 'Ollama'
  const basePath = tab.hasChosenDirectory ? compactPath(tab.workingDirectory) : '~'

  return (
    <div className="flex items-center justify-between px-4 py-1.5" style={{ minHeight: 28 }}>
      <div
        className="flex items-center gap-2 text-[11px] min-w-0"
        style={{ color: colors.textTertiary }}
      >
        <span className="flex items-center gap-1 rounded-full px-1.5 py-0.5">
          <FolderOpen size={11} />
          <span>{basePath}</span>
        </span>
        <span style={{ color: colors.textMuted, fontSize: 10 }}>|</span>
        <ModelPicker />
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="text-[10px] rounded-full px-2 py-0.5"
          style={{
            color: colors.textTertiary,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${colors.popoverBorder}`
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
