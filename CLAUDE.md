# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Shopify storefront theme forked from Shopify's **Horizon** theme (currently synced to Horizon v4.1.4 via upstream PRs). It is pure Liquid + vanilla JS/CSS — there is **no build step, no package.json, no bundler**. Files are edited in place and deployed with the Shopify CLI.

## Commands

```sh
shopify theme dev          # local dev server connected to a store
shopify theme check        # lint/validate (Theme Check) — the only "test" that exists
shopify theme push / pull  # deploy / sync with a store
```

To pull upstream Horizon changes: `git fetch upstream && git pull upstream main` (upstream = github.com/Shopify/horizon).

Commits must follow Conventional Commits (`feat:`, `fix:`, `refactor:`, etc. — see `.cursor/rules/commit-messages.mdc`).

## Architecture

Standard Shopify theme layout (`layout/`, `templates/` as JSON, `sections/`, `blocks/`, `snippets/`, `assets/` (flat, no subdirectories), `config/`, `locales/`), but Horizon is aggressively **block-based**:

- **Theme blocks** (`blocks/*.liquid`) are the primary unit of UI. Sections are often thin wrappers that render blocks via `{% content_for 'blocks' %}` (dynamic, merchant-arranged) or `{% content_for 'block', type: '...', id: '...' %}` (static, developer-placed).
- Blocks whose filenames start with `_` (e.g. `blocks/_product-card.liquid`) are private/static blocks not directly exposed in the theme editor's block picker.
- Every section/block ends with a `{% schema %}` JSON block. **Edit schemas directly in the `.liquid` file.** (Several `.cursor/rules` files say schemas are generated from a `schemas/` folder via `pnpm run build:schemas` — that applies only to Shopify's internal Horizon repo; neither `schemas/` nor `package.json` exists here.)
- Schema `name`/`label` values use translation keys (`"t:names.xxx"`, `"t:settings.xxx"`) resolved from `locales/*.schema.json`; storefront strings use `{{ 'key' | t }}` resolved from `locales/*.json` (`en.default.json` is canonical).

### JavaScript

- **Zero external dependencies.** ES modules loaded through an **import map** defined in `snippets/scripts.liquid` (`@theme/component`, `@theme/events`, `@theme/utilities`, ...). A new shared module must be added to that import map to be importable as `@theme/<name>`.
- UI behavior is built as **web components extending the `Component` base class** in `assets/component.js`. It provides:
  - `this.refs` — auto-collected from child elements with `ref="name"` attributes (kept fresh via MutationObserver); declare `requiredRefs` to assert presence. Typed via JSDoc `@typedef ... Refs` + `@extends {Component<Refs>}`.
  - Declarative event listeners via `on:event` attributes in the markup (e.g. `on:click="/handleAddToCart"`).
- Cross-component communication uses custom events defined in `assets/events.js` (`ThemeEvents` + typed Event subclasses) dispatched/listened on `document`.
- Style: `const` over `let`, `for...of` over `.forEach()`, async/await over `.then()`, JSDoc types throughout (`assets/global.d.ts` provides ambient types).

### CSS

- Shared/global CSS lives in `assets/base.css`; component-specific CSS goes in the `{% stylesheet %}` tag of that section/block (Shopify concatenates these into one stylesheet — they are not per-instance).
- Per-instance settings are applied by setting **CSS custom properties in an inline `style` attribute** (`style="--gap: {{ block.settings.gap }}px"`), never with `.selector--{{ block.id }}` rules in `{% style %}` tags.
- BEM naming; single-class selectors (max specificity ~0-4-0); no IDs, no `!important`; never hardcode colors — use color-scheme variables. Global variables are defined in `snippets/theme-styles-variables.liquid`; scoped variables are namespaced per component (`--component-*`).
- Server-rendered, progressive enhancement, no polyfills — business logic (translations, money formatting) stays in Liquid, not JS.

### Liquid conventions

- Every snippet (and block) starts with a `{% doc %}` LiquidDoc header documenting `@param`s (bracketed names = optional) and an `@example`.
- Prefer inlining Liquid expressions in attributes over `assign`/`capture` variable indirection; use `{% liquid %}` for multiline logic and `{% # ... %}` for inline comments.
- All user-facing text goes through translation keys — never hardcode English strings.
- SVG icons live in `assets/icon-*.svg` (rendered via `inline_asset_content`) and must have `aria-hidden="true"` on the root element.

## Detailed standards in .cursor/rules/

`.cursor/rules/` contains the authoritative, detailed standards these summaries come from: `liquid.mdc`, `blocks.mdc`, `sections.mdc`, `snippets.mdc`, `schemas.mdc`, `css-standards.mdc`, `javascript-standards.mdc`, `html-standards.mdc`, `locales.mdc`, `theme-settings.mdc`, plus ~25 component-specific **accessibility** rules (carousel, modal, cart drawer, product filters, forms, focus order, color contrast, ...). When working on a component with a matching accessibility rule file, follow it — accessibility requirements here are extensive and specific.

`.agents/skills/` contains vendored Shopify AI toolkit skills (shopify-dev docs search, shopify-liquid, storefront GraphQL, Shopify CLI usage), pinned by `skills-lock.json`.

## Claude Code skills

`.claude/settings.json` enables the `liquid-skills` plugin (plus `liquid-lsp`). Before creating or editing `.liquid` files, load the matching skill: `shopify-liquid-themes` for sections/blocks/snippets/schema work, `liquid-theme-standards` for CSS/JS/HTML in theme files, and `liquid-theme-a11y` when building or fixing accessible components (carousels, cart drawer, filters, modals, product cards, ...).
