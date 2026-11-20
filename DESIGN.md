# Constellation Suite: Obsidian Atelier Design System

## 1. Visual Identity & Aesthetic Direction
- **Archetype**: Ethereal Obsidian Atelier (Minimalist Luxury, tactile hardware feel, zero clutter).
- **Guiding Principle**: Zero unnecessary text. Controls communicate through ultra-thin light-weight icons, live micro-swatches, geometric indicators, and spatial breathing room. Floating chrome automatically fades out after 2.5 seconds of cursor inactivity so music, typography, and light remain the centerpiece.
- **Anti-Slop Guarantee**:
  - ZERO generic purple-blue AI gradients.
  - ZERO Inter, Roboto, Arial, or Helvetica fonts.
  - ZERO thick-stroke standard icon sets.
  - ZERO harsh dark drop shadows (`shadow-md`) or full-screen content blur.

## 2. Color & Surface Tokens
- **Void Obsidian (Primary Canvas)**: `#070709`
- **Machined Carbon (Inner Core)**: `#0E0E12`
- **Elevated Slate (Hover / Active Pill)**: `#15151B`
- **Smoked Glass (Fixed Floating Chrome Only)**: `rgba(14, 14, 18, 0.74)` with `backdrop-filter: blur(24px) saturate(140%)`
- **Warm Ivory (Primary Ink)**: `#F4F2ED`
- **Champagne Ash (Muted Ink)**: `#8E8A82`
- **Champagne Gold (Fallback Luxury Accent)**: `#D6B98C`
- **Adaptive Album Accent**: Dynamic RGB extracted from active album artwork (`palette`), luminance-calibrated for WCAG legibility.
- **Hairline Border**: `rgba(255, 255, 255, 0.08)`

## 3. Double-Bezel Container Standard
Every floating drawer, island, card, or modal uses machined nested enclosures:
- **Outer Shell**: `bg-white/[0.03] border border-white/[0.08] p-1.5 rounded-[1.75rem]`
- **Inner Core**: `bg-[#0E0E12]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] rounded-[calc(1.75rem-0.375rem)]`
- **Nested Button-in-Button**: Primary rounded pills (`rounded-full`) embed trailing icons inside a circular `bg-white/[0.07]` capsule with micro-translation on hover.

## 4. Typography
- **Editorial Display Serif (`--font-display`)**: `'Instrument Serif', Georgia, serif` for lyrics, monumental BigWords, and luxury clock faces.
- **Micro UI Sans (`--font-sans`)**: `'Plus Jakarta Sans', system-ui, sans-serif` for minimal labels and compact tracks.
- **Telemetry & Terminal Mono (`--font-mono`)**: `'JetBrains Mono', ui-monospace, monospace` with `font-variant-numeric: tabular-nums` for Terminal lyric mode, timestamps, WPM, and hardware metrics.

## 5. Iconography
- Exclusively `@phosphor-icons/react` using `weight="light"` (1.25px optical stroke).

## 6. Motion & Performance Rules
- **Framer Motion**: Spring-driven morphing (`layoutId`), Dynamic Island expansion, modal presence (`AnimatePresence`), and tactile press (`scale: 0.97`).
- **GSAP**: Precision timeline choreography for `Lines` / `BigWords` lyric transitions and vinyl turntable tonearm articulation.
- **GPU-Safe**: Animate exclusively `transform` and `opacity`. Honor `prefers-reduced-motion` across all animations and shaders.
- **4 Boundary States**: Every dynamic view implements Loading Skeleton, Empty State, Error Boundary/Banner, and Feedback Toast.
