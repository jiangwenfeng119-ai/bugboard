---
name: Bugboard
description: Intranet work ledger for multi-project bug triage — calm daytime Operate craft.
colors:
  accent: "#1f6feb"
  accent-strong: "#0b3d91"
  accent-ink: "#ffffff"
  paper: "#e9eef5"
  paper-deep: "#d7e0ec"
  surface: "#ffffff"
  surface-2: "#f2f5f9"
  ink: "#152033"
  ink-muted: "#5a6678"
  line: "#d3dce8"
  danger: "#c62828"
  warning: "#b45309"
  ok: "#1b7f4a"
  focus: "#1f6feb"
  status-pending: "#b45309"
  status-fixing: "#1f6feb"
  status-needs: "#0f766e"
  status-product: "#9a3412"
  status-ready: "#0d9488"
  status-awaiting: "#0c4a6e"
  status-confirmed: "#1b7f4a"
  status-acknowledged: "#3d5c4e"
  status-invalid: "#6b7280"
  priority-p1: "#c62828"
  priority-p2: "#b45309"
  priority-p3: "#5c6570"
  series-1: "#1f6feb"
  series-2: "#0f766e"
  series-3: "#9a3412"
  series-4: "#0c4a6e"
  series-5: "#334155"
  series-6: "#be123c"
typography:
  headline:
    fontFamily: "IBM Plex Sans Variable, Noto Sans SC Variable, PingFang SC, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0em"
  title:
    fontFamily: "IBM Plex Sans Variable, Noto Sans SC Variable, PingFang SC, Segoe UI, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0em"
  body:
    fontFamily: "IBM Plex Sans Variable, Noto Sans SC Variable, PingFang SC, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0em"
  label:
    fontFamily: "IBM Plex Sans Variable, Noto Sans SC Variable, PingFang SC, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "0em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "16px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.55rem"
  md: "0.95rem"
  lg: "1.35rem"
  gutter: "clamp(1.15rem, 2vw, 2.25rem)"
  measure: "40em"
  sheet: "clamp(28rem, 34vw, 46rem)"
  topbar: "4.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.95rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.75rem"
    typography: "{typography.body}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "1.3rem 1.4rem 1.35rem"
  chip-status:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0.18rem 0.65rem"
    typography: "{typography.label}"
  badge-status:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0.18rem 0.65rem"
    typography: "{typography.label}"
---

# Design System: Bugboard

<!-- impeccable:design-map -->
Name: Bugboard
Colors: primary: accent #1f6feb; secondary: warning #b45309; tertiary: series-1 #1f6feb; neutral: accent-ink #ffffff; primary: accent-strong #0b3d91; primary: danger #c62828; primary: focus #1f6feb (+25 more in the sidecar)
Fonts: IBM Plex Sans Variable (headline, title, body, label)
Spacing: xs 0.35rem, sm 0.55rem, md 0.95rem, lg 1.35rem, gutter clamp(1.15rem, 2vw, 2.25rem), measure 40em, sheet clamp(28rem, 34vw, 46rem), topbar 4.5rem
Radius: sm 6px, md 10px, lg 14px, xl 16px, pill 999px
North Star: "The Intranet Ledger" / 内网账本
Rules:
- The Status-Only Color Rule. Hue beyond neutrals and the single accent exists to name a state, priority, or series point — never to paint a marketing surface.
- The Quiet Zero Rule. Project attention chips render only when `count > 0`; otherwise a quiet「暂无待办」chip.
- The One Face Rule. Never introduce a second UI family or a display serif.
- The Shadow-Not-Lift Rule. Card hover changes shadow and border only.
- The No-Overshoot Rule. `--ease-spring` equals `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`).
- The Dialog Rule. A clicked list row and an edit form open in a centered dialog. The list stays put. Admin and user-facing pages both follow this. New pages use it. Creating a bug stays in the right sheet.
Elevation:
- Rest: 0 1px 2px rgba(21, 32, 51, 0.06), 0 10px 24px rgba(21, 32, 51, 0.06)
- Hover / pop: 0 12px 24px rgba(21, 32, 51, 0.08), 0 28px 52px rgba(21, 32, 51, 0.14)
- Sheet: -28px 0 64px rgba(21, 32, 51, 0.2)
- Modal: 0 28px 64px rgba(21, 32, 51, 0.22)
Don't:
- Don't introduce purple SaaS gradients, neon/cyber terminal skins, or a second display typeface.
- Don't invent decorative color blocks that do not map to a status, priority, or chart series.
- Don't lift cards on hover or add spring overshoot to entrances.
- Don't show a stack of equal-weight bug actions — one primary, danger last.
- Don't rely on color alone for status; badge and chip copy stays required.
- Don't append a clicked record or an edit form above or below the list on the same page.
Do:
- Do keep Chinese status names and one primary next action visible within ~10 seconds of opening a bug or project.
- Do use `--status-*` / `--priority-*` tokens for badges, chips, and chart series only.
- Do hide zero summary tiles unless the operator opts into `showAll=1`.
- Do disable「立即发布」when the release queue is empty; keep「标记已发布」available as the ledger note path.
- Do match motion to `--ease-out` / `--ease-spring` (identical curves) and respect reduced motion.
- Do open a clicked list row and an edit form in a centered dialog, on admin pages and on the user-facing pages. The list stays put.
Full: .impeccable/design-full.md (read a section when you need its detail)
