import type { ReactElement } from 'react'
import { motion } from 'framer-motion'
import { SpinnerGap, CheckCircle, Circle, WarningCircle, LinkSimple } from '@phosphor-icons/react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useColors } from '../lib/theme'
import { useSessionStore } from '../stores/sessionStore'
import type { PipelineStage } from '@shared/types'

const STAGE_ORDER: PipelineStage['id'][] = [
  'skill_inventory_check',
  'brainstorm',
  'skill_forge',
  'engineer',
  'sandbox',
  'browser',
  'qa'
]

const STAGE_LABELS: Record<PipelineStage['id'], string> = {
  skill_inventory_check: 'Inventory',
  brainstorm: 'Brainstorm',
  skill_forge: 'Forge',
  engineer: 'Engineer',
  sandbox: 'Sandbox',
  browser: 'Browser',
  qa: 'QA'
}

export function PipelineStatus(): ReactElement | null {
  const colors = useColors()
  const activeTabId = useSessionStore((state) => state.activeTabId)
  const pipelineState = useSessionStore(
    (state) => state.pipelineStateByTab[state.activeTabId] || null
  )

  if (
    !pipelineState ||
    (!pipelineState.activeStage &&
      !pipelineState.deliverySummary &&
      !pipelineState.error &&
      !pipelineState.sandboxUrl &&
      pipelineState.log.length === 0)
  )
    return null

  const activeStageLabel =
    pipelineState.activeStage && STAGE_LABELS[pipelineState.activeStage]
      ? STAGE_LABELS[pipelineState.activeStage]
      : null
  const lastLines = pipelineState.log.slice(-5)

  return (
    <div data-yald-ui style={{ display: 'flex', flexDirection: 'column', maxHeight: 360 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 16px 11px',
          borderBottom: `1px solid rgba(255,255,255,0.055)`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: pipelineState.error ? colors.statusErrorBg : colors.accentLight,
              color: pipelineState.error ? colors.statusError : colors.accent
            }}
          >
            {pipelineState.activeStage ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                style={{ display: 'inline-flex' }}
              >
                <SpinnerGap size={14} />
              </motion.span>
            ) : pipelineState.error ? (
              <WarningCircle size={14} />
            ) : (
              <CheckCircle size={14} weight="fill" />
            )}
          </span>
          <div>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: colors.textPrimary,
                letterSpacing: '-0.015em'
              }}
            >
              Vibe Pipeline
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: colors.textTertiary,
                marginTop: 1,
                letterSpacing: '-0.01em'
              }}
            >
              {pipelineState.activeStage
                ? `Running ${activeStageLabel}`
                : pipelineState.error
                  ? 'Failed'
                  : 'Complete'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              color: colors.textTertiary,
              fontFamily: 'ui-monospace, monospace',
              opacity: 0.6
            }}
          >
            {activeTabId.slice(0, 8)}
          </span>
          {pipelineState.sandboxUrl && (
            <button
              onClick={() => void window.yald.openExternal(pipelineState.sandboxUrl!)}
              style={{
                height: 26,
                padding: '0 9px',
                borderRadius: 9999,
                border: `1px solid ${colors.accentBorder}`,
                background: colors.accentLight,
                color: colors.accent,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10.5,
                fontWeight: 500,
                fontFamily: 'inherit',
                transition: 'background 0.12s'
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = colors.accentSoft
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = colors.accentLight
              }}
            >
              <LinkSimple size={10} />
              Preview
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div
        style={{
          padding: '12px 14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        {/* Stage grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${STAGE_ORDER.length}, minmax(0, 1fr))`,
            gap: 6
          }}
        >
          {STAGE_ORDER.map((stageId) => {
            const stage = pipelineState.stages.find((item) => item.id === stageId)
            const isRunning = stage?.status === 'running'
            const isComplete = stage?.status === 'complete'
            const isFailed = stage?.status === 'failed'

            const dotColor = isComplete
              ? colors.statusComplete
              : isRunning
                ? colors.accent
                : isFailed
                  ? colors.statusError
                  : colors.textTertiary

            return (
              <div
                key={stageId}
                style={{
                  borderRadius: 9,
                  border: `1px solid ${isRunning ? colors.accentBorderMedium : colors.containerBorder}`,
                  background: isComplete
                    ? colors.statusCompleteBg
                    : isRunning
                      ? colors.accentLight
                      : colors.surfacePrimary,
                  padding: '8px 8px 7px',
                  transition: 'border-color 0.15s, background 0.15s'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  {isComplete ? (
                    <CheckCircle
                      size={10}
                      weight="fill"
                      style={{ color: dotColor, flexShrink: 0 }}
                    />
                  ) : isFailed ? (
                    <WarningCircle
                      size={10}
                      weight="fill"
                      style={{ color: dotColor, flexShrink: 0 }}
                    />
                  ) : (
                    <Circle
                      size={10}
                      weight={isRunning ? 'fill' : 'regular'}
                      style={{ color: dotColor, flexShrink: 0 }}
                    />
                  )}
                  <span
                    style={{
                      fontSize: 9.5,
                      color: dotColor,
                      letterSpacing: '-0.01em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {STAGE_LABELS[stageId]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Log */}
        <div
          style={{
            borderRadius: 10,
            border: `1px solid ${colors.containerBorder}`,
            background: colors.surfacePrimary,
            padding: '10px 12px'
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: colors.textTertiary,
              marginBottom: 6,
              letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}
          >
            Log
          </div>
          <pre
            style={{
              margin: 0,
              borderRadius: 8,
              background: colors.codeBg,
              color: colors.textSecondary,
              padding: '9px 11px',
              fontSize: 10.5,
              lineHeight: 1.55,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {lastLines.length > 0 ? lastLines.join('\n') : '[pipeline] waiting…'}
          </pre>
        </div>

        {/* Error */}
        {pipelineState.error && (
          <div
            style={{
              borderRadius: 9,
              padding: '9px 11px',
              background: colors.statusErrorBg,
              color: colors.statusError,
              fontSize: 11,
              lineHeight: 1.5
            }}
          >
            {pipelineState.error}
          </div>
        )}

        {/* Delivery summary */}
        {pipelineState.deliverySummary && (
          <div
            style={{
              borderRadius: 10,
              border: `1px solid ${colors.containerBorder}`,
              background: colors.surfacePrimary,
              padding: '12px 13px'
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: colors.textTertiary,
                marginBottom: 8,
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}
            >
              Summary
            </div>
            <div
              className="prose prose-sm max-w-none"
              style={{ fontSize: 12, color: colors.textPrimary, lineHeight: 1.6 }}
            >
              <Markdown remarkPlugins={[remarkGfm]}>{pipelineState.deliverySummary}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
