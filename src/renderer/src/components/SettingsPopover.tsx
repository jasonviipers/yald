// ─── SettingsPopover.tsx ─────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { DotsThree, Bell, ArrowsOutSimple, Moon, HeadCircuit } from '@phosphor-icons/react'
import { useThemeStore } from '../lib/theme'
import { useSessionStore } from '../stores/sessionStore'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../lib/theme'

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
        width: 32,
        height: 18,
        borderRadius: 9999,
        background: checked ? colors.accent : 'rgba(255,255,255,0.1)',
        border: `1px solid ${checked ? colors.accent : 'rgba(255,255,255,0.12)'}`,
        transition: 'background 0.2s, border-color 0.2s',
        cursor: 'pointer',
        flexShrink: 0
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          left: checked ? 15 : 2,
          width: 13,
          height: 13,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          transition: 'left 0.18s cubic-bezier(0.34,1.2,0.64,1)'
        }}
      />
    </button>
  )
}

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
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-all"
      style={{ cursor: 'default' }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)')
      }
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: colors.textTertiary }}>{icon}</span>
        <span style={{ fontSize: 12, color: colors.textPrimary, letterSpacing: '-0.01em' }}>
          {label}
        </span>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

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
      className="flex flex-col gap-1 px-3 py-2 rounded-lg transition-all"
      style={{ cursor: 'default' }}
      onMouseEnter={(e) =>
        ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)')
      }
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <span style={{ fontSize: 12, color: colors.textPrimary, letterSpacing: '-0.01em' }}>
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
          height: 32,
          borderRadius: 10,
          border: `1px solid ${colors.popoverBorder}`,
          background: 'rgba(255,255,255,0.06)',
          color: colors.textPrimary,
          padding: '0 10px',
          fontSize: 12,
          outline: 'none'
        }}
      />
      {help && (
        <span style={{ fontSize: 11, color: colors.textTertiary, lineHeight: 1.35 }}>{help}</span>
      )}
    </label>
  )
}

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
        className="flex-shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full transition-all"
        style={{ color: colors.textTertiary }}
        title="Settings"
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
          ;(e.currentTarget as HTMLElement).style.color = colors.textSecondary
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
        }}
      >
        <DotsThree size={15} weight="bold" />
      </button>

      {popoverLayer &&
        open &&
        createPortal(
          <motion.div
            ref={popoverRef}
            data-yald-ui
            initial={{ opacity: 0, y: isExpanded ? -6 : 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: isExpanded ? -4 : 4, scale: 0.96 }}
            transition={{ duration: 0.16, ease: [0.34, 1.2, 0.64, 1] }}
            style={{
              position: 'fixed',
              ...(pos.top != null ? { top: pos.top } : {}),
              ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
              right: pos.right,
              width: 320,
              maxHeight: 420,
              pointerEvents: 'auto',
              borderRadius: 16,
              overflow: 'hidden',
              background: colors.popoverBg,
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              boxShadow: `${colors.popoverShadow}, 0 1px 0 rgba(255,255,255,0.12) inset`,
              border: `1px solid ${colors.popoverBorder}`
            }}
          >
            <div style={{ padding: '6px 4px', overflowY: 'auto', maxHeight: 420 }}>
              <div
                style={{
                  fontSize: 10,
                  color: colors.textTertiary,
                  padding: '4px 12px 6px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase'
                }}
              >
                Preferences
              </div>
              <SettingRow
                icon={<ArrowsOutSimple size={13} />}
                label="Full width"
                checked={expandedUI}
                onChange={setExpandedUI}
              />
              <SettingRow
                icon={<Bell size={13} />}
                label="Notification sound"
                checked={soundEnabled}
                onChange={setSoundEnabled}
              />
              <SettingRow
                icon={<Moon size={13} />}
                label="Dark mode"
                checked={themeMode === 'dark'}
                onChange={(v) => setThemeMode(v ? 'dark' : 'light')}
              />

              <div
                style={{
                  fontSize: 10,
                  color: colors.textTertiary,
                  padding: '10px 12px 6px',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase'
                }}
              >
                Voice And Providers
              </div>

              <SettingInput
                label="Ollama API key"
                type="password"
                value={ollamaApiKey}
                onChange={(value) => setOllamaConfig({ ...ollamaConfig, apiKey: value })}
                placeholder="Optional if the backend already has one"
              />

              <SettingInput
                label="Backend URL"
                value={ollamaBaseUrl}
                onChange={(value) => setOllamaConfig({ ...ollamaConfig, baseUrl: value })}
                placeholder="http://127.0.0.1:8787"
                help="Electron now targets the Bun backend by default. Leave this empty for the local backend, or set it to another backend URL."
              />

              <div style={{ padding: '6px 12px 2px' }}>
                <button
                  type="button"
                  onClick={() => {
                    closeSettings()
                    toggleSkillsPanel()
                  }}
                  style={{
                    width: '100%',
                    height: 34,
                    borderRadius: 10,
                    border: `1px solid ${colors.popoverBorder}`,
                    background: 'rgba(255,255,255,0.06)',
                    color: colors.textPrimary,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: 'inherit'
                  }}
                >
                  <HeadCircuit size={13} />
                  Open Prompt Skills
                </button>
              </div>
            </div>
          </motion.div>,
          popoverLayer
        )}
    </>
  )
}
