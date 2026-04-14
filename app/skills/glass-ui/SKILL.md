---
name: glass-ui
description: Liquid Glass UI system — frosted glassmorphism with cinematic depth. Apply to any web project for premium transparent panel aesthetics.
version: 1.0.0
tags: [ui, css, glassmorphism, design-system]
---

# Glass UI — Liquid Glassmorphism Design System

Apply this skill whenever building UI with frosted glass / glassmorphism aesthetics. This system produces cinematic, premium transparent panels that layer over rich backgrounds (video, gradients, imagery).

## Core CSS Class: `.liquid-glass`

```css
.liquid-glass {
  backdrop-filter: blur(40px) saturate(1.3);
  -webkit-backdrop-filter: blur(40px) saturate(1.3);
  background: rgba(255, 255, 255, 0.01);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.1),
    inset 0 -1px 0 rgba(255, 255, 255, 0.02),
    0 8px 32px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  transition: background 0.3s, box-shadow 0.3s;
}

.liquid-glass:hover {
  background: rgba(255, 255, 255, 0.03);
}
```

## Design Principles

1. **Near-zero opacity backgrounds** — Use `rgba(255,255,255, 0.01)` to `0.04`. Never exceed `0.08`. The glass should be almost invisible.
2. **Inset highlight** — Always include `inset 0 1px 1px rgba(255,255,255,0.1)` for the top-edge light refraction effect.
3. **Deep outer shadow** — `0 8px 32px rgba(0,0,0,0.3)` lifts panels off the background.
4. **1px border ring** — `0 0 0 1px rgba(255,255,255,0.06)` provides subtle edge definition without a CSS border.
5. **Saturate boost** — `saturate(1.3)` on backdrop-filter enriches the blurred background colors.
6. **Large blur radius** — 40px minimum for the frosted effect. Use 20px for smaller elements (pills, badges).

## CSS Variables Template

```css
:root {
  --glass-bg: rgba(255, 255, 255, 0.01);
  --glass-bg-hover: rgba(255, 255, 255, 0.03);
  --glass-border: rgba(255, 255, 255, 0.06);
  --glass-highlight: rgba(255, 255, 255, 0.1);
  --glass-blur: 40px;
  --glass-radius: 16px;
  --glass-radius-sm: 10px;
  --glass-radius-pill: 100px;
}
```

## Variant: `.glass-pill` (Buttons & Badges)

```css
.glass-pill {
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 100px;
  color: rgba(255, 255, 255, 0.92);
  padding: 6px 14px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.25s;
}

.glass-pill:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(142, 202, 230, 0.4);
}
```

## Variant: `.glass-input` (Form Controls)

```css
.glass-input {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.92);
  padding: 8px 14px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.glass-input:focus {
  border-color: rgba(142, 202, 230, 0.3);
  box-shadow: 0 0 0 3px rgba(142, 202, 230, 0.08);
}
```

## Background Requirements

Glass UI requires a visually rich background to be effective:

```css
/* Option A: Fullscreen video */
.video-bg {
  position: fixed; inset: 0; z-index: 0;
}
.video-bg video {
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.55;  /* Dim video so glass panels remain readable */
}

/* Option B: Gradient mesh */
body {
  background: #0a0a0f;
  background-image:
    radial-gradient(ellipse at 20% 30%, rgba(142,202,230,0.08) 0%, transparent 50%),
    radial-gradient(ellipse at 80% 70%, rgba(224,201,127,0.06) 0%, transparent 50%);
}
```

## Typography Pairing

- **Display**: Outfit, Sora, or General Sans (weight 200–600)
- **Mono/Data**: DM Mono, JetBrains Mono, or IBM Plex Mono (weight 300–400)
- **Text color**: `rgba(255,255,255,0.92)` primary, `0.55` secondary, `0.3` tertiary
- **Never** use pure white `#fff` — it's too harsh against glass.

## Color Accents

Use muted, luminous accents that complement the frosted aesthetic:

```css
--accent-ice: #8ecae6;      /* Cool highlights */
--accent-gold: #e0c97f;     /* Warm highlights */
--accent-green: #4ade80;    /* Positive/up */
--accent-red: #f87171;      /* Negative/down */
```

Apply accents sparingly — glass panels carry the design. Accents are for data and interactive states only.

## Animation Guidelines

- **Panel entrance**: `translateY(12px) scale(0.98)` → `none`, staggered with `animation-delay`
- **Hover transitions**: 0.25s–0.3s ease
- **No heavy transforms on glass elements** — repainting backdrop-filter is expensive
- **Subtle float** on logos: `translateY(-3px)` at 6s intervals

## Anti-patterns (NEVER do these)

- White or light backgrounds behind glass (glass needs contrast)
- Opacity above 0.1 on glass backgrounds (breaks the transparency illusion)
- Colored glass backgrounds (use tinted accents on borders/text instead)
- CSS `border` on glass panels (use `box-shadow` ring instead — cleaner)
- Thick borders or heavy outlines
- Drop shadows without the inset highlight (looks flat)
