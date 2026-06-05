---
name: NexoFitness
description: Multitenant gym-management SaaS — an operator command surface with per-tenant branding.
colors:
  brand-500: "#06b6d4"
  brand-600: "#0891b2"
  brand-700: "#0e7490"
  brand-400: "#22d3ee"
  brand-50: "#ecfeff"
  brand-950: "#083344"
  surface-50: "#f8fafc"
  surface-100: "#f1f5f9"
  surface-200: "#e2e8f0"
  surface-400: "#94a3b8"
  surface-500: "#64748b"
  surface-700: "#334155"
  surface-900: "#0f172a"
  surface-950: "#020617"
  success: "#10b981"
  warning: "#f59e0b"
  danger: "#ef4444"
typography:
  display:
    fontFamily: "Outfit, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.01em"
  mono:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  md: "0.75rem"
  lg: "0.75rem"
  xl: "0.75rem"
  full: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.625rem"
  md: "1rem"
  lg: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.brand-500}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "0.625rem 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.brand-600}"
  button-secondary:
    backgroundColor: "{colors.surface-100}"
    textColor: "{colors.surface-700}"
    rounded: "{rounded.xl}"
    padding: "0.625rem 1.25rem"
  button-ghost:
    textColor: "{colors.surface-600}"
    rounded: "{rounded.xl}"
    padding: "0.5rem 1rem"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
    rounded: "{rounded.xl}"
    padding: "0.625rem 1.25rem"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.surface-900}"
    rounded: "{rounded.xl}"
    padding: "0.625rem 1rem"
  badge:
    rounded: "{rounded.full}"
    padding: "0.125rem 0.625rem"
---

# Design System: NexoFitness

## 1. Overview

**Creative North Star: "The Control Room"**

NexoFitness is an operator's command surface. The person on the other side of the screen is running a gym, often with a queue at the front desk, and the interface exists to make their next action obvious and fast. Electric cyan is the signal color, used as a deliberate spotlight on a calm slate field, never as wallpaper. Hierarchy is carried by tone and spacing first; color second. Every screen answers one question loudly ("who's checking in", "what did we sell today", "which class needs an instructor") and lets the rest recede.

The system reads as confident, modern, and energetic without being loud. Motion has momentum and intent, it confirms state and continuity, it never fills silence. The aesthetic explicitly rejects four things: the **generic SaaS template** (hero-metric cards, identical icon-heading-text grids, gradient text, tracked uppercase eyebrows), the **loud consumer fitness app** (neon everywhere, gamified noise, aggressive gradients), the **dated enterprise admin** (gray Bootstrap tables, cramped rows, flat 2014-era hierarchy), and **clutter** (widget soup with no breathing room).

A second identity layer rides on top: each tenant gets dynamic branding via `--gym-brand` on member-facing storefront and app surfaces. Structure stays constant across tenants; the per-gym color does the branding work.

**Key Characteristics:**
- Cyan is a signal, not a surface. One spotlight per view.
- Slate neutrals carry hierarchy; dark mode is first-class (`darkMode: class`).
- One primary task per screen, loudest element on the page.
- Mobile-first member surfaces (touch ≥44px, bottom nav); desktop is the adaptation.
- Tenant color (`--gym-brand`) overrides cyan on public/member surfaces without changing structure.

## 2. Colors

A cool slate field with a single electric-cyan signal; semantic accents (emerald/amber/red) reserved strictly for status.

### Primary
- **Electric Cyan** (`#06b6d4`, brand-500): the signal. Primary buttons, active nav, focus rings, links, the one thing per screen that should pull the eye. On public/member surfaces it is replaced by the tenant's `--gym-brand`.
- **Cyan Deep** (`#0891b2`, brand-600 / `#0e7490`, brand-700): hover/pressed states and gradient termination for the primary button.
- **Cyan Bright** (`#22d3ee`, brand-400): light-on-dark accents, glow highlights.

