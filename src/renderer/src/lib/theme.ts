/**
 * yald Design Tokens — Dual theme (dark + light)
 * Liquid glass aesthetic — iridescent, shifting hues, translucent surfaces.
 * Orange accent (#d97757) preserved throughout.
 */
import { create } from 'zustand'

// ─── Color palettes ───────────────────────────────────────────────────────────

export const darkColors = {
  // Container (liquid glass surfaces — deep iridescent base)
  containerBg: 'rgba(18, 16, 28, 0.86)',
  containerBgCollapsed: 'rgba(14, 12, 22, 0.82)',
  containerBorder: 'rgba(160, 120, 255, 0.18)',
  containerShadow:
    '0 8px 32px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(180, 140, 255, 0.12) inset, 0 -1px 0 rgba(80, 200, 255, 0.08) inset',
  cardShadow: '0 2px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(140, 100, 255, 0.08) inset',
  cardShadowCollapsed: '0 2px 8px rgba(0,0,0,0.45)',

  // Surface layers (glass panes with iridescent tints)
  surfacePrimary: 'rgba(255, 255, 255, 0.055)',
  surfaceSecondary: 'rgba(255, 255, 255, 0.08)',
  surfaceHover: 'rgba(180, 140, 255, 0.07)',
  surfaceActive: 'rgba(180, 140, 255, 0.12)',

  // Input
  inputBg: 'transparent',
  inputBorder: 'rgba(160, 120, 255, 0.2)',
  inputFocusBorder: 'rgba(217, 119, 87, 0.5)',
  inputPillBg: 'rgba(255, 255, 255, 0.06)',

  // Text
  textPrimary: 'rgba(235, 228, 255, 0.92)',
  textSecondary: 'rgba(200, 190, 235, 0.75)',
  textTertiary: 'rgba(160, 150, 200, 0.5)',
  textMuted: 'rgba(255, 255, 255, 0.06)',

  // Accent — orange (preserved)
  accent: '#d97757',
  accentLight: 'rgba(217, 119, 87, 0.12)',
  accentSoft: 'rgba(217, 119, 87, 0.18)',

  // Status dots
  statusIdle: 'rgba(160, 150, 200, 0.6)',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#5ec4a0',
  statusCompleteBg: 'rgba(94, 196, 160, 0.1)',
  statusError: '#e07070',
  statusErrorBg: 'rgba(224, 112, 112, 0.08)',
  statusDead: '#e07070',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.45)',

  // Tab
  tabActive: 'rgba(255, 255, 255, 0.07)',
  tabActiveBorder: 'rgba(180, 140, 255, 0.2)',
  tabInactive: 'transparent',
  tabHover: 'rgba(180, 140, 255, 0.06)',

  // User message bubble
  userBubble: 'rgba(217, 119, 87, 0.1)',
  userBubbleBorder: 'rgba(217, 119, 87, 0.22)',
  userBubbleText: 'rgba(235, 228, 255, 0.92)',

  // Tool card
  toolBg: 'rgba(255, 255, 255, 0.045)',
  toolBorder: 'rgba(160, 120, 255, 0.15)',
  toolRunningBorder: 'rgba(217, 119, 87, 0.35)',
  toolRunningBg: 'rgba(217, 119, 87, 0.06)',

  // Timeline
  timelineLine: 'rgba(160, 120, 255, 0.2)',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(180, 140, 255, 0.18)',
  scrollThumbHover: 'rgba(180, 140, 255, 0.32)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.28)',

  // Popover
  popoverBg: 'rgba(20, 16, 32, 0.92)',
  popoverBorder: 'rgba(160, 120, 255, 0.2)',
  popoverShadow: '0 4px 24px rgba(0,0,0,0.4), 0 1px 0 rgba(180, 140, 255, 0.1) inset',

  // Code block
  codeBg: 'rgba(10, 8, 20, 0.6)',

  // Mic button
  micBg: 'rgba(255, 255, 255, 0.055)',
  micColor: 'rgba(200, 190, 235, 0.75)',
  micDisabled: 'rgba(255, 255, 255, 0.04)',

  // Placeholder
  placeholder: 'rgba(160, 150, 200, 0.4)',

  // Disabled button
  btnDisabled: 'rgba(255, 255, 255, 0.08)',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover
  btnHoverColor: 'rgba(235, 228, 255, 0.92)',
  btnHoverBg: 'rgba(180, 140, 255, 0.08)',

  // Accent border variants
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.28)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(224, 112, 112, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(224, 112, 112, 0.12)'
} as const

