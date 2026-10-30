---
name: Open Logs
description: Self-hosted log management on your own Cloudflare account. Live tail, search, charts, dashboards.
colors:
  canvas: "#ffffff"
  canvas-dark: "#0b0b0c"
  rail: "#fafafa"
  rail-dark: "#111113"
  well: "#f4f4f5"
  well-dark: "#1c1c1f"
  hairline: "#e7e7e7"
  hairline-dark: "#26262a"
  hairline-strong: "#d4d4d8"
  hairline-strong-dark: "#3a3a40"
  ink: "#0a0a0a"
  ink-dark: "#ededed"
  ink-secondary: "#3f3f46"
  ink-secondary-dark: "#c4c4c8"
  ink-muted: "#646464"
  ink-muted-dark: "#9a9aa2"
  primary: "#0a0a0a"
  primary-dark: "#ededed"
  focus-blue: "#2563eb"
  focus-blue-dark: "#60a5fa"
  error: "#d92d20"
  error-text: "#b42318"
  error-wash: "#fef3f2"
  warn: "#c4640a"
  warn-text: "#b54708"
  warn-wash: "#fffaeb"
  ok: "#079455"
  ok-text: "#067647"
  ok-wash: "#ecfdf3"
  info-bar: "#8e8e96"
  debug-bar: "#c8c8ce"
  series-1: "#2563eb"
  series-2: "#0d9488"
  series-3: "#7c3aed"
  series-4: "#c4640a"
  series-5: "#8e8e96"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  control:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  data:
    fontFamily: "Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
rounded:
  tick: "2px"
  key: "4px"
  control: "6px"
  card: "10px"
  pill: "999px"
spacing:
  "2": "2px"
  "4": "4px"
  "6": "6px"
  "8": "8px"
  "12": "12px"
  "16": "16px"
  "24": "24px"
  "32": "32px"
  "40": "40px"
  "48": "48px"
  "64": "64px"
  control-height: "32px"
  topbar-height: "56px"
components:
  button:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.canvas}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  chip-filter:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    padding: "2px 4px 2px 8px"
  pill-status:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  nav-item:
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
---

# Design System: Open Logs

## Overview

**Creative North Star: "The Control Room"**

Open Logs is the screen an on-call engineer keeps open through an incident. It should feel like a well-run
control room: calm, dense and precise, readable for hours, with nothing on it that isn't information. Data leads
and the chrome recedes. Colour is reserved for state, so when something turns red, it matters.

The incumbent system is a monochrome, Vercel-adjacent product UI: white canvas (light default) or near-black
(dark), a grey rail for navigation, hairline borders, black primary actions, Geist for interface text and Geist
Mono for anything that is data. Depth comes from tonal layers and 1px borders, not shadows. The type scale is
small and tight (11 to 24px, body 13px), which suits density.

The direction for refinement passes is to keep this world and raise its finish to the level of the best tools in
the category: one spacing scale instead of ad hoc values, a clearer type hierarchy, every state designed, and
status colour used with discipline. This is a refinement, not a redesign.

**Key Characteristics:**
- Monochrome shell; colour only for log levels, status, focus and chart series.
- Flat surfaces with hairline borders; shadows only on floating layers.
- Geist for UI, Geist Mono for timestamps, fields, values, tokens and code.
- Dense by default: 13px body, compact rows, small controls.
- Light and dark themes are equals.

## Colors

A neutral grey ladder with black (or near-white in dark) as the only "brand" colour, plus a semantic set for
levels and status.

