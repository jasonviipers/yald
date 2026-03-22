import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  SparkleIcon,
  CurrencyDollarIcon,
  TrashIcon,
  CpuIcon,
  QuestionIcon
} from '@phosphor-icons/react'
import { usePopoverLayer } from './PopoverLayer'
import { useColors } from '../lib/theme'

export interface SlashCommand {
  command: string
  description: string
  icon: React.ReactNode
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear conversation', icon: <TrashIcon size={12} /> },
  { command: '/cost', description: 'Show usage & cost', icon: <CurrencyDollarIcon size={12} /> },
  { command: '/skills', description: 'Available skills', icon: <SparkleIcon size={12} /> },
  { command: '/model', description: 'Switch model', icon: <CpuIcon size={12} /> },
  { command: '/help', description: 'Show all commands', icon: <QuestionIcon size={12} /> }
]

export function getFilteredCommands(f: string) {
  return getFilteredCommandsWithExtras(f, [])
}
export function getFilteredCommandsWithExtras(f: string, extra: SlashCommand[]): SlashCommand[] {
  const q = f.toLowerCase()
  const merged = [...SLASH_COMMANDS]
  for (const cmd of extra) {
    if (!merged.some((c) => c.command === cmd.command)) merged.push(cmd)
  }
  return merged.filter((c) => c.command.startsWith(q))
}

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
      initial={{ opacity: 0, y: 6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.97 }}
      transition={{ duration: 0.14, ease: [0.34, 1.2, 0.64, 1] }}
      style={{
        position: 'fixed',
        bottom: window.innerHeight - anchorRect.top + 6,
        left: anchorRect.left + 8,
        right: window.innerWidth - anchorRect.right + 8,
        pointerEvents: 'auto',
        borderRadius: 14,
        overflow: 'hidden',
        background: colors.popoverBg,
        backdropFilter: 'blur(40px) saturate(200%)',
        WebkitBackdropFilter: 'blur(40px) saturate(200%)',
        boxShadow: `${colors.popoverShadow}, 0 1px 0 rgba(255,255,255,0.1) inset`,
        border: `1px solid ${colors.popoverBorder}`
      }}
    >
      <div ref={listRef} style={{ padding: '4px', maxHeight: 220, overflowY: 'auto' }}>
        {filtered.map((cmd, i) => {
          const isSel = i === selectedIndex
          return (
            <button
              key={cmd.command}
              onClick={() => onSelect(cmd)}
              className="w-full flex items-center gap-2.5 rounded-lg transition-all"
              style={{
                padding: '7px 10px',
                background: isSel ? colors.accentLight : 'transparent',
                textAlign: 'left'
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.background = colors.accentLight)
              }
              onMouseLeave={(e) => {
                if (!isSel) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <span
                className="flex items-center justify-center rounded-md flex-shrink-0"
                style={{
                  width: 24,
                  height: 24,
                  background: isSel ? colors.accentSoft : 'rgba(255,255,255,0.06)',
                  color: isSel ? colors.accent : colors.textTertiary
                }}
              >
                {cmd.icon}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 500,
                    color: isSel ? colors.accent : colors.textPrimary
                  }}
                >
                  {cmd.command}
                </span>
                <span style={{ fontSize: 11, marginLeft: 8, color: colors.textTertiary }}>
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
