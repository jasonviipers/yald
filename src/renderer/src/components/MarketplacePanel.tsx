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
      if (!message.toLowerCase().includes('cancelled')) {
        setError(message || 'Skill installation failed')
      }
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
      const message = err instanceof Error ? err.message : String(err)
      setError(message || 'Skill removal failed')
    } finally {
      setBusySkillId(null)
    }
  }

  const handleRefresh = async () => {
    setError(null)
    try {
      await refreshInstalledSkills()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || 'Refresh failed')
    }
  }

  return (
    <div data-yald-ui style={{ display: 'flex', flexDirection: 'column', maxHeight: 360 }}>
      {/* ── Header ── */}
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
              background: colors.accentLight,
              color: colors.accent
            }}
          >
            <Sparkle size={16} />
          </span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary }}>
              Prompt Skills
            </div>
            <div style={{ fontSize: 11, color: colors.textTertiary, marginTop: 2 }}>
              {enabledCount} enabled of {installedSkills.length} installed
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleInstall}
            disabled={pendingInstall}
            style={{
              height: 34,
              padding: '0 12px',
              borderRadius: 9999,
              border: `1px solid ${colors.accentBorder}`,
              background: colors.accentLight,
              color: colors.accent,
              cursor: pendingInstall ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'inherit'
            }}
          >
            <Plus size={12} />
            {pendingInstall ? 'Installing...' : 'Install skill'}
          </button>
          <button
            onClick={handleRefresh}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.textTertiary,
              padding: 4,
              display: 'flex'
            }}
            title="Refresh skills"
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.textPrimary)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.textTertiary)}
          >
            <ArrowClockwise size={14} />
          </button>
          <button
            onClick={closeSkillsPanel}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.textTertiary,
              padding: 4,
              display: 'flex'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = colors.textPrimary)}
            onMouseLeave={(e) => (e.currentTarget.style.color = colors.textTertiary)}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          style={{
            margin: '12px 16px 0',
            borderRadius: 12,
            padding: '10px 12px',
            background: colors.statusErrorBg,
            color: colors.statusError,
            fontSize: 11,
            lineHeight: 1.5
          }}
        >
          {error}
        </div>
      )}

      {/* ── Body ── */}
      <div
        style={{
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        {installedSkills.length === 0 ? (
          <div
            style={{
              borderRadius: 16,
              border: `1px dashed ${colors.containerBorder}`,
              padding: '20px 18px',
              background: colors.surfacePrimary
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
              No prompt skills installed
            </div>
            <div
              style={{ fontSize: 11, color: colors.textTertiary, marginTop: 6, lineHeight: 1.55 }}
            >
              Install a local{' '}
              <code
                style={{
                  fontFamily: 'monospace',
                  background: colors.codeBg,
                  padding: '1px 4px',
                  borderRadius: 3
                }}
              >
                SKILL.md
              </code>{' '}
              file and yald will append it as guidance to future Ollama runs.
            </div>
          </div>
        ) : (
          installedSkills.map((skill) => {
            const enabled = selectedSkillIds.includes(skill.id)
            const busy = busySkillId === skill.id
            return (
              <SkillCard
                key={skill.id}
                skill={skill}
                enabled={enabled}
                busy={busy}
                colors={colors}
                onToggle={() => toggleSkillSelection(skill.id)}
                onUninstall={() => void handleUninstall(skill.id)}
              />
            )
          })
        )}
      </div>
    </div>
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
        borderRadius: 16,
        border: `1px solid ${enabled ? colors.accentBorderMedium : colors.containerBorder}`,
        background: enabled ? colors.surfaceActive : colors.surfacePrimary,
        padding: '14px 14px 12px'
      }}
    >
      {/* ── Top row: toggle + content + remove ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12
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
            gap: 10,
            textAlign: 'left',
            flex: 1
          }}
        >
          <span style={{ color: enabled ? colors.accent : colors.textTertiary, marginTop: 1 }}>
            {enabled ? <CheckCircle size={16} weight="fill" /> : <Circle size={16} />}
          </span>
          <span style={{ minWidth: 0 }}>
            <span
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: colors.textPrimary,
                letterSpacing: '-0.01em'
              }}
            >
              {skill.name}
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 11,
                color: colors.textTertiary,
                marginTop: 5,
                lineHeight: 1.55
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
            borderRadius: 9999,
            border: `1px solid ${colors.containerBorder}`,
            background: 'transparent',
            color: colors.textTertiary,
            cursor: busy ? 'wait' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            fontWeight: 600,
            padding: '6px 10px',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s'
          }}
          onMouseEnter={(e) => {
            if (!busy) {
              e.currentTarget.style.color = colors.statusError
              e.currentTarget.style.borderColor = colors.statusError
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = colors.textTertiary
            e.currentTarget.style.borderColor = colors.containerBorder
          }}
          title="Remove skill"
        >
          {busy ? (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              style={{ display: 'flex' }}
            >
              <SpinnerGap size={11} />
            </motion.div>
          ) : (
            <Trash size={11} />
          )}
          {busy ? 'Removing...' : 'Remove'}
        </button>
      </div>

      {/* ── Bottom row: status label + enable/disable pill ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          marginTop: 12,
          paddingLeft: 26
        }}
      >
        <span style={{ fontSize: 10, color: enabled ? colors.accent : colors.textTertiary }}>
          {enabled ? 'Enabled for the next Ollama run' : 'Installed but disabled'}
        </span>
        <button
          onClick={onToggle}
          style={{
            borderRadius: 9999,
            border: `1px solid ${enabled ? colors.accentBorder : colors.containerBorder}`,
            background: enabled ? colors.accentLight : 'transparent',
            color: enabled ? colors.accent : colors.textSecondary,
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 600,
            padding: '5px 10px',
            fontFamily: 'inherit'
          }}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  )
}
