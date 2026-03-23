import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, Image, FileCode, File } from '@phosphor-icons/react'
import { useColors } from '../lib/theme'
import type { Attachment } from '@shared/types'

const FILE_ICONS: Record<string, React.ReactNode> = {
  'image/png': <Image size={11} />,
  'image/jpeg': <Image size={11} />,
  'image/gif': <Image size={11} />,
  'image/webp': <Image size={11} />,
  'image/svg+xml': <Image size={11} />,
  'text/plain': <FileText size={11} />,
  'text/markdown': <FileText size={11} />,
  'application/json': <FileCode size={11} />,
  'text/yaml': <FileCode size={11} />,
  'text/toml': <FileCode size={11} />
}

export function AttachmentChips({
  attachments,
  onRemove
}: {
  attachments: Attachment[]
  onRemove: (id: string) => void
}) {
  const colors = useColors()
  if (attachments.length === 0) return null

  return (
    <div className="flex gap-1.5 pb-1" style={{ overflowX: 'auto', scrollbarWidth: 'none' }}>
      <AnimatePresence mode="popLayout">
        {attachments.map((a) => (
          <motion.div
            key={a.id}
            layout
            initial={{ opacity: 0, scale: 0.8, x: -4 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.13, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-1.5 group flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.055)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.08) inset',
              borderRadius: 8,
              padding: a.dataUrl ? '2px 7px 2px 2px' : '3px 7px 3px 6px',
              maxWidth: 190,
              backdropFilter: 'blur(10px)'
            }}
          >
            {a.dataUrl ? (
              <img
                src={a.dataUrl}
                alt={a.name}
                className="rounded-[6px] object-cover flex-shrink-0"
                style={{ width: 20, height: 20 }}
              />
            ) : (
              <span className="flex-shrink-0" style={{ color: colors.textTertiary }}>
                {FILE_ICONS[a.mimeType || ''] || <File size={11} />}
              </span>
            )}

            <span
              className="text-[10.5px] truncate min-w-0 flex-1"
              style={{ color: colors.textSecondary, letterSpacing: '-0.01em', fontWeight: 400 }}
            >
              {a.name}
            </span>

            <button
              onClick={() => onRemove(a.id)}
              className="flex-shrink-0 flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                width: 13,
                height: 13,
                color: colors.textTertiary,
                background: 'rgba(255,255,255,0.09)',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <X size={7} weight="bold" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
