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
      className={`flex-shrink-0 ${pulse ? 'animate-pulse-dot' : ''}`}
      style={{
        width: 4,
        height: 4,
        borderRadius: '50%',
        background: bg,
        boxShadow: pulse ? `0 0 4px ${bg}` : 'none',
        display: 'block'
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
        padding: '5px 8px 5px 10px',
        borderBottom: `1px solid rgba(255,255,255,0.05)`,
        gap: 2,
        minHeight: 36
      }}
    >
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="flex items-center gap-0.5 overflow-x-auto"
          style={{
            scrollbarWidth: 'none',
            paddingRight: 8,
            maskImage:
              'linear-gradient(to right, black 0%, black calc(100% - 24px), transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, black 0%, black calc(100% - 24px), transparent 100%)'
          }}
        >
          <AnimatePresence mode="popLayout">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId
              return (
                <motion.div
                  key={tab.id}
                  layout
                  initial={{ opacity: 0, scale: 0.88, x: -6 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.88, x: -4 }}
                  transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                  onClick={() => selectTab(tab.id)}
                  className="group flex items-center gap-1.5 cursor-pointer select-none flex-shrink-0"
                  style={{
                    position: 'relative',
                    background: isActive ? 'rgba(255,255,255,0.07)' : 'transparent',
                    borderRadius: 7,
                    padding: '4px 8px 4px 7px',
                    maxWidth: 144,
                    transition: 'background 0.12s',
                    boxShadow: isActive
                      ? '0 1px 0 rgba(255,255,255,0.09) inset, 0 -1px 0 rgba(80,60,180,0.07) inset'
                      : 'none'
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
                  }}
                >
                  {isActive && (
                    <motion.div
                      layoutId="tab-indicator"
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: '20%',
                        right: '20%',
                        height: 1,
                        background: `linear-gradient(90deg, transparent, ${colors.accent}88, transparent)`,
                        borderRadius: 1
                      }}
                      transition={{ duration: 0.18 }}
                    />
                  )}

                  <StatusDot status={tab.status} hasUnread={tab.hasUnread} />

                  <span
                    className="truncate flex-1"
                    style={{
                      fontSize: 11.5,
                      color: isActive ? colors.textPrimary : colors.textTertiary,
                      fontWeight: isActive ? 500 : 400,
                      letterSpacing: '-0.012em'
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
                      className="flex-shrink-0 flex items-center justify-center rounded-full"
                      style={{
                        width: 13,
                        height: 13,
                        opacity: isActive ? 0.3 : 0,
                        color: colors.textSecondary,
                        background: 'rgba(255,255,255,0.07)',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'opacity 0.12s, background 0.12s'
                      }}
                      onMouseEnter={(e) => {
                        ;(e.currentTarget as HTMLElement).style.opacity = '1'
                        ;(e.currentTarget as HTMLElement).style.background =
                          'rgba(255,255,255,0.12)'
                      }}
                      onMouseLeave={(e) => {
                        ;(e.currentTarget as HTMLElement).style.opacity = isActive ? '0.3' : '0'
                        ;(e.currentTarget as HTMLElement).style.background =
                          'rgba(255,255,255,0.07)'
                      }}
                    >
                      <X size={7} weight="bold" />
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <div
          style={{ width: 1, height: 11, background: 'rgba(255,255,255,0.07)', margin: '0 4px' }}
        />
        <TabIconBtn title="New tab" onClick={() => createTab()}>
          <Plus size={11} />
        </TabIconBtn>
        <SettingsPopover />
      </div>
    </div>
  )
}

function TabIconBtn({
  children,
  title,
  onClick
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
}) {
  const colors = useColors()
  return (
    <button
      onClick={onClick}
      title={title}
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
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.07)'
        ;(e.currentTarget as HTMLElement).style.color = colors.textSecondary
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
      }}
    >
      {children}
    </button>
  )
}
