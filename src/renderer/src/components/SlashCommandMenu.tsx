import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../lib/theme'
import { getFilteredCommandsWithExtras, type SlashCommand } from '../lib/slash-commands'

export function SlashCommandMenu({
  filter,
  selectedIndex,
  onSelect,
  anchorRect,
  extraCommands = []
}: {
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  anchorRect: DOMRect | null
  extraCommands?: SlashCommand[]
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const popoverLayer = usePopoverLayer()
  const filtered = getFilteredCommandsWithExtras(filter, extraCommands)
  const colors = useColors()

  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0 || !anchorRect || !popoverLayer) return null

  return createPortal(
    <motion.div
      data-yald-ui
      initial={{ opacity: 0, y: 5, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 3, scale: 0.97 }}
      transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
      style={{
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 8,
        left: anchorRect.left + 6,
        right: window.innerWidth - anchorRect.right + 6,
        pointerEvents: 'auto',
        borderRadius: 12,
        overflow: 'hidden',
        background: colors.popoverBg,
        backdropFilter: 'blur(40px) saturate(210%)',
        WebkitBackdropFilter: 'blur(40px) saturate(210%)',
        boxShadow: `${colors.popoverShadow}, 0 1px 0 rgba(255,255,255,0.09) inset`,
        border: `1px solid ${colors.popoverBorder}`
      }}
    >
      {/* Header label */}
      <div
        style={{
          padding: '8px 10px 4px',
          fontSize: 10,
          color: colors.textTertiary,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          borderBottom: `1px solid rgba(255,255,255,0.05)`
        }}
      >
        Commands
      </div>

      <div
        ref={listRef}
        className="hide-scrollbar"
        style={{ padding: '4px', maxHeight: 200, overflowY: 'auto' }}
      >
        {filtered.map((cmd, i) => {
          const isSel = i === selectedIndex
          return (
            <button
              key={cmd.command}
              onClick={() => onSelect(cmd)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                padding: '6px 8px',
                borderRadius: 7,
                background: isSel ? colors.accentLight : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = colors.accentLight)
              }
              onMouseLeave={(e) => {
                if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {/* Icon badge */}
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: isSel ? colors.accentSoft : 'rgba(255,255,255,0.05)',
                  color: isSel ? colors.accent : colors.textTertiary
                }}
              >
                {cmd.icon}
              </span>

              {/* Text */}
              <div
                style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 7 }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 500,
                    color: isSel ? colors.accent : colors.textPrimary,
                    letterSpacing: '-0.01em'
                  }}
                >
                  {cmd.command}
                </span>
                <span style={{ fontSize: 11, color: colors.textTertiary, flexShrink: 0 }}>
                  {cmd.description}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </motion.div>,
    popoverLayer
  )
}
