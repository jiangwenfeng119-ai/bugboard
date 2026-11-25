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

## Overview

**Creative North Star: "The Intranet Ledger" / 内网账本**

Bugboard is a daytime desktop work ledger for Chinese intranet operators. The interface reads like a shared paper book of tickets: calm blues and cool paper fields, one sans family (IBM Plex Sans + Noto Sans SC), and status language that a person can scan in seconds. Density stays operational — tables, sheets, chips, and one clear next action — never marketing chrome.

Personality is restrained Operate craft: precise, scannable, and quiet when there is nothing to do. Color carries state machine meaning, not decoration. Surfaces sit on a soft paper wash with a faint grid; cards and sheets are white ledger pages with a light ambient shadow. Motion eases out without spring overshoot. Confirmed rejections: no purple SaaS gradients, no cyber/terminal skin, no second display face.

**Key Characteristics:**
- Single UI sans stack; Chinese-first labels and status names
- Semantic color reserved for status, priority, and charts — not brand fills
- One solid primary action per bug; destructive actions last
- Attention chips and summary tiles stay quiet at zero
- Card hover deepens shadow only (no lift translate)

## Colors

Cool paper daylight with a single intranet blue accent. Status hues are independent of the accent and never bleed into decorative gradients.

### Primary
- **Intranet Blue** (`#1f6feb`): Primary buttons, active tabs, focus ring, link hover, chart stroke. Deepened to **Ledger Navy** (`#0b3d91`) on hover / strong text links.
- **Accent Ink** (`#ffffff`): Text on solid primary and danger fills.

### Neutral
- **Cool Paper** (`#e9eef5`) / **Paper Deep** (`#d7e0ec`): Page wash (with soft radial accents and a 28px grid hatch).
- **Ledger White** (`#ffffff`) / **Surface Mist** (`#f2f5f9`): Cards, sheets, nested panels, muted chip fills.
- **Ink** (`#152033`) / **Ink Muted** (`#5a6678`): Body and secondary copy.
- **Hairline** (`#d3dce8`): Borders, table rules, dividers.

### Status & Priority (semantic only)
- Pending `#b45309` · Fixing `#1f6feb` · Needs info `#0f766e` · Needs product `#9a3412` · Ready `#0d9488` · Awaiting confirm `#0c4a6e` · Confirmed `#1b7f4a` · Acknowledged `#3d5c4e` · Invalid `#6b7280`
- Priority: P1 `#c62828` · P2 `#b45309` · P3 `#5c6570`
- Feedback: danger `#c62828` · warning `#b45309` · ok `#1b7f4a`
- Chart series 1–6: `#1f6feb`, `#0f766e`, `#9a3412`, `#0c4a6e`, `#334155`, `#be123c`

### Named Rules
**The Status-Only Color Rule.** Hue beyond neutrals and the single accent exists to name a state, priority, or series point — never to paint a marketing surface.

**The Quiet Zero Rule.** Project attention chips render only when `count > 0`; otherwise a quiet「暂无待办」chip. Summary tiles hide zero counts unless `showAll=1`.

## Typography

**Display Font:** none (Operate restraint — page titles use the body stack)
**Body Font:** IBM Plex Sans Variable + Noto Sans SC Variable (PingFang SC / Segoe UI fallbacks)
**Label/Mono Font:** same sans for UI labels; `ui-monospace` / SFMono / Menlo only for keys, SHAs, and code chips

**Character:** One calm industrial sans for Latin and Simplified Chinese. No italic drama, no all-caps labels, letter-spacing stays at 0. Tabular nums for IDs, counts, and times.

### Hierarchy
- **Headline** (600, 1.25rem, ~1.25–1.35): Page titles, sheet heads, project card names, bug titles.
- **Title** (600, ~1.05rem, 1.3): Inbox group heads, capture review heads, section emphasis.
- **Body** (400, 0.875rem, 1.7–1.85): Forms, prose, table title cells, muted leads. Measure ~40em for descriptive copy.
- **Label** (400–500, 0.75rem): Table headers, badges, chips, meta, crumbs. Status badges stay sentence case with text — color is never the only signal.

### Named Rules
**The One Face Rule.** Never introduce a second UI family or a display serif. Mono is reserved for tokens and technical strings.

## Layout

Desktop-first Chinese intranet shell: sticky frosted topbar (`4.5rem`), fluid gutters `clamp(1.15rem, 2vw, 2.25rem)`, main margin ~1.5rem / 3.5rem. Project grid: 5→4→3→2→1 columns by breakpoint. Bug detail at ≥1100px is content + sticky aside (~20–26rem). Right sheet width `clamp(28rem, 34vw, 46rem)`; below ~980px the sheet becomes a full-height overlay. Filters and toolbars wrap; tables scroll horizontally with denser mobile column sets. Prose measure stays near 40em so the ledger never sprawls into marketing-width copy.

## Elevation & Depth

Hybrid: soft tonal paper wash behind the app, then flat-to-lightly-lifted white surfaces. Resting cards use a short dual ambient shadow; interactive cards and stats deepen that shadow on hover and tint the border toward accent — **no translateY lift on cards**. Primary buttons may nudge up 2px; ghost buttons stay flat. Sheets and modals cast a stronger side/bottom shadow while open. Focus is a 2px accent outline with 2px offset, not a glow halo.