### Neutral
- **Slate Ink** (`#0f172a`, surface-900 / `#020617`, surface-950): primary text on light; page background in dark mode.
- **Slate Body** (`#334155`, surface-700 / `#64748b`, surface-500): secondary text, labels.
- **Slate Line** (`#e2e8f0`, surface-200 / `#334155` dark): borders, dividers, table rules.
- **Slate Paper** (`#f8fafc`, surface-50 / `#f1f5f9`, surface-100): page and panel backgrounds on light.

### Status (semantic only)
- **Emerald** (`#10b981`): success, active membership, paid.
- **Amber** (`#f59e0b`): warning, expiring, pending.
- **Red** (`#ef4444`): danger, overdue, destructive actions.

### Named Rules
**The One Signal Rule.** Cyan (or the tenant `--gym-brand`) marks the single most important action or state in a view. If two things are cyan, neither is the signal. Status colors are not decoration: emerald/amber/red appear only when they report real state.

**The Tenant Override Rule.** On any `/public` or `/member` surface, the brand color is `var(--gym-brand)`, never hardcoded cyan. Structure, spacing, and type stay identical across tenants; only the signal hue changes.

## 3. Typography

**Display Font:** Outfit (with system-ui, sans-serif)
**Body Font:** IBM Plex Sans (with system-ui, sans-serif)
**Mono Font:** JetBrains Mono (numbers, IDs, codes)

**Character:** A geometric display (Outfit) over a humanist body (IBM Plex Sans) — paired on a contrast axis, not two near-identical sans. Outfit gives headings tight, confident geometry; IBM Plex keeps long-form reading warm and legible. Mono is reserved for data that must align (amounts, member IDs, promo codes).

### Hierarchy
- **Display** (Outfit 700, `clamp(1.875rem, 4vw, 3rem)`, lh 1.1, tracking -0.02em): page titles, hero numbers on member surfaces. Ceiling well under the 6rem shout line.
- **Headline** (Plex 700, 1.5rem, lh 1.25): section headers, modal titles.
- **Title** (Plex 600, 1.125rem, lh 1.4): card headers, table group labels.
- **Body** (Plex 400, 0.9375rem, lh 1.6): default reading text. Cap measure at 65–75ch.
- **Label** (Plex 600, 0.75rem, tracking 0.01em): form labels, badge text, table column heads. Sentence case.
- **Mono** (JetBrains Mono 400, 0.875rem): tabular numerics, IDs, codes.

### Named Rules
**The Sentence-Case Rule.** UI labels are sentence case. Reserve uppercase for ≤4-word badges only. No tracked uppercase eyebrows above sections, ever.

## 4. Elevation

Flat at rest, depth on state. Surfaces sit flat on the slate field and earn separation through tone (`surface-50` panel on `surface-100` page; in dark, `surface-900` on `surface-950`) and 1px slate borders. Shadows are not structural; they are a response to interaction.

### Shadow Vocabulary
- **State lift** (`box-shadow: 0 10px 15px -3px rgba(6,182,212,0.10)`): cards on hover (`card-hover` rises `-translate-y-1` with a brand-tinted shadow). Confirms "this is interactive".
- **Signal glow** (`box-shadow: 0 4px 14px rgba(6,182,212,0.25→0.40)`): primary button at rest → hover. The cyan halo marks the signal action.
- **Focus ring** (`box-shadow: 0 0 0 2px rgba(6,182,212,0.40)`): keyboard/focus on inputs and controls.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest; shadows appear only as a response to state (hover, focus, the primary signal). If a card has a resting drop shadow for decoration, remove it and let tone carry the layer. Audit test: if it looks like a 2014 app, the shadow is too dark and sits at rest instead of on hover.

## 5. Components