export const lightColors = {
  // Container (liquid glass surfaces — luminous iridescent base)
  containerBg: 'rgba(255, 252, 255, 0.82)',
  containerBgCollapsed: 'rgba(248, 244, 255, 0.76)',
  containerBorder: 'rgba(160, 100, 255, 0.16)',
  containerShadow:
    '0 8px 32px rgba(80, 40, 160, 0.1), 0 1px 0 rgba(220, 190, 255, 0.6) inset, 0 -1px 0 rgba(100, 200, 255, 0.15) inset',
  cardShadow: '0 2px 12px rgba(80, 40, 160, 0.08), 0 0 0 1px rgba(180, 140, 255, 0.1) inset',
  cardShadowCollapsed: '0 2px 8px rgba(80, 40, 160, 0.1)',

  // Surface layers
  surfacePrimary: 'rgba(200, 170, 255, 0.12)',
  surfaceSecondary: 'rgba(180, 140, 255, 0.18)',
  surfaceHover: 'rgba(160, 100, 255, 0.07)',
  surfaceActive: 'rgba(160, 100, 255, 0.12)',

  // Input
  inputBg: 'transparent',
  inputBorder: 'rgba(160, 100, 255, 0.2)',
  inputFocusBorder: 'rgba(217, 119, 87, 0.5)',
  inputPillBg: 'rgba(255, 255, 255, 0.7)',

  // Text
  textPrimary: '#2a1f3d',
  textSecondary: '#4a3b6a',
  textTertiary: '#8a7aaa',
  textMuted: 'rgba(160, 100, 255, 0.12)',

  // Accent — orange (preserved)
  accent: '#d97757',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentSoft: 'rgba(217, 119, 87, 0.14)',

  // Status dots
  statusIdle: '#8a7aaa',
  statusRunning: '#d97757',
  statusRunningBg: 'rgba(217, 119, 87, 0.1)',
  statusComplete: '#3aaa7a',
  statusCompleteBg: 'rgba(58, 170, 122, 0.1)',
  statusError: '#c04040',
  statusErrorBg: 'rgba(192, 64, 64, 0.06)',
  statusDead: '#c04040',
  statusPermission: '#d97757',
  statusPermissionGlow: 'rgba(217, 119, 87, 0.35)',

  // Tab
  tabActive: 'rgba(200, 170, 255, 0.18)',
  tabActiveBorder: 'rgba(160, 100, 255, 0.2)',
  tabInactive: 'transparent',
  tabHover: 'rgba(160, 100, 255, 0.07)',

  // User message bubble
  userBubble: 'rgba(217, 119, 87, 0.08)',
  userBubbleBorder: 'rgba(217, 119, 87, 0.2)',
  userBubbleText: '#2a1f3d',

  // Tool card
  toolBg: 'rgba(200, 170, 255, 0.1)',
  toolBorder: 'rgba(160, 100, 255, 0.16)',
  toolRunningBorder: 'rgba(217, 119, 87, 0.3)',
  toolRunningBg: 'rgba(217, 119, 87, 0.05)',

  // Timeline
  timelineLine: 'rgba(160, 100, 255, 0.18)',
  timelineNode: 'rgba(217, 119, 87, 0.2)',
  timelineNodeActive: '#d97757',

  // Scrollbar
  scrollThumb: 'rgba(160, 100, 255, 0.15)',
  scrollThumbHover: 'rgba(160, 100, 255, 0.28)',

  // Stop button
  stopBg: '#ef4444',
  stopHover: '#dc2626',

  // Send button
  sendBg: '#d97757',
  sendHover: '#c96442',
  sendDisabled: 'rgba(217, 119, 87, 0.3)',

  // Popover
  popoverBg: 'rgba(248, 244, 255, 0.96)',
  popoverBorder: 'rgba(160, 100, 255, 0.18)',
  popoverShadow: '0 4px 24px rgba(80, 40, 160, 0.12), 0 1px 0 rgba(220, 190, 255, 0.5) inset',

  // Code block
  codeBg: 'rgba(230, 220, 255, 0.4)',

  // Mic button
  micBg: 'rgba(200, 170, 255, 0.14)',
  micColor: '#4a3b6a',
  micDisabled: 'rgba(160, 100, 255, 0.08)',

  // Placeholder
  placeholder: 'rgba(140, 120, 180, 0.5)',

  // Disabled button
  btnDisabled: 'rgba(160, 100, 255, 0.1)',

  // Text on accent backgrounds
  textOnAccent: '#ffffff',

  // Button hover
  btnHoverColor: '#2a1f3d',
  btnHoverBg: 'rgba(200, 170, 255, 0.16)',

  // Accent border variants
  accentBorder: 'rgba(217, 119, 87, 0.19)',
  accentBorderMedium: 'rgba(217, 119, 87, 0.28)',

  // Permission card (amber)
  permissionBorder: 'rgba(245, 158, 11, 0.3)',
  permissionShadow: '0 2px 12px rgba(245, 158, 11, 0.08)',
  permissionHeaderBg: 'rgba(245, 158, 11, 0.06)',
  permissionHeaderBorder: 'rgba(245, 158, 11, 0.12)',

  // Permission allow (green)
  permissionAllowBg: 'rgba(34, 197, 94, 0.1)',
  permissionAllowHoverBg: 'rgba(34, 197, 94, 0.22)',
  permissionAllowBorder: 'rgba(34, 197, 94, 0.25)',

  // Permission deny (red)
  permissionDenyBg: 'rgba(239, 68, 68, 0.08)',
  permissionDenyHoverBg: 'rgba(239, 68, 68, 0.18)',
  permissionDenyBorder: 'rgba(239, 68, 68, 0.22)',

  // Permission denied card
  permissionDeniedBorder: 'rgba(192, 64, 64, 0.3)',
  permissionDeniedHeaderBorder: 'rgba(192, 64, 64, 0.12)'
} as const

