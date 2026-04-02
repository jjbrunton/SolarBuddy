# Design System

SolarBuddy uses a shared visual system intended to make the application feel functional, calm, and consistent without losing its control-room character.

This document is the canonical guide for styling work in the UI. Read it before introducing new page chrome, custom component styling, or additional view-specific presentation patterns.

## Design Intent

- SolarBuddy should feel calm, operational, and trustworthy.
- The UI should prioritise live-state clarity over decoration.
- Visual polish comes from consistency, hierarchy, and restraint rather than visual noise.
- Bright colour is reserved for energy signals, live status, and exceptions.

## Core Principles

### 1. Use semantic tokens, not ad hoc colours

- Theme tokens live in [`src/app/globals.css`](../src/app/globals.css).
- Prefer semantic names such as `sb-card`, `sb-surface-muted`, `sb-text-subtle`, `sb-accent`, `sb-solar`, and `sb-grid`.
- Avoid introducing raw hex values directly in page or component markup unless a charting library requires it and there is no shared token path available.

### 2. Centralise page structure

- Every primary route should use [`src/components/ui/PageHeader.tsx`](../src/components/ui/PageHeader.tsx) for page title, description, and top-level actions.
- Route-level pages should keep the same vertical rhythm: `PageHeader`, filters or tabs, summary cards, then detail panels.

### 3. Reuse shared surfaces and controls

- Use [`src/components/ui/Card.tsx`](../src/components/ui/Card.tsx) for panels and section containers.
- Use [`src/components/ui/Button.tsx`](../src/components/ui/Button.tsx) for actions.
- Use [`src/components/ui/Tabs.tsx`](../src/components/ui/Tabs.tsx) for segmented controls and navigation tabs.
- Use [`src/components/ui/EmptyState.tsx`](../src/components/ui/EmptyState.tsx) for no-data and waiting states.
- Use [`src/components/ui/PlaceholderValue.tsx`](../src/components/ui/PlaceholderValue.tsx) for missing field values and telemetry that has not arrived yet.
- Use [`src/components/ui/Badge.tsx`](../src/components/ui/Badge.tsx) for concise state labels.

### 4. Keep data presentation systematic

- Summary numbers should use large, high-contrast typography with restrained supporting copy.
- Tables should use the same header treatment: uppercase micro-labels, subtle borders, and padded rows.
- Description lists should use the shared [`src/components/ui/DescriptionList.tsx`](../src/components/ui/DescriptionList.tsx) component rather than bespoke label-value layouts.
- Dashboard overview widgets should not repeat the same signal in multiple panels. If a live metric is already visible in a primary widget, neighbouring widgets should add context or link to a deeper workflow instead of restating that value.

### 5. Keep forms consistent

- Shared settings form patterns live in [`src/components/settings/shared.tsx`](../src/components/settings/shared.tsx).
- Use `Field`, `SettingsSection`, `SettingsTabs`, and `inputClass` rather than redefining field spacing or input chrome inside each page.

## Tokens

The token system is split into a few categories:

- Shell and surface tokens: background, elevated background, sidebar, header, card, hover, muted surface.
- Border tokens: default and strong.
- Text tokens: primary, muted, subtle.
- State and domain tokens: accent, success, warning, danger, info, solar, grid, load.
- Input and focus tokens.
- Shadow tokens for panel depth and highlighted surfaces.

The system supports both dark and light themes via root variable overrides.

## Typography

- Primary UI font: `Manrope`
- Numeric and diagnostic font: `JetBrains Mono`
- Use the mono face for payloads, topics, and machine-oriented text only.
- Prefer strong hierarchy over more font styles. Use weight and size before introducing additional visual treatment.

## Page Anatomy

The standard route anatomy is:

1. `PageHeader`
2. Optional tabs or segmented filters
3. Summary or stat cards
4. Main chart/panel
5. Secondary detail panels or tables

This keeps dashboard, analytics, settings, diagnostics, and telemetry views aligned even when their content differs.

## Component Inventory

The current shared layer is built from:

- [`src/components/ui/PageHeader.tsx`](../src/components/ui/PageHeader.tsx)
- [`src/components/ui/Button.tsx`](../src/components/ui/Button.tsx)
- [`src/components/ui/Card.tsx`](../src/components/ui/Card.tsx)
- [`src/components/ui/Tabs.tsx`](../src/components/ui/Tabs.tsx)
- [`src/components/ui/EmptyState.tsx`](../src/components/ui/EmptyState.tsx)
- [`src/components/ui/PlaceholderValue.tsx`](../src/components/ui/PlaceholderValue.tsx)
- [`src/components/ui/Badge.tsx`](../src/components/ui/Badge.tsx)
- [`src/components/ui/DescriptionList.tsx`](../src/components/ui/DescriptionList.tsx)
- [`src/components/ui/FieldSet.tsx`](../src/components/ui/FieldSet.tsx)
- [`src/components/ui/ProgressBar.tsx`](../src/components/ui/ProgressBar.tsx)
- [`src/components/settings/shared.tsx`](../src/components/settings/shared.tsx)

When a new visual pattern appears in more than one route, move it into this shared layer before reusing it.

## Charts

- Chart panels should be wrapped in `Card`.
- Legends should use the shared token palette.
- Empty or loading states should use the same copy and alignment conventions as the rest of the app.
- Missing field values should use the shared placeholder treatment instead of raw `--` or em-dash fallbacks.
- For chart tooltips, prefer the shared tooltip primitives in [`src/components/ui/ChartTooltip.tsx`](../src/components/ui/ChartTooltip.tsx).
- Time-series charts must use a unique slot identifier such as the ISO `valid_from` value for `XAxis.dataKey`, then format the visible tick text separately. Do not use a display-only `HH:MM` string as the category key because repeated wall-clock times can misalign hover state and tooltips.

## Live Telemetry Diagrams

- The dashboard energy-flow widget should allocate directed paths from the current telemetry rather than assuming a single source per node.
- `grid_power > 0` means import and `grid_power < 0` means export.
- `battery_power > 0` means the battery is charging and `battery_power < 0` means it is discharging.
- When the battery is charging, the diagram should only render `solar -> battery` after solar has first covered the current home load. Any remaining battery charge demand must render as `grid -> battery`.
- Export can continue to use the shared `home -> grid` route as the outbound path even when the surplus originated from solar or battery discharge.

## Dos and Don'ts

### Do

- Introduce new variants by extending shared primitives.
- Keep route handlers and business logic separate from visual styling decisions.
- Prefer a small number of well-named system components over many one-off wrappers.

### Don't

- Add new page titles with hand-written `h1` plus local action rows when `PageHeader` fits.
- Create one-off button and tab styling inside route files.
- Reintroduce flat black surfaces or highly saturated accent colours outside semantic states.

## Verification Expectations For UI Changes

When changing the design system or page presentation:

- Run `npm test`
- Run `npm run build`
- Update this document if the shared component inventory, page anatomy, or token conventions change