### Buttons
- **Shape:** generously rounded (`rounded-xl`, 0.75rem) across all variants.
- **Primary:** cyan gradient `from-brand-500 to-brand-600` → hover `from-brand-600 to-brand-700`, white text, `px-5 py-2.5`, brand-tinted shadow `shadow-brand-500/25` → `/40`, `active:scale-[0.98]`. Tactile and responsive: it presses.
- **Secondary:** `surface-100` fill (dark `surface-800`), slate text, 1px border, same press.
- **Ghost:** transparent, slate-600 text, hover fills `surface-100`. For low-emphasis inline actions.
- **Danger:** solid `red-500` → hover `red-600`, white text, red-tinted shadow. Destructive only.

### Inputs / Fields
- **Style:** white (dark `surface-800`), 1px slate border, `rounded-xl`, `px-4 py-2.5`.
- **Focus:** 2px cyan ring `ring-brand-500/40` + border shifts to `brand-500`.
- **Placeholder:** `surface-400` — verify it clears 4.5:1 on white; nudge toward `surface-500` on tinted backgrounds.

### Badges
- **Shape:** pill (`rounded-full`), `px-2.5 py-0.5`, label type, `font-semibold`.
- **Variants:** success (emerald), warning (amber), danger (red), info (cyan), neutral (slate) — each a tonal tint (`-100` bg / `-700` text light; `-900/30` bg / `-400` text dark). Color always pairs with text, never color-alone.

### Tables
- **Rows:** 1px bottom slate border, hover `surface-50` (dark `surface-800/50`), 150ms color transition. No zebra striping; tone-on-hover carries scanability.

### Navigation
- **Sidebar item:** `rounded-xl`, `px-3 py-2.5`, label type. Active = `brand-50` bg + `brand-700` text (dark `brand-950/50` + `brand-300`). Reception/trainer/member roles see scoped menus.
- **Member surfaces:** bottom nav, thumb-first, ≥44px targets.

### Storefront (signature)
Public tenant pages use the `sf-*` token layer driven entirely by `--gym-brand` (borders, glows, gradients, chips at controlled opacities). Same structure as the app; the tenant's color replaces cyan throughout.

## 6. Do's and Don'ts

### Do:
- **Do** keep one cyan signal per view (One Signal Rule). The primary action or the most important state, nothing else.
- **Do** drive all public/member branding through `var(--gym-brand)` — never hardcode `#06b6d4` on `/public` or `/member` surfaces (Tenant Override Rule).
- **Do** carry hierarchy with tone + spacing first; reach for color second.
- **Do** keep surfaces flat at rest and lift them on hover/focus with brand-tinted shadows (Flat-By-Default Rule).
- **Do** use `rounded-xl` (0.75rem) and `active:scale-[0.98]` consistently so controls feel tactile.
- **Do** ship a `prefers-reduced-motion: reduce` alternative for every animation; body text ≥4.5:1, large ≥3:1.
- **Do** pair every status color with an icon or label (color-blind safe).

### Don't:
- **Don't** build the **generic SaaS template**: no hero-metric cards (big number + small label + supporting stats), no identical icon-heading-text card grids repeated endlessly, no tracked uppercase eyebrows or `01 / 02 / 03` markers above every section.
- **Don't** drift toward the **loud consumer fitness app**: no neon-everywhere, no gamified noise, no aggressive multi-stop gradients as backdrop.
- **Don't** ship the **dated enterprise admin**: no gray Bootstrap tables, cramped rows, or flat hierarchy.
- **Don't** clutter: one primary task per screen, no widget soup, protect breathing room.
- **Don't** lean on `text-gradient` / gradient-clipped headings or default glassmorphism (`.glass`) decoratively — both exist in the codebase but are reserved, not reflexes. A single solid color and weight contrast beats gradient text.
- **Don't** use `border-left/right > 1px` as a colored accent stripe on cards or alerts. Use full borders, tints, or leading icons.
- **Don't** let a second element compete with the cyan signal; if two things shout, neither leads.