export type ColorPalette = { [K in keyof typeof darkColors]: string }

// ─── CSS variable sync ────────────────────────────────────────────────────────

/** Convert camelCase token name to --yald-kebab-case CSS custom property */
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/** Sync all JS design tokens to CSS custom properties on :root */
function syncTokensToCss(tokens: ColorPalette): void {
  const style = document.documentElement.style
  for (const [key, value] of Object.entries(tokens)) {
    style.setProperty(`--yald-${camelToKebab(key)}`, value)
  }
}

function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  syncTokensToCss(isDark ? darkColors : lightColors)
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export type ThemeMode = 'system' | 'light' | 'dark'

const SETTINGS_KEY = 'yald-settings'

interface PersistedSettings {
  themeMode: ThemeMode
  soundEnabled: boolean
  expandedUI: boolean
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      return {
        themeMode:
          parsed.themeMode === 'light' ||
          parsed.themeMode === 'dark' ||
          parsed.themeMode === 'system'
            ? parsed.themeMode
            : 'dark',
        soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
        expandedUI: typeof parsed.expandedUI === 'boolean' ? parsed.expandedUI : false
      }
    }
  } catch {}
  return { themeMode: 'dark', soundEnabled: true, expandedUI: false }
}

function saveSettings(s: PersistedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {}
}

// ─── Theme store ──────────────────────────────────────────────────────────────

interface ThemeState {
  isDark: boolean
  themeMode: ThemeMode
  soundEnabled: boolean
  expandedUI: boolean
  /** OS-reported dark mode — used when themeMode is 'system' */
  _systemIsDark: boolean
  setThemeMode: (mode: ThemeMode) => void
  setSoundEnabled: (enabled: boolean) => void
  setExpandedUI: (expanded: boolean) => void
  /** Called by the OS theme change listener */
  setSystemTheme: (isDark: boolean) => void
}

function resolveIsDark(mode: ThemeMode, systemIsDark: boolean): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemIsDark
}

/** Read OS preference at startup — safe to call before the store is created */
const systemIsDarkAtBoot =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true

// Always start in compact UI mode on launch
const saved = { ...loadSettings(), expandedUI: false }
const initialIsDark = resolveIsDark(saved.themeMode, systemIsDarkAtBoot)

// Eagerly sync CSS vars before first React render to avoid a flash
syncTokensToCss(initialIsDark ? darkColors : lightColors)

export const useThemeStore = create<ThemeState>((set, get) => ({
  isDark: initialIsDark,
  themeMode: saved.themeMode,
  soundEnabled: saved.soundEnabled,
  expandedUI: saved.expandedUI,
  _systemIsDark: systemIsDarkAtBoot,

  setThemeMode: (mode) => {
    const isDark = resolveIsDark(mode, get()._systemIsDark)
    set({ themeMode: mode, isDark })
    applyTheme(isDark)
    saveSettings({
      themeMode: mode,
      soundEnabled: get().soundEnabled,
      expandedUI: get().expandedUI
    })
  },

  setSoundEnabled: (soundEnabled) => {
    set({ soundEnabled })
    saveSettings({ themeMode: get().themeMode, soundEnabled, expandedUI: get().expandedUI })
  },

  setExpandedUI: (expandedUI) => {
    set({ expandedUI })
    saveSettings({ themeMode: get().themeMode, soundEnabled: get().soundEnabled, expandedUI })
  },

  setSystemTheme: (isDark) => {
    set({ _systemIsDark: isDark })
    if (get().themeMode === 'system') {
      set({ isDark })
      applyTheme(isDark)
    }
  }
}))

// ─── Hooks & helpers ──────────────────────────────────────────────────────────

/** Reactive hook — returns the active color palette */
export function useColors(): ColorPalette {
  const isDark = useThemeStore((s) => s.isDark)
  return isDark ? darkColors : lightColors
}

/** Non-reactive getter — use outside React components */
export function getColors(isDark: boolean): ColorPalette {
  return isDark ? darkColors : lightColors
}

/**
 * @deprecated Use useColors() in components or getColors() outside React.
 * This static export always reflects the dark palette and will not respond
 * to theme changes — it exists only for components not yet migrated.
 */
export const colors = darkColors

// ─── Spacing ──────────────────────────────────────────────────────────────────

export const spacing = {
  contentWidth: 460,
  containerRadius: 20,
  containerPadding: 12,
  tabHeight: 32,
  inputMinHeight: 44,
  inputMaxHeight: 160,
  conversationMaxHeight: 380,
  pillRadius: 9999,
  circleSize: 36,
  circleGap: 8
} as const

// ─── Animation ────────────────────────────────────────────────────────────────

export const motion = {
  spring: { type: 'spring' as const, stiffness: 500, damping: 30 },
  easeOut: { duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] as const },
  fadeIn: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.15 }
  }
} as const
