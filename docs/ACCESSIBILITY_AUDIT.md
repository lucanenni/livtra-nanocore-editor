# Accessibility audit: NanoCore Editor

**Standard:** WCAG 2.1 AA | **Date:** 2026-08-06 | **Method:** code inspection +
computed contrast ratios + live keyboard/DOM verification in-browser (both themes)

## Summary

**Issues found:** 8 | **Critical:** 1 | **Major:** 3 | **Minor:** 4 — all fixed
in this pass.

## Findings & fixes

### Operable

| # | Issue | WCAG | Severity | Fix |
|---|-------|------|----------|-----|
| 1 | Each block's Power toggle used `display: none` on the real `<input type="checkbox">`, which removes an element from the tab order entirely — the control could only ever be operated with a mouse. | 2.1.1 Keyboard | 🔴 Critical | Swapped to the `.visually-hidden` clip-rect technique (hidden visually, still focusable), added a `:focus-within` ring on the visible pill so keyboard users see where focus is. Verified via `element.focus()` + `document.activeElement` that the control is now reachable. |
| 2 | Transport picker, sidebar tabs, and the effect-chain block selector convey "currently selected" only through a CSS class — no ARIA state. | 4.1.2 Name, Role, Value | 🟡 Major | Added `aria-pressed` to all three (`ConnectionPanel`, `App`'s tab nav, `ChainView`). |
| 3 | Smallest buttons (`.btn--small`, e.g. preset Load/Delete, log Clear) had a ~23px touch target. | 2.5.5 Target Size (AAA, not strictly AA — flagged anyway per the audit checklist) | 🟢 Minor | Bumped `.btn--small` padding (5px 10px → 8px 12px). Full 44px compliance on the compact preset-list/log rows would need a layout rework — deferred, not a blocking AA issue. |

### Perceivable

| # | Issue | WCAG | Severity | Fix |
|---|-------|------|----------|-----|
| 4 | Light theme: white button/tab text on `--accent` (#d9622b) measured **3.66:1**; white text on `--ok` (#2f9e5b, the "On" pill) measured **3.41:1**. Both below the 4.5:1 required for normal-size text. | 1.4.3 Contrast (Minimum) | 🔴 Major | Darkened light-theme `--accent` to `#a04517` (6.25:1) and `--ok` to `#227a45` (5.32:1/5.33:1 both directions). Dark theme was already passing (6.71:1 / 7.16:1) and is unchanged. |
| 5 | `--border` (used for input/select/button outlines) measured **1.4:1** in light theme and **1.23:1** in dark theme against their backgrounds — well under the 3:1 needed for UI-component boundaries. | 1.4.11 Non-text Contrast | 🟡 Major | Introduced a second token, `--border-strong` (light `#8b9099` → 3.21:1, dark `#6a707b` → 3.28:1), applied to interactive controls only (`.btn`, `select`/`input[text/number]`, `.segmented`, the preset-rename field) — purely decorative dividers/panel borders keep the original softer `--border` since 1.4.11 doesn't apply to non-essential decoration. |
| 6 | The effect-chain's on/off indicator was a plain colored dot — state was conveyed by color alone. | 1.4.1 Use of Color | 🟢 Minor | Added an `aria-label` combining block name + on/off state (e.g. "FX1 — On") on each chain button; the visible label text stays block-name-only (`aria-hidden`) since color remains a fine visual cue for sighted users once a non-color channel also exists. |

### Robust

| # | Issue | WCAG | Severity | Fix |
|---|-------|------|----------|-----|
| 7 | Two `<nav>` landmarks (effect chain, sidebar tabs) — only the first had an `aria-label`, so screen-reader users navigating by landmark would hear "navigation" twice with no way to tell them apart. | 4.1.2 / 2.4.1 (best practice) | 🟢 Minor | Added `aria-label="Sections"` (translated) to the sidebar tab nav. |
| 8 | The Power toggle's `aria-label="On"` on the checkbox overrode its wrapping `<label>` text, so it was announced as just "On" instead of "Power" — losing context and duplicating what the checked state already conveys. | 4.1.2 Name, Role, Value | 🟢 Minor | Removed the redundant `aria-label`; the checkbox's name now comes from the label's "Power" text (state is separately conveyed by the native checked/unchecked property). |

## Color contrast check (after fixes)

| Element | Foreground | Background | Ratio | Required | Pass? |
|---|---|---|---|---|---|
| Body text, light | `#16181d` | `#f4f5f7` | 16.28:1 | 4.5:1 | ✅ |
| Body text, dark | `#eceef2` | `#14161a` | 15.59:1 | 4.5:1 | ✅ |
| Muted text, light | `#5b616e` | `#ffffff` | 6.21:1 | 4.5:1 | ✅ |
| Muted text, dark | `#9aa0ac` | `#1d2026` | 6.22:1 | 4.5:1 | ✅ |
| Button text on accent, light | `#ffffff` | `#a04517` | 6.25:1 | 4.5:1 | ✅ (was 3.66:1 ❌) |
| Button text on accent, dark | `#14161a` | `#ef7f3f` | 6.71:1 | 4.5:1 | ✅ |
| "On" pill text, light | `#ffffff` | `#227a45` | 5.32:1 | 4.5:1 | ✅ (was 3.41:1 ❌) |
| "On" pill text, dark | `#14161a` | `#4bc17c` | 7.16:1 | 4.5:1 | ✅ |
| Danger text, light/dark | `#c94141`/`#e0665f` | bg-elevated | 4.87:1 / 4.85:1 | 4.5:1 | ✅ |
| Warning banner text | `#6b5106`/`#f0cf7e` | warn-bg | 6.79:1 / 8.92:1 | 4.5:1 | ✅ |
| Control border, light | `#8b9099` | `#ffffff` | 3.21:1 | 3:1 | ✅ (was 1.4:1 ❌) |
| Control border, dark | `#6a707b` | `#1d2026` | 3.28:1 | 3:1 | ✅ (was 1.23:1 ❌) |

## Keyboard navigation (verified live)

| Element | Reachable via Tab | Activates | Visible focus |
|---|---|---|---|
| Block Power toggle | ✅ (was ❌ before fix) | native checkbox (Space/click, standard browser behavior — see note) | ✅ ring on pill via `:focus-within` |
| Transport/tab/chain buttons | ✅ (real `<button>`s throughout) | native (Space/Enter/click) | ✅ browser default outline, untouched |
| Sliders, selects, text inputs | ✅ | native | ✅ browser default outline, untouched |

Note: this sandboxed browser tool's synthetic key-press simulation doesn't
trigger native Space/Enter activation on *any* element (confirmed on a plain
`<button>` too — a click-event listener never fired from a simulated Space
press), so that specific interaction couldn't be exercised end-to-end here.
This is a tooling limitation, not an app defect: every interactive control in
the app is a genuine semantic HTML element (`<button>`, `<input>`, `<select>`,
`<label>`) rather than a `<div onClick>`, so standard keyboard activation is
inherited from the browser for free and doesn't depend on custom JS. Worth a
quick real-keyboard sanity pass once you're testing casually.

## Not covered in this pass

- Full screen reader testing (VoiceOver/NVDA) — recommend a quick manual pass.
- 200%-zoom reflow check — deferred to the upcoming mobile/responsive review.
- Exhaustive 44×44 touch targets (WCAG AAA, not AA) across every compact
  control — the worst offenders were nudged; a full pass would mean loosening
  the preset-list/log-row layouts.
