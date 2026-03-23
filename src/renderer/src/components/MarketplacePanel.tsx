import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  X,
  SpinnerGap,
  Sparkle,
  Plus,
  CheckCircle,
  Circle,
  Trash,
  ArrowClockwise
} from '@phosphor-icons/react'
import { useSessionStore } from '../stores/sessionStore'
import { useColors } from '../lib/theme'
import type { SkillMeta } from '@shared/types'

export function MarketplacePanel() {
  const colors = useColors()
  const installedSkills = useSessionStore((s) => s.installedSkills)
  const selectedSkillIds = useSessionStore((s) => s.selectedSkillIds)
  const closeSkillsPanel = useSessionStore((s) => s.closeSkillsPanel)
  const toggleSkillSelection = useSessionStore((s) => s.toggleSkillSelection)
  const installSkill = useSessionStore((s) => s.installSkill)
  const uninstallSkill = useSessionStore((s) => s.uninstallSkill)
  const refreshInstalledSkills = useSessionStore((s) => s.refreshInstalledSkills)

  const [pendingInstall, setPendingInstall] = useState(false)
  const [busySkillId, setBusySkillId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enabledCount = useMemo(
    () => installedSkills.filter((s) => selectedSkillIds.includes(s.id)).length,
    [installedSkills, selectedSkillIds]
  )

  const handleInstall = async () => {
    setPendingInstall(true)
    setError(null)
    try {
      await installSkill()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.toLowerCase().includes('cancelled')) setError(message || 'Installation failed')
    } finally {
      setPendingInstall(false)
    }
  }

  const handleUninstall = async (skillId: string) => {
    setBusySkillId(skillId)
    setError(null)
    try {
      await uninstallSkill(skillId)
    } catch (err) {
      const message = err instanceof Error ? err.message || String(err) : String(err)
      setError(message && message.trim() ? message : 'Removal failed')
    } finally {
      setBusySkillId(null)
    }
  }

  const handleRefresh = async () => {
    setError(null)
    try {
      await refreshInstalledSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message || String(err) : String(err)
      setError(message && message.trim() ? message : 'Refresh failed')
    }
  }

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
              background: colors.accentLight,
              color: colors.accent
            }}
          >
            <Sparkle size={14} />
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
              Prompt Skills
            </div>
            <div
              style={{
                fontSize: 10.5,
                color: colors.textTertiary,
                marginTop: 1,
                letterSpacing: '-0.01em'
              }}
            >
              {enabledCount} enabled · {installedSkills.length} installed
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={handleInstall}
            disabled={pendingInstall}
            style={{
              height: 28,
              padding: '0 10px',
              borderRadius: 9999,
              border: `1px solid ${colors.accentBorder}`,
              background: colors.accentLight,
              color: colors.accent,
              cursor: pendingInstall ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 500,
              fontFamily: 'inherit',
              transition: 'background 0.12s'
            }}
            onMouseEnter={(e) => {
              if (!pendingInstall)
                (e.currentTarget as HTMLElement).style.background = colors.accentSoft
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.background = colors.accentLight
            }}
          >
            <Plus size={11} />
            {pendingInstall ? 'Installing…' : 'Install'}
          </button>

          <PanelIconBtn onClick={handleRefresh} title="Refresh">
            <ArrowClockwise size={13} />
          </PanelIconBtn>
          <PanelIconBtn onClick={closeSkillsPanel} title="Close">
            <X size={13} />
          </PanelIconBtn>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            margin: '10px 14px 0',
            borderRadius: 9,
            padding: '8px 11px',
            background: colors.statusErrorBg,
            color: colors.statusError,
            fontSize: 11,
            lineHeight: 1.5
          }}
        >
          {error}
        </div>
      )}

      {/* Body */}
      <div
        style={{
          padding: '12px 14px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {installedSkills.length === 0 ? (
          <div
            style={{
              borderRadius: 12,
              border: `1px dashed ${colors.containerBorder}`,
              padding: '18px 16px',
              background: colors.surfacePrimary
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                color: colors.textPrimary,
                letterSpacing: '-0.015em'
              }}
            >
              No skills installed
            </div>
            <div
              style={{ fontSize: 11, color: colors.textTertiary, marginTop: 5, lineHeight: 1.55 }}
            >
              Install a local{' '}
              <code
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  background: colors.codeBg,
                  padding: '1px 4px',
                  borderRadius: 3
                }}
              >
                SKILL.md
              </code>{' '}
              file to append guidance to future runs.
            </div>
          </div>
        ) : (
          installedSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              enabled={selectedSkillIds.includes(skill.id)}
              busy={busySkillId === skill.id}
              colors={colors}
              onToggle={() => toggleSkillSelection(skill.id)}
              onUninstall={() => void handleUninstall(skill.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PanelIconBtn({
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
      aria-label={title}
      title={title}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: colors.textTertiary,
        padding: 4,
        display: 'flex',
        borderRadius: 6,
        transition: 'color 0.12s, background 0.12s'
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLElement).style.color = colors.textPrimary
        ;(e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
        ;(e.currentTarget as HTMLElement).style.background = 'none'
      }}
    >
      {children}
    </button>
  )
}

// ─── SkillCard ────────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  enabled,
  busy,
  colors,
  onToggle,
  onUninstall
}: {
  skill: SkillMeta
  enabled: boolean
  busy: boolean
  colors: ReturnType<typeof useColors>
  onToggle: () => void
  onUninstall: () => void
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${enabled ? colors.accentBorderMedium : colors.containerBorder}`,
        background: enabled ? colors.surfaceActive : colors.surfacePrimary,
        padding: '12px 13px 10px',
        transition: 'border-color 0.15s, background 0.15s'
      }}
    >
      {/* Top: toggle + content + remove */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 10
        }}
      >
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            textAlign: 'left',
            flex: 1
          }}
        >
          <span style={{ color: enabled ? colors.accent : colors.textTertiary, marginTop: 1 }}>
            {enabled ? <CheckCircle size={15} weight="fill" /> : <Circle size={15} />}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 12.5,
                fontWeight: 500,
                color: colors.textPrimary,
                letterSpacing: '-0.015em'
              }}
            >
              {skill.name}
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 11,
                color: colors.textTertiary,
                marginTop: 4,
                lineHeight: 1.5,
                letterSpacing: '-0.01em'
              }}
            >
              {skill.description}
            </span>
          </span>
        </button>

        <button
          onClick={onUninstall}
          disabled={busy}
          style={{
            borderRadius: 7,
            border: `1px solid ${colors.containerBorder}`,
            background: 'transparent',
            color: colors.textTertiary,
            cursor: busy ? 'wait' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 10.5,
            fontWeight: 500,
            padding: '5px 9px',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            transition: 'all 0.12s'
          }}
          onMouseEnter={(e) => {
            if (!busy) {
              ;(e.currentTarget as HTMLElement).style.color = colors.statusError
              ;(e.currentTarget as HTMLElement).style.borderColor = colors.statusError
            }
          }}
          onMouseLeave={(e) => {
            ;(e.currentTarget as HTMLElement).style.color = colors.textTertiary
            ;(e.currentTarget as HTMLElement).style.borderColor = colors.containerBorder
          }}
          title="Remove skill"
        >
          {busy ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ display: 'flex' }}
            >
              <SpinnerGap size={10} />
            </motion.div>
          ) : (
            <Trash size={10} />
          )}
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>

      {/* Bottom: status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 10,
          paddingLeft: 24
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: enabled ? colors.accent : colors.textTertiary,
            letterSpacing: '-0.01em'
          }}
        >
          {enabled ? 'Active on next run' : 'Installed, disabled'}
        </span>
        <button
          onClick={onToggle}
          style={{
            borderRadius: 7,
            border: `1px solid ${enabled ? colors.accentBorder : colors.containerBorder}`,
            background: enabled ? colors.accentLight : 'transparent',
            color: enabled ? colors.accent : colors.textSecondary,
            cursor: 'pointer',
            fontSize: 10.5,
            fontWeight: 500,
            padding: '4px 9px',
            fontFamily: 'inherit',
            transition: 'all 0.12s'
          }}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  )
}
