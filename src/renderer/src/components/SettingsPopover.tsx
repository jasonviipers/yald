import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, HeadCircuit } from '@phosphor-icons/react'
import { useThemeStore } from '../lib/theme'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../lib/theme'

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  const colors = useColors()
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      style={{
        position: 'relative',
        width: 30,
        height: 17,
        borderRadius: 9999,
        background: checked ? colors.accent : 'rgba(255,255,255,0.08)',
        border: `1px solid ${checked ? colors.accent : 'rgba(255,255,255,0.1)'}`,
        transition: 'background 0.18s, border-color 0.18s',
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: checked ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          transition: 'left 0.16s cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      />
    </button>
  )
}

// ─── SettingRow ───────────────────────────────────────────────────────────────

function SettingRow({
  icon,
  label,
  checked,
  onChange
}: {
  icon: React.ReactNode
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const colors = useColors()
  return (
    <div
      className="flex items-center justify-between gap-3"
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        cursor: 'default',
        transition: 'background 0.1s'
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.035)')
      }
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: colors.textTertiary, display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: 12, color: colors.textPrimary, letterSpacing: '-0.012em' }}>
          {label}
        </span>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

// ─── SettingInput ─────────────────────────────────────────────────────────────

function SettingInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  help
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
  help?: string
}) {
  const colors = useColors()
  return (
    <label
      className="flex flex-col gap-1.5"
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        cursor: 'default',
        transition: 'background 0.1s'
      }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)')
      }
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <span style={{ fontSize: 11.5, color: colors.textSecondary, letterSpacing: '-0.012em' }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        style={{
          width: '100%',
          height: 30,
          borderRadius: 8,
          border: `1px solid ${colors.popoverBorder}`,
          background: 'rgba(255,255,255,0.045)',
          color: colors.textPrimary,
          padding: '0 9px',
          fontSize: 11.5,
          outline: 'none',
          transition: 'border-color 0.12s'
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = colors.inputFocusBorder
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = colors.popoverBorder
        }}
      />
      {help && (
        <span style={{ fontSize: 10.5, color: colors.textTertiary, lineHeight: 1.4 }}>{help}</span>
      )}
    </label>
  )
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  const colors = useColors()
  return (
    <div
      style={{
        fontSize: 10,
        color: colors.textTertiary,
        padding: '10px 10px 4px',
        letterSpacing: '0.07em',
        textTransform: 'uppercase'
      }}
    >
      {children}
    </div>
  )
}

// ─── SettingsPopover ──────────────────────────────────────────────────────────

export function SettingsPopover() {
  const soundEnabled = useThemeStore((s) => s.soundEnabled)
  const setSoundEnabled = useThemeStore((s) => s.setSoundEnabled)
  const themeMode = useThemeStore((s) => s.themeMode)
  const setThemeMode = useThemeStore((s) => s.setThemeMode)
  const expandedUI = useThemeStore((s) => s.expandedUI)
  const setExpandedUI = useThemeStore((s) => s.setExpandedUI)
  const isExpanded = useSessionStore((s) => s.isExpanded)
  const open = useSessionStore((s) => s.settingsOpen)
  const toggleSettingsOpen = useSessionStore((s) => s.toggleSettingsOpen)
  const closeSettings = useSessionStore((s) => s.closeSettings)
  const popoverLayer = usePopoverLayer()
  const colors = useColors()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 })
  const ollamaConfig = useSessionStore((s) => s.ollamaConfig)
  const setOllamaConfig = useSessionStore((s) => s.setOllamaConfig)
  const toggleSkillsPanel = useSessionStore((s) => s.toggleSkillsPanel)

  const ollamaApiKey = ollamaConfig.apiKey || ''
  const ollamaBaseUrl = ollamaConfig.baseUrl || ''

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const right = window.innerWidth - rect.right
    if (isExpanded) setPos({ top: rect.bottom + 6, right })
    else setPos({ bottom: window.innerHeight - rect.top + 6, right })
  }, [isExpanded])

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      closeSettings()
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [closeSettings, open])

  useEffect(() => {
    if (!open) return
    let raf = 0
    const tick = () => {
      updatePos()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, expandedUI, isExpanded, updatePos])

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => {
          if (!open) updatePos()
          toggleSettingsOpen()
        }}
        className="flex-shrink-0 flex items-center justify-center rounded-full"
        style={{
          width: 24,
          height: 24,
          color: colors.textTertiary,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          transition: 'background 0.12s, color 0.12s'
        }}
        title="Settings"
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'
          ;(e.currentTarget as HTMLElement).style.color = colors.textSecondary
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
        }}
      >
        <DotsThree size={14} weight="bold" />
      </button>

      {popoverLayer &&
        open &&
        createPortal(
          <motion.div
            ref={popoverRef}
            data-yald-ui
            initial={{ opacity: 0, y: isExpanded ? -5 : 5, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isExpanded ? -4 : 4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed',
              ...(pos.top != null ? { top: pos.top } : {}),
              ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
              right: pos.right,
              width: 300,
              maxHeight: 420,
              pointerEvents: 'auto',
              borderRadius: 14,
              overflow: 'hidden',
              background: colors.popoverBg,
              backdropFilter: 'blur(44px) saturate(200%)',
              WebkitBackdropFilter: 'blur(44px) saturate(200%)',
              boxShadow: `${colors.popoverShadow}, 0 1px 0 rgba(255,255,255,0.1) inset`,
              border: `1px solid ${colors.popoverBorder}`
            }}
          >
            <div style={{ padding: '6px 4px', overflowY: 'auto', maxHeight: 420 }}>
              <SectionLabel>Display</SectionLabel>
              <SettingRow
                icon={<ArrowsOutSimple size={12} />}
                label="Full width"
                checked={expandedUI}
                onChange={setExpandedUI}
              />
              <SettingRow
                icon={<Moon size={12} />}
                label="Dark mode"
                checked={themeMode === 'dark'}
                onChange={(v) => setThemeMode(v ? 'dark' : 'light')}
              />
              <SettingRow
                icon={<Bell size={12} />}
                label="Notification sound"
                checked={soundEnabled}
                onChange={setSoundEnabled}
              />

              <div
                style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '6px 10px' }}
              />

              <SectionLabel>Voice & Providers</SectionLabel>
              <SettingInput
                label="Ollama API key"
                type="password"
                value={ollamaApiKey}
                onChange={(value) => setOllamaConfig({ ...ollamaConfig, apiKey: value })}
                placeholder="Optional if backend has one"
              />
              <SettingInput
                label="Backend URL"
                value={ollamaBaseUrl}
                onChange={(value) => setOllamaConfig({ ...ollamaConfig, baseUrl: value })}
                placeholder="http://127.0.0.1:8787"
                help="Leave empty for local backend."
              />

              <div style={{ padding: '8px 10px 4px' }}>
                <button
                  type="button"
                  onClick={() => {
                    closeSettings()
                    toggleSkillsPanel()
                  }}
                  style={{
                    width: '100%',
                    height: 32,
                    borderRadius: 8,
                    border: `1px solid ${colors.popoverBorder}`,
                    background: 'rgba(255,255,255,0.04)',
                    color: colors.textSecondary,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit',
                    transition: 'background 0.12s'
                  }}
                  onMouseEnter={(e) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'
                  }}
                  onMouseLeave={(e) => {
                    ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                  }}
                >
                  <HeadCircuit size={12} />
                  Prompt Skills
                </button>
              </div>
            </div>
          </motion.div>,
          popoverLayer
        )}
    </>
  )
}