### Shadow Vocabulary
- **Rest** (`box-shadow: 0 1px 2px rgba(21, 32, 51, 0.06), 0 10px 24px rgba(21, 32, 51, 0.06)`): Cards, inbox groups, stats at rest.
- **Hover / pop** (`box-shadow: 0 12px 24px rgba(21, 32, 51, 0.08), 0 28px 52px rgba(21, 32, 51, 0.14)`): Interactive card hover, menus, capture stage.
- **Sheet** (`box-shadow: -28px 0 64px rgba(21, 32, 51, 0.2)`): Right detail/create sheet.
- **Modal** (`box-shadow: 0 28px 64px rgba(21, 32, 51, 0.22)`): Centered dialogs.

### Named Rules
**The Shadow-Not-Lift Rule.** Card hover changes shadow and border only. Do not add card `translateY` on hover.

**The No-Overshoot Rule.** `--ease-spring` equals `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`). Entrance animations ease out; they do not bounce past the end state. Honor `prefers-reduced-motion`.

## Shapes

Gently rounded ledger geometry: cards and panels at **14px** (`--radius`), controls and fields at **10px**, modals at **16px**, auth shell at **22px**, status badges and attention chips fully pill (`999px`). Borders are 1px hairlines (sometimes mixed toward white). Dropzones use a dashed accent-tinted stroke. Timeline dots and brand marks stay soft rounded squares/circles — never hard neo-brutal offsets.

## Components

Restrained and operational: solid when it is the next step, outlined or ghost when secondary, danger last and clearly red.

### Buttons
- **Shape:** Soft rectangle (10px)
- **Primary:** Accent fill, white ink, light rest shadow; hover → accent-strong + slight lift
- **Secondary:** White fill, ink text, hairline border
- **Ghost:** Transparent, muted ink; hover fills surface-2, no lift
- **Danger:** Danger fill; used for destructive bug transitions and placed last in the action row
- **Disabled:** 50% opacity, no transform/shadow — empty release queue disables「立即发布」and demotes it to secondary styling until there is something to ship

### Chips
- **Quiet:** Surface-2 + muted ink + hairline —「暂无待办」when no attention counts
- **Hot:** Status-tinted fill/border/text for pending / needs / awaiting / ready attention only when count > 0

### Cards / Containers
- **Corner Style:** 14px
- **Background:** Near-white mix of surface
- **Shadow Strategy:** Rest shadow; interactive hover → hover shadow + accent-tinted border (no lift)
- **Border:** Hairline mixed toward white
- **Internal Padding:** Section cards ~1.3–1.4rem

### Inputs / Fields
- **Style:** White surface, 10px radius, hairline border, 0.875rem type
- **Focus:** Accent border; no extra glow ring beyond global `:focus-visible`
- **Hover:** Border mixes toward accent
- **Error / Success:** Text uses danger / ok tokens; status stays verbal

### Navigation
- Sticky blurred topbar; brand at 1.25rem / 600; ghost nav links with `is-active` surface-2 fill
- Project tabs: muted by default; current page gets accent-strong text, accent underline, light accent wash

### Status badges
- Pill with 12% status tint fill and 25% tint border; always include the Chinese status label

### Signature: Bug next actions
- Ordered progress → secondary → destructive
- Exactly one solid primary (first non-destructive); danger variants last

### Signature: Capture tools
- New-bug sheet: one「材料」well directly under the title, before the description. Paste lands from the title, the description, or the well. 圈一张图 / 拍照 / 添加文件 / 共享画面 / 说一句 / 录一段走查 stay visible in that well; 走查 is the action that leaves the page. No second 取证 block and no 更多取证 disclosure.

### Signature: Status filter
- Select uses optgroups「进行中」and「终态」matching the state machine

### Record and edit dialogs
- Clicking a list row, or choosing 编辑, opens a centered dialog. The list stays on the page.
- This holds for admin and for user-facing pages. New pages use the same interaction.
- Creating a bug stays in the right sheet, because that form is the task and the list remains beside it.

**The Dialog Rule.** A clicked list row and an edit form open in a centered dialog. Do not append that record or editor on the same page. Admin and user-facing pages both follow this. New pages use it. Creating a bug stays in the right sheet.

## Do's and Don'ts

### Do:
- **Do** keep Chinese status names and one primary next action visible within ~10 seconds of opening a bug or project.
- **Do** use `--status-*` / `--priority-*` tokens for badges, chips, and chart series only.
- **Do** hide zero summary tiles unless the operator opts into `showAll=1`.
- **Do** disable「立即发布」when the release queue is empty; keep「标记已发布」available as the ledger note path.
- **Do** match motion to `--ease-out` / `--ease-spring` (identical curves) and respect reduced motion.
- **Do** open a clicked list row and an edit form in a centered dialog, on admin pages and on the user-facing pages. The list stays put.

### Don't:
- **Don't** introduce purple SaaS gradients, neon/cyber terminal skins, or a second display typeface.
- **Don't** invent decorative color blocks that do not map to a status, priority, or chart series.
- **Don't** lift cards on hover or add spring overshoot to entrances.
- **Don't** show a stack of equal-weight bug actions — one primary, danger last.
- **Don't** rely on color alone for status; badge and chip copy stays required.
- **Don't** append a clicked record or an edit form above or below the list on the same page.
