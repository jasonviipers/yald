import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X } from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { SettingsPopover } from './SettingsPopover'
import { useColors } from '../lib/theme'
import type { TabStatus } from '@shared/types'

function StatusDot({ status, hasUnread }: { status: TabStatus; hasUnread: boolean }) {
  const colors = useColors()
  let bg = colors.statusIdle
  let pulse = false

  if (status === 'dead' || status === 'failed') bg = colors.statusError
  else if (status === 'connecting' || status === 'running') {
    bg = colors.statusRunning
    pulse = true
  } else if (hasUnread) bg = colors.statusComplete

  return (
    <span
      className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${pulse ? 'animate-pulse-dot' : ''}`}
      style={{
        background: bg,
        boxShadow: pulse ? `0 0 4px ${bg}` : 'none'
      }}
    />
  )
}

export function TabStrip() {
  const tabs = useSessionStore((s) => s.tabs)
  const activeTabId = useSessionStore((s) => s.activeTabId)
  const selectTab = useSessionStore((s) => s.selectTab)
  const createTab = useSessionStore((s) => s.createTab)
  const closeTab = useSessionStore((s) => s.closeTab)
  const colors = useColors()

  return (
    <div
      data-yald-ui
      className="flex items-center no-drag"
      style={{
        padding: '6px 6px 6px 8px',
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
        gap: 4
      }}
    >
      {/* Scrollable tabs */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="flex items-center gap-1 overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            paddingRight: 12,
            maskImage:
              'linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, black 0%, black calc(100% - 32px), transparent 100%)'
          }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.88, x: -8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.88, x: -4 }}
                  transition={{ duration: 0.18, ease: [0.34, 1.2, 0.64, 1] }}
                  onClick={() => selectTab(tab.id)}
                  className="group flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"
                  style={{
                    position: 'relative',
                    background: isActive ? 'rgba(255,255,255,0.09)' : 'transparent',
                    borderRadius: 9,
                    padding: '4px 10px 4px 8px',
                    maxWidth: 160,
                    transition: 'background 0.15s, box-shadow 0.15s',
                    boxShadow: isActive
                      ? '0 1px 0 rgba(255,255,255,0.14) inset, 0 -1px 0 rgba(100,60,255,0.1) inset, 0 2px 8px rgba(0,0,0,0.18)'
                      : 'none'
                  }}
                >
                  {/* Active indicator line */}
                  {isActive && (
                    <motion.div
                      layoutId="tab-indicator"
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: '20%',
                        right: '20%',
                        height: 1.5,
                        background: `linear-gradient(90deg, transparent, ${colors.accent}, transparent)`,
                        borderRadius: 1
                      }}
                      transition={{ duration: 0.2 }}
                    />
                  )}

                  <StatusDot status={tab.status} hasUnread={tab.hasUnread} />

                  <span
                    className="truncate flex-1"
                    style={{
                      fontSize: 12,
                      color: isActive ? colors.textPrimary : colors.textTertiary,
                      fontWeight: isActive ? 500 : 400,
                      letterSpacing: '-0.01em'
                    }}
                  >
                    {tab.title}
                  </span>

                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(tab.id)
                      }}
                      className="flex-shrink-0 w-[14px] h-[14px] rounded-full flex items-center justify-center transition-all"
                      style={{
                        opacity: 0,
                        color: colors.textSecondary,
                        background: 'rgba(255,255,255,0.08)'
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLElement
                        el.style.opacity = '1'
                        el.style.background = 'rgba(255,255,255,0.14)'
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLElement
                        el.style.opacity = isActive ? '0.45' : '0'
                        el.style.background = 'rgba(255,255,255,0.08)'
                      }}
                    >
                      <X size={8} weight="bold" />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {[
          { key: 'new', title: 'New tab', icon: <Plus size={13} />, onClick: () => createTab() }
        ].map(({ key, title, icon, onClick }) => (
          <button
            key={key}
            onClick={onClick}
            title={title}
            className="flex-shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-full transition-all"
            style={{ color: colors.textTertiary }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'
              ;(e.currentTarget as HTMLElement).style.color = colors.textSecondary
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
            }}
          >
            {icon}
          </button>
        ))}

        <div
          style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }}
        />

        <SettingsPopover />
      </div>
    </div>
  )
}