### Primary
- **Ink Primary** (#0a0a0a light / #ededed dark): primary buttons and the active, high-emphasis action on a
  screen. Never decorative.

### Neutral
- **Canvas** (#ffffff / #0b0b0c): the work surface: tables, tiles, panels.
- **Rail** (#fafafa / #111113): sidebar, table headers, opened rows, secondary panels.
- **Well** (#f4f4f5 / #1c1c1f): pressed and hovered states, filter chips, code wells.
- **Hairline** (#e7e7e7 / #26262a) and **Hairline Strong** (#d4d4d8 / #3a3a40): borders and dividers; the strong
  variant for hover and focus on controls.
- **Ink, Ink Secondary, Ink Muted** (#0a0a0a, #3f3f46, #646464 / #ededed, #c4c4c8, #9a9aa2): primary text,
  control text, meta and labels.

### Semantic
- **Error** (#d92d20, text #b42318, wash #fef3f2): error level, failed states, destructive actions.
- **Warn** (#c4640a, text #b54708, wash #fffaeb): warn level, degraded states.
- **OK** (#079455, text #067647, wash #ecfdf3): healthy, receiving, success.
- **Info bar / Debug bar** (#8e8e96 / #c8c8ce): info and debug levels stay grey so errors stand out.
- **Focus Blue** (#2563eb / #60a5fa): focus rings and links to act; not a decorative accent.
- **Series 1 to 5** (blue, teal, violet, amber, grey): chart series in order.

### Fixed surfaces
- **Code block** (`--code-bg` #0a0a0a, `--code-raised` #1a1a1a, `--code-line` #222222, `--code-line2` #333333,
  `--code-tx` #e5e5e5, `--code-tx2` #a3a3a3): the install snippet is a dark terminal in both themes.
- **Scrim** (`--scrim`, black at 35% light / 60% dark): behind dialogs and the chart drawer.

### Named Rules
**The Colour Means State Rule.** Every coloured pixel answers "what state is this in?" Level, status, focus or a
chart series. Decoration stays grey.

**The Quiet Info Rule.** Info and debug render grey; only warn and error get colour, so the eye goes to trouble.

## Typography

**Interface Font:** Geist (with ui-sans-serif, system-ui)
**Data Font:** Geist Mono (with ui-monospace, SFMono-Regular, Menlo)

**Character:** One neutral sans for everything a person reads as interface, one mono for everything a machine
wrote. The split is semantic, not decorative.

### Hierarchy
- **Headline** (600, 24px): headline numbers on stat tiles; sign-in heading.
- **Title** (600, 15px): page titles in the top bar, brand name, dialog titles.
- **Body** (400, 13px): default text, inputs, nav items, tile titles (600).
- **Control** (400 or 500, 12px): buttons, secondary text, table cells.
- **Label** (500, 11px): table headers, pills, meta, keyboard hints; uppercase with 0.06em tracking only for nav
  section labels.
- **Data** (Geist Mono 400, 11 to 12px): timestamps, field names and values, tokens, counts, code.

### Named Rules
**The One Primary Rule.** A screen has at most one primary (filled) button: its main action. Settings forms,
toolbars and secondary actions use the default or ghost button.

**The Machine Wrote It Rule.** If a machine produced the text (a timestamp, a field, a value, a token), it is set in
Geist Mono. Human-written copy never is, including names people choose for projects and the team.

## Layout

App shell: a fixed-width sidebar (232px, sticky, full height) beside a scrolling main area. Each screen starts with
a top bar (title left, actions right, 12px 24px padding, hairline bottom border), then content inset 24px from the
sides. Live tail is a vertical stack: search and filters, histogram, then the event table with an optional side
panel. Dashboards use a tile grid that collapses to one column below 900px. Below about 1000px the tail side panel
stacks under the table.

All padding, margin and gap values come from the spacing tokens `--s-2` to `--s-64` (2, 4, 6, 8, 12, 16, 24, 32,
40, 48, 64) in `app/src/styles/app.css`. Small steps (2 to 12) space items inside a group, 16 and 24 separate groups
and inset content from the page edge, 32 and up are for empty states and page-level breathing room. Buttons,
inputs, selects and the segmented range control share one height (`--control-h`, 32px), and every screen's top
bar is the same height (`--topbar-h`, 56px), so nothing shifts when moving between screens.

### Named Rules
**The One Scale Rule.** Spacing comes from the `--s-*` tokens. Only 1px hairline offsets stay literal; any other
value off the scale needs a written reason.

**The Fixed Frame Rule.** The sidebar width, top bar height and content inset are the same on every screen.

## Elevation & Depth

Flat by default. Depth comes from tonal layering (Canvas, Rail, Well) and 1px hairlines. Shadows exist only on
layers that float above the page: menus, dialogs, toasts, the chart drawer.

### Shadow Vocabulary
- **Float** (`0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)` light; `0 8px 24px rgba(0,0,0,0.5)` dark):
  menus, dialogs, toasts, drawers.

### Named Rules
**The Flat Floor Rule.** Anything attached to the page (cards, tiles, tables, panels) has a border and no shadow.
Only things that float get the Float shadow.

## Shapes

Gently rounded and consistent: 6px for controls (buttons, inputs, chips, nav items), 10px for containers (cards,
tiles, the event table, dialogs), full pills (999px) only for small status badges, 4px for keyboard key caps, 2px
for tiny marks such as legend swatches. Borders are always 1px.

## Components

### Buttons
- **Shape:** gently rounded (6px).
- **Default:** Canvas background, 1px Hairline border, Ink Secondary text, 12px, 6px 12px padding; hover
  strengthens the border and darkens the text.
- **Primary:** Ink Primary fill with Canvas text, weight 500; hover lowers opacity to 0.9.
- **Pressed toggle:** `aria-pressed="true"` gets Well background and an Ink Secondary border.
- **Ghost:** no border or fill until hover (Well). For low-emphasis toolbar actions such as Refresh and Export
  CSV, always with an icon.
- **Danger:** default button with Error text. **Link:** borderless, underlined with a 2px offset; only inside
  sentences, never as a toolbar action.
- **Disabled:** 50% opacity.

### Chips
- **Filter chip:** Geist Mono 12px on Well, field name in Ink weight 500, a small remove button.

### Status pills
- **Style:** 11px weight 500, pill shape, Rail background and Hairline border; OK, Warn and Error variants use
  their wash, line and text colours.

### Cards / Tiles
- **Corner Style:** 10px. **Background:** Canvas. **Border:** 1px Hairline. **Shadow:** none.
- **Internal Padding:** 14px 16px; tile header holds a 13px weight-600 title and a hover-revealed menu.

### Inputs / Fields
- **Style:** Canvas background, 1px Hairline, 6px radius, 13px text, 7px 10px padding; Geist Mono for tokens,
  names and queries.
- **Focus:** border strengthens to Hairline Strong plus the global 2px Focus Blue outline on `:focus-visible`.

### Navigation
- **Sidebar:** Rail background, hairline right border, 14px 12px padding. Brand at 15px weight 600, a project
  switcher under it, then items.
- **Items:** 13px Ink Secondary, 7px 10px, 6px radius; hover uses Well; current page is Canvas with a 1px Hairline
  ring and weight 500. Counts sit right-aligned in mono 11px.

### Event table (signature)
- A bordered 10px container with a Rail header row (11px, Ink Muted, weight 500) and rows on a fixed grid (time,
  level, source, message, chevron), divided by hairlines. An opened row turns Rail. Level is shown with the
  level colour, never by row background.

### Loader
- A small pulsing green dot, shown once at start-up and when switching project. No other spinners between screens.

## Do's and Don'ts

### Do:
- **Do** set every timestamp, field, value, token and count in Geist Mono.
- **Do** keep info and debug grey; reserve red and amber for error and warn.
- **Do** use the 6px radius for controls and 10px for containers.
- **Do** give every interactive element hover, focus-visible, disabled and, where relevant, loading and empty states.
- **Do** check every change in both light and dark themes.

### Don't:
- **Don't** add shadows to cards, tiles or tables; borders carry depth.
- **Don't** introduce a decorative accent colour or gradients.
- **Don't** use spinners between screens; data is loaded once.
- **Don't** use monospace for headings, labels or human-written copy.
- **Don't** use pills for anything except small status badges.
