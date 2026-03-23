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
  'engineer',
  'sandbox',
  'browser',
  'qa'
]

const STAGE_LABELS: Record<PipelineStage['id'], string> = {
  skill_inventory_check: 'skill inventory',
  brainstorm: 'brainstorm',
  skill_forge: 'skill forge',
  engineer: 'engineer',
  sandbox: 'sandbox',
  browser: 'browser',
  qa: 'qa'
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
  ) {
    return null
  }

  const activeStage =
    pipelineState.activeStage && STAGE_LABELS[pipelineState.activeStage]
      ? STAGE_LABELS[pipelineState.activeStage]
      : null
  const lastLines = pipelineState.log.slice(-5)

  return (
    <div
      data-yald-ui
      style={{
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 360
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '16px 18px 12px',
          borderBottom: `1px solid ${colors.containerBorder}`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 12,
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
                <SpinnerGap size={16} />
              </motion.span>
            ) : pipelineState.error ? (
              <WarningCircle size={16} />
            ) : (
              <CheckCircle size={16} weight="fill" />
            )}
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
              Vibe Pipeline
            </div>
            <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
              {pipelineState.activeStage
                ? `running ${activeStage}`
                : pipelineState.error
                  ? 'failed'
                  : 'complete'}
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 10,
            color: colors.textTertiary
          }}
        >
          <span>{activeTabId.slice(0, 8)}</span>
          {pipelineState.sandboxUrl && (
            <button
              onClick={() => void window.yald.openExternal(pipelineState.sandboxUrl!)}
              style={{
                height: 28,
                padding: '0 10px',
                borderRadius: 9999,
                border: `1px solid ${colors.accentBorder}`,
                background: colors.accentLight,
                color: colors.accent,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'inherit'
              }}
              title="Open sandbox preview"
            >
              <LinkSimple size={11} />
              live preview
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
            gap: 8
          }}
        >
          {STAGE_ORDER.map((stageId) => {
            const stage = pipelineState.stages.find((item) => item.id === stageId)
            const color =
              stage?.status === 'complete'
                ? colors.statusComplete
                : stage?.status === 'running'
                  ? colors.accent
                  : stage?.status === 'failed'
                    ? colors.statusError
                    : colors.textTertiary

            return (
              <div
                key={stageId}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${stage?.status === 'running' ? colors.accentBorderMedium : colors.containerBorder}`,
                  background:
                    stage?.status === 'complete'
                      ? colors.statusCompleteBg
                      : stage?.status === 'running'
                        ? colors.accentLight
                        : colors.surfacePrimary,
                  padding: '10px 10px 8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {stage?.status === 'complete' ? (
                    <CheckCircle size={12} weight="fill" style={{ color }} />
                  ) : stage?.status === 'failed' ? (
                    <WarningCircle size={12} weight="fill" style={{ color }} />
                  ) : (
                    <Circle
                      size={12}
                      weight={stage?.status === 'running' ? 'fill' : 'regular'}
                      style={{ color }}
                    />
                  )}
                  <span style={{ fontSize: 10, color, textTransform: 'capitalize' }}>
                    {STAGE_LABELS[stageId]}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <div
          style={{
            borderRadius: 16,
            border: `1px solid ${colors.containerBorder}`,
            background: colors.surfacePrimary,
            padding: '12px 14px'
          }}
        >
          <div
            style={{ fontSize: 11, fontWeight: 600, color: colors.textPrimary, marginBottom: 8 }}
          >
            Recent log
          </div>
          <pre
            style={{
              margin: 0,
              borderRadius: 12,
              background: colors.codeBg,
              color: colors.textSecondary,
              padding: '10px 12px',
              fontSize: 11,
              lineHeight: 1.55,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {lastLines.length > 0 ? lastLines.join('\n') : '[pipeline] waiting'}
          </pre>
        </div>

        {pipelineState.error && (
          <div
            style={{
              marginTop: -2,
              borderRadius: 12,
              padding: '10px 12px',
              background: colors.statusErrorBg,
              color: colors.statusError,
              fontSize: 11,
              lineHeight: 1.5
            }}
          >
            {pipelineState.error}
          </div>
        )}

        {pipelineState.deliverySummary && (
          <div
            style={{
              borderRadius: 16,
              border: `1px solid ${colors.containerBorder}`,
              background: colors.surfacePrimary,
              padding: '14px 14px 12px'
            }}
          >
            <div
              style={{ fontSize: 11, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
            >
              Delivery summary
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
