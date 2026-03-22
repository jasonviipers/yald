import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, FileText, Image, FileCode, File } from '@phosphor-icons/react'
import { useColors } from '../lib/theme'
import type { Attachment } from '@shared/types'

const FILE_ICONS: Record<string, React.ReactNode> = {
  'image/png': <Image size={12} />,
  'image/jpeg': <Image size={12} />,
  'image/gif': <Image size={12} />,
  'image/webp': <Image size={12} />,
  'image/svg+xml': <Image size={12} />,
  'text/plain': <FileText size={12} />,
  'text/markdown': <FileText size={12} />,
  'application/json': <FileCode size={12} />,
  'text/yaml': <FileCode size={12} />,
  'text/toml': <FileCode size={12} />
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
            initial={{ opacity: 0, scale: 0.82, x: -6 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.82 }}
            transition={{ duration: 0.14, ease: [0.34, 1.2, 0.64, 1] }}
            className="flex items-center gap-1.5 group flex-shrink-0"
            style={{
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset',
              borderRadius: 10,
              padding: a.dataUrl ? '3px 8px 3px 3px' : '4px 8px 4px 6px',
              maxWidth: 200,
              backdropFilter: 'blur(12px)'
            }}
          >
            {a.dataUrl ? (
              <img
                src={a.dataUrl}
                alt={a.name}
                className="rounded-[7px] object-cover flex-shrink-0"
                style={{ width: 22, height: 22 }}
              />
            ) : (
              <span className="flex-shrink-0" style={{ color: colors.textTertiary }}>
                {FILE_ICONS[a.mimeType || ''] || <File size={12} />}
              </span>
            )}
            <span
              className="text-[11px] font-medium truncate min-w-0 flex-1"
              style={{ color: colors.textPrimary, letterSpacing: '-0.01em' }}
            >
              {a.name}
            </span>
            <button
              onClick={() => onRemove(a.id)}
              className="flex-shrink-0 w-[14px] h-[14px] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: colors.textTertiary, background: 'rgba(255,255,255,0.1)' }}
            >
              <X size={8} weight="bold" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
