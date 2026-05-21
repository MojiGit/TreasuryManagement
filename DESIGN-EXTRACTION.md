# Gufo Treasury — Design Extraction Reference

A complete technical specification of the Ledgerline / Gufo Treasury Report design across all six pages of the PDF (Cover, Portfolio Overview, Wallets, Target Allocations, Rebalance Plan, Post-rebalance check). All values are sourced directly from the implementation — none are estimated unless explicitly marked.

---

## 1. Design Philosophy

**Aesthetic.** Soft prosumer finance — calm, light, document-like. The design reads as an editorial financial report rather than a real-time trading platform. Off-white warm-toned paper background, white surfaces with hairline borders, restrained violet accents reserved for emphasis. Numbers are monospace and tabular; text is humanist sans-serif. The single decorative gesture is a faint violet radial glow on the cover and the hero portfolio card; everything else is flat.

**Tone.** Formal but not corporate. Confident, factual, low-key. Dense data without being terminal-like — every value is given breathing room. Modern but quiet: no neon, no aggressive gradients, no skeuomorphism, no 3-D, no shadows beyond a single near-invisible 1px lift.

**Reference points.** Quiet fintech reports (Mercury statements, Stripe Atlas summaries), Swiss editorial design, light-mode dashboard SaaS from 2023–2024 (Linear, Vercel, Geist DS family). Geist is used both for type and for the unbranded "instrument panel" aesthetic.

**Deliberately not doing:**
- Not a Bloomberg / TradingView dark terminal
- Not a consumer crypto wallet (no neon, no friendly cartoon, no rainbow gradients, no glassmorphism)
- Not a marketing site (no big hero photos, no testimonials, no large rounded buttons)
- Not skinny-utility (lots of vertical air around primary numbers)
- Not data-art — no dashboards with eight chart types competing for attention
- No emoji anywhere except the typographic star "★" used as a marker for the Master account

---

## 2. Design Tokens

### 2.1 Color palette

All colors are defined as CSS custom properties in OKLCH. Hex equivalents are computed and provided here for systems that don't render OKLCH.

| Token | OKLCH (source) | Hex (sRGB) | Role |
|---|---|---|---|
| `--bg` | `oklch(0.985 0.003 90)` | `#fbfaf7` | Page background (warm off-white) |
| `--bg-2` | `oklch(0.97 0.005 90)` | `#f5f3ef` | Subtle alt background (table headers, sidebar feed, ghost button hover) |
| `--surface` | `#ffffff` | `#ffffff` | Cards |
| `--ink` | `oklch(0.22 0.012 280)` | `#252735` | Primary text |
| `--ink-2` | `oklch(0.4 0.012 280)` | `#4d4f5e` | Secondary text (sidebar nav, table cells) |
| `--muted` | `oklch(0.55 0.012 280)` | `#727585` | Tertiary text (labels, subtitles) |
| `--faint` | `oklch(0.72 0.008 280)` | `#a1a3b0` | Faintest text (disabled, axis labels) |
| `--line` | `oklch(0.92 0.005 280)` | `#e6e7ed` | Hairline borders |
| `--line-2` | `oklch(0.95 0.004 280)` | `#eeeff3` | Even-fainter dividers (intra-table rows) |
| `--accent` | `oklch(0.55 0.14 282)` | `#7c5cff` | Primary accent (indigo-violet) |
| `--accent-soft` | `oklch(0.96 0.03 285)` | `#ece8fb` | Accent background (pills, hover, master row) |
| `--accent-ink` | `oklch(0.35 0.14 282)` | `#4631ac` | Accent text on soft backgrounds |
| `--positive` | `oklch(0.58 0.13 165)` | `#2c9a72` | Positive deltas, success states, "match" pill |
| `--positive-soft` | `oklch(0.95 0.04 165)` | `#dff2e7` | Positive pill background |
| `--negative` | `oklch(0.6 0.18 25)` | `#d04a2a` | Negative deltas |
| `--negative-soft` | `oklch(0.96 0.03 25)` | `#fae7df` | Negative pill background |
| `--warning` | `oklch(0.7 0.13 70)` | `#d29232` | Warning |
| `--warning-soft` | `oklch(0.96 0.04 80)` | `#f8e9c9` | Warning pill background |

**Token-asset colors (per-wallet identifiers).** Each wallet is assigned a palette deterministically via a stable hash of its id. The donut slices and avatar gradients use the second (darker) color in each pair as the solid identity color.

| # | Light | Dark (canonical) |
|---|---|---|
| 0 | `#a78bfa` | `#7c5cff` (violet — also the default accent) |
| 1 | `#6ee7b7` | `#34d399` (emerald) |
| 2 | `#fbbf24` | `#f59e0b` (amber) |
| 3 | `#f472b6` | `#ec4899` (pink) |
| 4 | `#60a5fa` | `#3b82f6` (blue) |

**Token-asset colors (per-token).**
- ETH (overview asset-mix donut, ETH dot in totals row): `oklch(0.55 0.16 285)` ≈ `#6a55ee` — uses the accent family
- USDT: `oklch(0.62 0.13 165)` ≈ `#3aa57f` — uses the positive family but slightly cooler

**Cover / hero gradient.** Used only on the cover page and the "Total Portfolio Value" hero card:
`linear-gradient(135deg, oklch(0.98 0.02 320), oklch(0.97 0.03 285))` — a near-white pink-into-lavender wash. The cover adds a third stop: `oklch(0.99 0.01 90)` (warm off-white) at 100%, gradient angle 160°.

A radial decoration sits over both: `radial-gradient(circle, oklch(0.85 0.1 285 / 0.25), transparent 60%)` — pinned top-right, oversized (220px on the hero card, 460px on the cover), positioned at `top: -40px / -120px, right: -40px / -120px`.

**Master account differentiation.** Master rows and cards add:
- Background: `linear-gradient(90deg, oklch(0.985 0.015 285), transparent 70%)` — a left-fading violet tint
- Left border: `3px solid var(--accent)` (or `3px solid transparent` on non-master rows to keep alignment)
- The master card outer wrapper uses `linear-gradient(180deg, oklch(0.99 0.01 285) 0%, var(--surface) 60%)` and a tinted border `1px solid oklch(0.9 0.04 285)`

### 2.2 Typography

**Two families only. No serif.** Loaded from Google Fonts.

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

- **Geist** (sans, variable) — body, headings, labels, navigation, UI chrome. Weights used: 400, 500, 600, 700.
  - Fallback stack: `ui-sans-serif, system-ui, sans-serif`
  - Feature settings: `font-feature-settings: "ss01", "cv11"`
- **Geist Mono** — every number, ticker, address, percentage, pill containing a value. Weights used: 400, 500, 600.
  - Fallback stack: `ui-monospace, monospace`
  - Feature settings: `font-feature-settings: "tnum", "zero"` (tabular numerals + slashed zero)
  - Always combined with `font-variant-numeric: tabular-nums`

**Type scale (pixel-exact from source).**

| Role | Size | Weight | Letter-spacing | Notes |
|---|---|---|---|---|
| Cover H1 ("Treasury Snapshot") | 56px | 600 | -1.4px | Two-line, `line-height: 1.05` |
| Page H1 (TopBar / PrintScreen) | 22–24px | 600 | -0.3px | 22 on screen, 24 on print |
| Cover stat value | 22px (mono) | 600 | -0.3px | |
| Hero portfolio value | 40px (mono) | 600 | -1px | `line-height: 1` |
| Master card "Net change" | 26px (mono) | 600 | -0.4px | |
| Master card collect/distribute | 22px (mono) | 600 | -0.3px | |
| Card stat value (ETH/USDT holdings) | 24px (mono) | 600 | — | |
| Section card body number | 17px (mono) | 600 | -0.2px | Used in PlanStep amount |
| Donut center label | 18px (mono) | 600 | — | Asset donuts |
| Donut center highlight % | 20px (mono) | 600 | — | When hovered |
| Donut center sub | 11px (sans) | 400 | — | |
| Donut center highlight wallet name | 10.5px (sans) | 500 | 0.2 | Uppercased |
| Card title | 13px | 600 | — | "Allocation", "Wallets", "Address book" |
| Card subtitle | 12px | 400 | — | One-line under card title, muted |
| Table th | 11px | 500 | 0.3px | UPPERCASE |
| Table td | 13px | 400–500 | — | Mono on numeric columns |
| Stat label (small caps) | 10.5px | 500 | 0.5px | UPPERCASE, muted — e.g. "TOTAL PORTFOLIO VALUE" |
| Stat label medium | 11.5px | 500 | 0.4px | UPPERCASE, muted — e.g. "ETH HOLDINGS" |
| Section header eyebrow (print) | 10.5px | 600 | 0.8px | accent-ink color, UPPERCASE — "01 · PORTFOLIO OVERVIEW" |
| Body / default | 14px (sans), 12.5px on print | 400 | — | `line-height: 1.5` |
| Pill | 11px | 500 | 0.1px | 2px·8px padding, `border-radius: 999px` |
| Smaller pill (★ MASTER inline) | 9.5–10px | 500 | 0.4 | UPPERCASE |
| Button sm | 12px | 500 | — | 26px height |
| Button md | 13px | 500 | — | 32px height |
| Button lg | 14px | 500 | — | 38px height |
| Sparkline / axis labels | 10–11px | 400 | — | `var(--faint)` |
| Sidebar nav item | 13px | 400 (500 if active) | — | |
| Address (truncated) | 12px (mono) | 400 | — | `var(--muted)` |

### 2.3 Spacing scale

Not a named token system — values used throughout are: **2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 48, 56**. Most commonly: `gap: 16` between cards in a row, `gap: 20` between sections vertically, `padding: 32` around screen content, `padding: 22` inside cards, `padding: 18px 22px` for card headers, `padding: 14px 16px` for table cells (toggleable via `--pad-row: 14px` / compact `10px`).

### 2.4 Borders & radii

- `--radius-card: 12px` — cards, allocation cards, master card
- `--radius-btn: 8px` — buttons (md, lg)
- Small button radius: `6px`
- `--radius-input: 7px` — inputs
- Pill / dot / status: `border-radius: 999px`
- Wallet avatar: `border-radius: 8px` (rounded square, 32px viewBox)
- Brand logo square: `border-radius: 8px` (sidebar) or `10px` (cover, 38px size)

Border widths are always **1px**, with one exception: the **3px** left accent stripe on the Master account row/card. Dashed borders (`1px dashed var(--line-2)`) separate intra-section rows when they're inside the same surface (e.g. table totals, paired stat columns).

### 2.5 Elevation

Only two shadow tokens, both extremely subtle:

```css
--shadow-sm: 0 1px 0 oklch(0.92 0.005 280 / 0.6),
             0 1px 2px oklch(0.5 0.01 280 / 0.04);
--shadow-md: 0 1px 0 oklch(0.92 0.005 280 / 0.6),
             0 4px 14px -6px oklch(0.5 0.01 280 / 0.08);
```

`--shadow-sm` is used on every card and on secondary buttons. `--shadow-md` is reserved (used on the sidebar brand square via a bespoke `0 2px 8px -2px oklch(0.5 0.16 285 / 0.4)` to give the violet logo a hint of glow).

The primary button has its own inner highlight + outer drop shadow: `0 1px 0 oklch(1 0 0 / 0.15) inset, 0 1px 1px oklch(0.3 0.1 285 / 0.15)`.

---

## 3. Layout Grid

**Application shell (screen).** Two columns: fixed-width sidebar (`240px`) + fluid main area. `min-width: 1240px` total — the design is desktop-first and does not collapse.

**Sidebar.** `240px` wide, `var(--bg)` background, `1px solid var(--line)` right border, `padding: 20px 14px`, sticky top, full viewport height. Vertical flex with `gap: 4px` between nav items; the FeedPanel pushes to the bottom with `margin-top: auto`.

**Main area.** Sticky top bar (`padding: 24px 32px 18px`, `1px solid var(--line)` bottom). Below it, content area uses `padding: 32px` and a vertical flex with `gap: 16–20px` between major sections.

**Print layout.** Sets `@page { size: 1280px 1800px; margin: 0 }`. Each `PrintScreen` is a `<section>` with `break-before: page`. Inside, the same components are reused at full width — no sidebar. The print header replaces the screen TopBar: `padding: 28px 32px 16px`, eyebrow label in accent-ink uppercase (`10.5px`, letter-spacing `0.8`) followed by H1 (`24px`, weight 600, letter-spacing -0.3) and an optional subtitle (`13px`, muted).

**Page-level grids inside cards.**

- Overview hero: `grid-template-columns: 1.4fr 1fr 1fr` (hero card wider than the two side stat cards), `gap: 16`
- Overview allocation row: `grid-template-columns: 1fr 1fr 1fr`, `gap: 16` (three equal donut cards)
- Master card body: `grid-template-columns: 1.3fr 1fr 1fr 1fr`, `gap: 24` (identity column slightly wider)
- PlanStep row: `grid-template-columns: 34px 1fr 30px 1fr 220px`, `gap: 16` (index badge, From block, arrow, To block, amount-block)
- Rebalance summary: `grid-template-columns: 1fr 1fr 1fr`, `gap: 24`
- Cover stat footer: `grid-template-columns: repeat(3, 1fr)`, `gap: 24`

**Section spacing.** Within a screen: `gap: 16` (Wallets, Targets, Rebalance) or `gap: 20` (Overview, which has more visual variety). Between TopBar and first section: `padding: 32` top.

**Vertical rhythm.** Card body padding: `padding: 22` for normal cards, `padding: 20` for tighter side stats, `padding: 24` for the hero card and master card sub-blocks. Card header padding: `18px 22px`. Card footer padding: `12px 24px`.

---

## 4. Recurring Patterns

### 4.1 Print section header

```html
<header style="padding: 28px 32px 16px; border-bottom: 1px solid var(--line); background: var(--bg);">
  <div style="font-size: 10.5px; letter-spacing: 0.8px; color: var(--accent-ink);
              font-weight: 600; text-transform: uppercase; margin-bottom: 6px;">
    01 · Portfolio Overview
  </div>
  <h1 style="margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.3px;">
    Portfolio Overview
  </h1>
  <div style="margin-top: 4px; font-size: 13px; color: var(--muted);">
    Halcyon Capital Fund I · Ethereum mainnet
  </div>
</header>
```

Eyebrow always: `01 · Portfolio Overview`, `02 · Wallets`, `03 · Target Allocations`, `04 · Rebalance Plan`. Two-digit zero-padded index, middle-dot separator (`·` U+00B7) with spaces around it.

### 4.2 Card

```html
<section class="card" style="
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
">
  <!-- content -->
</section>
```

Cards never have rounded internal sub-elements (e.g. table rows stretch fully edge-to-edge inside; the card's border-radius clips them via `overflow: hidden` when needed).

### 4.3 Stat card (label + value + sub-value)

Three variants:

**A. Hero (gradient).** Used only for "Total Portfolio Value." `padding: 24`, gradient background, decorative radial corner glow, label in 5px-dot prefix + 12px uppercase muted, value in 40px mono, subtitle "5 wallets · last sync 12s ago" in 12px muted.

**B. Side stat (ETH / USDT).** Used twice on Overview header. `padding: 20`. Label `11.5px / 0.4 letterspacing / muted / uppercase`, value `24px mono 600`, with the unit ticker in `12px muted 500` immediately after the number with `margin-left: 4`. Below: USD compact value in `12px mono muted`.

**C. Summary stat (Rebalance page).** `SummaryStat` component. Label `10.5px / 0.5 letterspacing / muted / uppercase / weight 500`, value `22px mono 600 -0.3 letterspacing` with 4px top margin, sub `11.5px faint` with 2px top margin. Three of these sit in a row inside the Rebalance summary card.

**D. Cover stat.** Like C but tighter: label `10.5 / 0.5 / muted / 500`, value `22px mono 600 -0.3`. No sub.

### 4.4 Wallet row (table version, Overview)

Six columns: Wallet (left-aligned), ETH, USDT, Value, % of book (mini bar + %), `⋯` overflow menu.

- Wallet column: wallet avatar (28px rounded square gradient), then a two-line block — label in `13px 500` plus the `★ Master` pill inline if applicable; below, the truncated address (`12px mono muted`) in a copy-button (`AddressDisplay`).
- Numeric columns: right-aligned, `13px mono`, with weight 500 on the bold "Value" column.
- % of book column: 60×4 progress bar (`var(--bg-2)` track, `var(--accent)` fill, `border-radius: 2px`) followed by `pct.toFixed(1) + '%'` in `12px mono muted`, `min-width: 36px` to align.
- Overflow column: a 16px `⋯` icon button, `var(--faint)`, 4px padding, no border.
- Row vertical padding: `var(--pad-row) 16px` (= `14px` comfortable, `10px` compact). Row dividers: `1px solid var(--line-2)` (not the heavier `--line`).
- Hover state: row background `var(--bg-2)`; if a wallet is hovered in the table or in any of the three donut legends, all other rows fade to `opacity: 0.45` and the matching slice in the two distribution donuts thickens (+4px) while the others drop to `opacity: 0.18`.

### 4.5 Wallet row (Wallets screen, address-book layout)

Different layout — block-level rows (not a table) with `padding: 16px 22px`, `display: grid; grid-template-columns: 1fr auto; gap: 16`:

- Left block: 36px avatar, label `14px 500`, optional `★ Master` accent pill, address row with optional `· note` after.
- Right block: ETH/USDT mini-stack, USD balance ("$X.XXM" + "balance" muted), then a button cluster.

### 4.6 ★ MASTER badge treatment

Three sizes used throughout:

- **Page-level (Master Card eyebrow):** Pill, accent tone, `padding: 2px 8px`, `font-size: 10.5px`, `letter-spacing: 0.5px`, UPPERCASE. Contains the typographic star "★" inside a hand-drawn SVG laurel/crown 10×10 followed by the text "Rebalance Overview" (formerly "Master Account").
- **Row-level (in tables):** Pill, accent tone, `font-size: 9.5–10px`, `padding: 1px 6px`, `letter-spacing: 0.4`, UPPERCASE. Text: `★ Master` or `★ MASTER`.
- **Master row container:** `border-left: 3px solid var(--accent)`, `background: linear-gradient(90deg, oklch(0.985 0.015 285), transparent 70%)`. Non-master rows get `border-left: 3px solid transparent` to keep alignment.

### 4.7 Donut chart

- Default size: 160px diameter, stroke thickness 20px, displayed in a 160×160 SVG with `overflow: visible`.
- Background track: full circle stroke `var(--line-2)` at the same thickness.
- Slices: ordered by value descending. Start at -90° (top). Each slice rendered as an SVG arc path with `stroke-linecap: butt`, no gap between slices.
- Default center: line 1 in `Geist Mono 18px 600` (e.g. `$2.50M`), line 2 in `Geist 11px` muted (e.g. `total`).
- Highlight state (on hover of any legend row or paired table row): hovered slice goes to `thickness + 4` and other slices fade to `opacity: 0.18`. The center text swaps to two new lines: percent in `Geist Mono 20px 600` (e.g. `28.6%`) and the wallet label uppercased in the slice's color in `Geist 10.5px 500 letter-spacing 0.2`.

**Legend layout** (rendered inside `AllocationCard`):

```
[10×10 swatch]  Wallet label              pct%   123.45 ETH
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

Grid: `10px minmax(0, 1fr) auto auto`, `gap: 10`, `padding: 7px 0`. Dashed `var(--line-2)` divider between rows. Swatch is a 10×10 rounded `border-radius: 3` square in the slice color; on hit, gains a `box-shadow: 0 0 0 3px ${color}33` (20%-alpha) halo.

### 4.8 Data table

- Header `<tr>`: background `var(--bg-2)`, top + bottom `1px solid var(--line)`, `th` style `padding: 8–10px 14–16px`, `font-size: 11px`, `font-weight: 500`, `letter-spacing: 0.3–0.4px`, UPPERCASE, color `var(--muted)`.
- Body rows divided by `1px solid var(--line-2)`; final row drops the divider.
- Number columns are right-aligned and use Geist Mono with `font-variant-numeric: tabular-nums`. The "Value" column is `font-weight: 500`; raw token amounts are `400`.
- A dashed vertical divider (`border-left: 1px dashed var(--line)`) splits the ETH-side from the USDT-side in the Targets table — separating two parallel column groups (Current / Target / Δ for each token).

### 4.9 Transaction card (PlanStep)

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌──┐                                                                │
│  │ 1│   [avatar]  FROM                →   [avatar]  TO        12.50 ETH │
│  └──┘            Strategic Reserve         Master Account    ≈ $40.0K │
│                  0xaB12…3e9                0x00C0…e7Aa  ⛽ 21,000 gas · $1.48 │
└──────────────────────────────────────────────────────────────────────┘
```

Grid columns: `34px 1fr 30px 1fr 220px`, `gap: 16`, vertical padding `18px 22px`, top divider `1px solid var(--line-2)`.

- **Index badge**: 28×28 mono pill, `border-radius: 999`, `background: var(--bg-2)`, `color: var(--muted)`, `1px solid var(--line)`, value in `12px 600`.
- **From / To blocks**: 32px avatar + 3-line stack — eyebrow `FROM` / `TO` in `11px muted letter-spacing 0.3`, label `13.5px 500`, address copy-button below.
- **Arrow column**: just the `arrowR` icon SVG, `var(--faint)`.
- **Amount block** (right-aligned):
  - Line 1: `17px mono 600 -0.2 letterspacing`, with the token ticker (ETH/USDT) in `12px muted 500` 4px after the number.
  - Line 2: `≈ $X.XK/M` in `12px mono muted` (2px gap).
  - Line 3 (gas): pump icon (13×13) + `21,000 gas · $1.48` in `11.5px mono faint` (6px gap above).

### 4.10 Phase break header (inside Transaction path card)

When the phase or token changes between consecutive plan steps:

```html
<div style="padding: 8px 22px; background: var(--bg-2);
            border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
            font-size: 10.5px; letter-spacing: 0.5px; color: var(--muted);
            font-weight: 500; display: flex; align-items: center; gap: 8px;">
  <span style="width: 5px; height: 5px; border-radius: 999px;
               background: var(--positive); /* or var(--accent) for distribute */"></span>
  ETH · COLLECT INTO MASTER
</div>
```

Two possible labels:
- `${token} · COLLECT INTO MASTER` — green dot, `var(--positive)`
- `${token} · DISTRIBUTE FROM MASTER` — violet dot, `var(--accent)`

### 4.11 Hub / Master card (the 6-block panel on Rebalance)

Container: `Card` with override `padding: 0; background: linear-gradient(180deg, oklch(0.99 0.01 285) 0%, var(--surface) 60%); border: 1px solid oklch(0.9 0.04 285)`.

Inner: `padding: 20px 24px; display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 24; align-items: stretch`.

Four columns:

1. **Master identity.** Eyebrow pill ("Rebalance Overview", accent), 40px avatar + label/address, descriptive line ("Hub wallet — absorbs surplus from 4 sub-wallets …"), and a text-button link in `var(--accent-ink)` "Change master account →" pinned to bottom. Right edge: `1px dashed var(--line)`.
2. **Net change.** Label "NET CHANGE", big signed compact USD in `26px mono 600` colored green/red, then two `BalanceDelta` rows for ETH and USDT (see 4.12).
3. **Collects from sub-wallets.** Label with green ↓ arrow prefix + "COLLECTS FROM SUB-WALLETS", value `22px mono 600` in `var(--positive)`, then ETH in / USDT in lines.
4. **Covers sub-wallet deficits.** Mirror of column 3 with violet ↑ arrow prefix + "COVERS SUB-WALLET DEFICITS", value in `var(--accent-ink)`, ETH out / USDT out lines.

All four columns: 4–10px gap between elements; label rows are 10.5px / 0.5 letterspacing / 500 / muted / UPPERCASE.

### 4.12 BalanceDelta row (before → after with strike-through)

```
ETH    500   →   460        −40
USDT   ̶2̶,̶0̶0̶0̶,̶0̶0̶0̶  →  2,050,000    +50,000
```

```html
<div style="display: flex; align-items: center; gap: 6;">
  <span style="color: var(--muted); min-width: 36;">ETH</span>
  <span class="mono" style="color: var(--faint); text-decoration: line-through; font-size: 11;">500</span>
  <span style="color: var(--faint); font-size: 11;">→</span>
  <span class="mono" style="font-weight: 600; color: var(--ink);">460</span>
  <span class="mono" style="margin-left: auto; font-weight: 500; font-size: 11;
                            color: var(--negative); /* or var(--positive) */">
    −40
  </span>
</div>
```

If `|delta| < 0.001` (no change), only the current value renders, right-aligned in `font-weight: 500`.

### 4.13 Status badges (pills)

`Pill` component, five tones — each has a background, foreground, and optional border color:

| Tone | Background | Foreground | Border | Used for |
|---|---|---|---|---|
| neutral | `var(--bg-2)` | `var(--ink-2)` | `var(--line)` | Default chips, generic markers |
| accent | `var(--accent-soft)` | `var(--accent-ink)` | transparent | ★ Master, "→ Master" totals, hub eyebrow, positive ETH delta in target rows |
| positive | `var(--positive-soft)` | `var(--positive)` | transparent | "match", "Net flat", "All targets met", "← Master surplus" |
| negative | `var(--negative-soft)` | `var(--negative)` | transparent | Reserved (currently unused on shipped screens) |
| warning | `var(--warning-soft)` | `oklch(0.5 0.13 60)` | transparent | Reserved |

All pills: `display: inline-flex; align-items: center; gap: 4; padding: 2px 8px; border-radius: 999; font-size: 11; font-weight: 500; letter-spacing: 0.1`.

`DeltaPill` (target rows): wraps absolute amount with up/down arrow icon — `accent` tone for positive, `neutral` for negative. Below threshold (≈0): replaced with a single `—` em-dash in `12px faint`.

---

## 5. Page-by-Page Breakdown

### Page 1 — Cover (`PrintCover`)

Full-bleed page, `min-height: 100vh`, `padding: 56`, gradient `linear-gradient(160deg, oklch(0.98 0.02 320), oklch(0.97 0.04 285) 60%, oklch(0.99 0.01 90))`. A 460px radial pink-violet glow sits at `top: -120; right: -120` with 40% alpha at center.

Vertical layout (flex column):

- **Top: brand lockup.** 38px violet-gradient square ("L"), to its right two stacked lines: "Ledgerline" (`16px 600`) and "Treasury Report" (`12px muted`).
- **Bottom-anchored: title block.** Eyebrow "HALCYON CAPITAL · FUND I" (`11.5px 500 0.6 letterspacing muted UPPERCASE`), then H1 two-line "Treasury / Snapshot" (`56px 600 -1.4 letterspacing 1.05 line-height`), then a 14px muted body line: "Portfolio overview, wallet ledger, target allocations and rebalance plan — captured on {date}." (max-width 540px, line-height 1.55).
- **Footer: three-stat row.** `padding-top: 24; border-top: 1px solid oklch(0.85 0.04 285 / 0.5); grid-template-columns: repeat(3, 1fr); gap: 24`. Stats: "As of", "Wallets tracked", "Total book value" — each label uppercase 10.5px muted, value 22px mono 600.

Hierarchy: eye lands on H1 first (largest type, dark on light), brand reads as a calmly anchored mark, footer answers "when, how many, how big" without competing.

### Page 2 — Portfolio Overview

Vertical stack, `padding: 32; gap: 20`:

1. **Hero stat row** — three-card grid `1.4fr 1fr 1fr`. Hero card (gradient bg, radial glow) shows `TOTAL PORTFOLIO VALUE` label + `$X,XXX,XXX` (40px mono) + "5 wallets · last sync 12s ago". The two side cards: `ETH HOLDINGS` (token amount in mono + USD compact below) and `USDT RESERVES` (same).
2. **Allocation row** — three-card grid `1fr 1fr 1fr`, each card containing a 160px donut + 18px gap + legend list:
   - **Allocation** — Portfolio mix by asset (2 slices: ETH violet, USDT teal), center `$X.XXM / total`.
   - **ETH distribution** — Across 5 wallets (5 slices, each in the deterministic wallet color), center `XXX.XX / ETH total`.
   - **USDT distribution** — Across 5 wallets (5 slices), center `$X.XXM / USDT total`.
3. **Wallets table** — `Wallets · master account + 4 sub-wallets` subtitle. Six columns: Wallet, ETH, USDT, Value, % of book, ⋯. Master row first, then sub-wallets in their declared order.

Visual hierarchy: hero left, then the eye moves right through the side stats; allocation row reads left → right at equal weight; table is the dense reference grid beneath.

### Page 3 — Wallets (address book)

Single card, no inner grid:

- **Header strip:** Title "Address book" (`13px 600`), subtitle "Label and track Ethereum addresses for this workspace" (`12px muted`), and a primary `Add wallet` button (gradient violet, plus icon) on the right.
- **Add-wallet form** (only visible when adding): `padding: 18px 22px; background: var(--bg-2)`. Top row: grid `1fr 2fr` — LABEL input + ETHEREUM ADDRESS input (mono). Below: NOTE (OPTIONAL) input full-width. Bottom: ghost `Cancel` + primary `Save wallet`, right-aligned.
- **Wallet rows** — block layout, master pinned first with violet wash and accent left-border. Each row: 36px avatar, label + `★ Master` pill (if applicable), address copy-button + note inline. Right cluster: ETH/USDT mini-stack, USD balance + "balance" label, button cluster — `★ Set as master` (if not master, accent-ink ghost), `Edit`, `Remove` (if not master).

Hierarchy: title left, primary action far right; rows are equal-weight cards.

### Page 4 — Target Allocations

1. **Summary card** — header strip "Target allocations / Set absolute holdings for each sub-wallet…" + right-aligned `★ Hub: Master Account` pill. Below: two-column row (`1fr 1fr` divided by dashed border) — `TokenTotalRow` for ETH then USDT.
   - Each `TokenTotalRow`: ETH/USDT swatch + ticker on left, then 3 right-aligned blocks: `SUB-WALLETS NOW`, `TARGET`, plus a status pill: "→ Master +X ETH" (positive flow into master, green), "← Master -X ETH" (master needs to fund, accent), or "✓ Net flat" (positive).
2. **Targets table** — seven columns: Wallet | Current ETH | Target ETH | Δ ETH || Current USDT | Target USDT | Δ USDT. A dashed border at column 4/5 visually splits the two token panels.
   - Master row sits at the top with violet tint, left-border accent, `★ MASTER` pill. Target columns show `residual` in italic faint instead of an input. Δ columns show the actual delta from the plan + `→ XXX proj` projected value beneath in faint.
   - Sub-wallet rows: `Current` in muted mono, `Target` is an editable `Input` (mono, ticker suffix, right-aligned text, 130–160px wide), `Δ` is a `DeltaPill` (accent for positive, neutral for negative, em-dash for zero).

Hierarchy: summary banner at top establishes the macro picture (does sub-wallet supply meet sub-wallet demand?), table below is row-level edit.

### Page 5 — Rebalance Plan

1. **Master / Hub card** at top — see 4.11. This is the visual centerpiece of the page.
2. **Summary card** — three SummaryStat columns: TRANSACTIONS / NOTIONAL MOVED / EST. GAS.
3. **Transaction path card** — header strip with title and `Export CSV` + `Simulate` buttons (right). Body is an ordered list of `PlanStep` rows, grouped by phase-token combination via the phase-break header (4.10). Plan order: ETH collects → ETH distributes → USDT collects → USDT distributes.
4. **Post-rebalance check** (technically page 5/6 in PDF, but the same card flows continuously) — `padding: 18px 22px` card. Header: "Post-rebalance check / Projected balances after every step executes." + right-aligned positive `✓ All targets met` pill. Table: Wallet | ETH (proj) | vs target | USDT (proj) | vs target | Value. Master row's "vs target" cells say `residual` (italic faint); sub-wallet rows show a positive `✓ match` pill.

Hierarchy: master card establishes the plan's macro shape, summary stats quantify, the step list lets you trace each move, the post-check confirms convergence.

### Page 6 — Post-rebalance check (overflow)

Continues the table from page 5. No new component types.

---

## 6. Number & Address Formatting Rules

All numeric formatting uses `Intl.NumberFormat('en-US')` via `toLocaleString`. All numeric output is set in Geist Mono with `font-variant-numeric: tabular-nums` for column alignment.

### ETH
`n.toLocaleString('en-US', { maximumFractionDigits: 4 })`
- Examples: `500`, `12.5`, `0.0021`
- No trailing zeros, comma group separator at thousands.

### USDT
`n.toLocaleString('en-US', { maximumFractionDigits: 0 })`
- Examples: `2,000,000`, `100,000`, `350,000`
- Whole numbers only, comma separators.

### USD — full
`$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })` with `dp = 0` (default) or `2`.
- Examples: `$3,200`, `$1.48`, `$3,840,000`.

### USD — compact (used in stat values, donut centers, plan amounts)
- `|n| ≥ 1,000,000` → `'$' + (n/1e6).toFixed(2) + 'M'` → `$3.20M`, `$1.75M`
- `|n| ≥ 1,000` → `'$' + (n/1e3).toFixed(1) + 'K'` → `$178.0K`, `$40.0K`
- else → `'$' + n.toFixed(0)` → `$42`

### Percent
`pct.toFixed(1) + '%'` → `42.3%`, `100.0%`. Always one decimal.

### Address truncation
`a.slice(0, 6) + '…' + a.slice(-4)` → `0x00C0…e7Aa`. The horizontal ellipsis character U+2026 (`…`), not three dots.

### Delta / change formatting
- Negative: ASCII minus is **not** used; the source uses the Unicode minus `−` (U+2212) only in the Master Card distribute column (`−$X.XK`). In `BalanceDelta`, JS subtraction yields a natural negative number which is just stringified — so the row reads `-40` (ASCII hyphen). The `+` for positives is prepended explicitly.
- Sign is followed immediately by the magnitude with no space: `+40`, `−$1.20M`.
- Color: positive → `var(--positive)`, negative → `var(--negative)` (or `var(--accent-ink)` for master-distribute outflows specifically, treating outflow as accent rather than alarming red).

### Gas
- Units: `gasUnits.toLocaleString()` → `21,000`, `65,000`
- ETH amount: `gasEth.toFixed(5)` → `0.00046`
- USD: `fmtUSD(gasEth * ethPrice, 2)` → `$1.48`
- Display string: `21,000 gas · $1.48` (gas units / middle-dot / USD)
- Pump icon (`I.gas`) prefixes the row.
- Gas-price basis is hard-coded to **22 gwei**. Per-step gas units: 21,000 for ETH transfers, 65,000 for USDT (ERC-20) transfers.

### Date / time
- Cover date: `new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })` → `May 21, 2026`
- Sidebar "Synced HH:MM:SS": zero-padded 24-hour, updated every 12 seconds. The trailing "auto-refresh 12s" was removed earlier per a comment.

---

## 7. Color Semantics

### Accent (violet `#7c5cff` family)
The brand color and the **Master account** color. Used for:
- The brand logo and any active state in the nav
- The Master account row stripe, badge, card border, and identity pill
- Active-row hover background
- Donut slice color for **ETH** in the portfolio mix donut (this overlaps with the master color, which is intentional — ETH and the master account are the two "primary" entities)
- The "Distribute from Master" phase indicator dot and the "covers sub-wallet deficits" outflow column header arrow
- Tertiary primary buttons ("Add wallet", "Save wallet", "Export to PDF", "Generate plan", "Rebalance")

### ETH vs USDT
- ETH: violet `oklch(0.55 0.16 285)` ≈ `#6a55ee`
- USDT: teal `oklch(0.62 0.13 165)` ≈ `#3aa57f`

These two only appear together in the **asset-mix donut and its legend**. In every other context (allocation by wallet, target table, plan), tokens are distinguished by ticker label, not by color — the columns are explicitly labeled `ETH` / `USDT`, so we don't need color to disambiguate.

### Positive vs negative
- **Positive change / surplus / convergence / status-OK** → `var(--positive)` (green `#2c9a72`). Used for: "match" pill, "All targets met", "Net flat", "Collects from sub-wallets" headline value, positive deltas in BalanceDelta and master target rows.
- **Negative change** → `var(--negative)` (red-orange `#d04a2a`). Used for: negative `BalanceDelta` magnitudes and the master card net-change value when projection is below current. The negative pill tone exists but is not currently used.
- **Outflow from master** is colored as accent (`var(--accent-ink)`) rather than negative, because deploying capital to sub-wallets is operationally neutral, not adverse.

### Master wallet visual differentiation (summary)
1. ★ Master pill, accent tone, always inline with the wallet label
2. Violet `linear-gradient(90deg, …)` row background (90% transparent on the right)
3. 3px accent left border
4. Master ID color in the wallet color hash falls on the violet palette in the seed data — visually reinforcing the accent association
5. In all balance tables, the master sits **first** (sub-wallets ordered after)
6. In target tables, master's "Target" column reads `residual` in italic faint — it can't be set, only derived

---

## 8. Interaction Hints (visible chrome)

Application chrome (top bars and inline buttons):

| Button | Tier | Style | Where |
|---|---|---|---|
| Refresh balances | secondary (sm) | white surface, 1px border, soft shadow | Overview TopBar |
| Export to PDF | primary (sm) | violet gradient `linear-gradient(180deg, oklch(0.6 0.16 285), oklch(0.5 0.16 285))`, white text, 1px accent-deep border, inner highlight | Overview TopBar |
| Reset | ghost (sm) | transparent, ink-2 text | Targets TopBar |
| Generate plan → | primary (sm) | violet gradient + arrow icon | Targets TopBar |
| ← Edit targets | ghost (sm) | transparent, ink-2 text | Rebalance TopBar |
| PDF | secondary (sm) | white surface, 1px border | Rebalance TopBar |
| Add wallet | primary (md) | violet gradient + plus icon | Wallets header |
| Save wallet | primary (md) | violet gradient | Wallets add-form footer |
| Cancel | ghost (md) | transparent | Wallets add-form footer |
| ★ Set as master | ghost (sm) | accent-ink colored text | Each non-master wallet row |
| Edit | ghost (sm) | edit icon + label | Each wallet row |
| Remove | ghost (sm) | trash icon + label, muted text | Each non-master wallet row |
| Export CSV | ghost (sm) | transparent text | Transaction path header |
| Simulate | secondary (sm) | white surface | Transaction path header |
| Change master account → | text-button | accent-ink, no chrome, arrow suffix | Master card identity column |
| AddressDisplay (each address) | inline tap | transparent → `var(--bg-2)` on hover; toggles to `✓` check icon on copy for 1.2s | Anywhere an address appears |
| ⋯ (overflow per wallet) | icon button | transparent, faint dot dot dot | Overview table row tail |

**Button styles per tier** (from the `Btn` component):
- **primary** — `background: linear-gradient(180deg, oklch(0.6 0.16 285), oklch(0.5 0.16 285))`, `color: white`, `border: 1px solid oklch(0.46 0.16 285)`, `box-shadow: 0 1px 0 oklch(1 0 0 / 0.15) inset, 0 1px 1px oklch(0.3 0.1 285 / 0.15)`
- **secondary** — `background: var(--surface)`, `color: var(--ink)`, `border: 1px solid var(--line)`, `box-shadow: var(--shadow-sm)`
- **ghost** — fully transparent, `color: var(--ink-2)`, no border, no shadow
- **danger** — `var(--surface)` background, `var(--negative)` text, `1px solid var(--line)` border (reserved; not used in current screens)

**Sizes:**
- sm — 26px height, `padding: 4px 10px`, `font-size: 12px`, `border-radius: 6px`
- md — 32px height, `padding: 6px 12px`, `font-size: 13px`, `border-radius: 8px`
- lg — 38px height, `padding: 8px 16px`, `font-size: 14px`, `border-radius: 8px`

**Hover/active states implied:**
- Nav items: background fades to `var(--bg-2)` on hover (only if not active and not disabled). Active state: `var(--accent-soft)` background, `var(--accent-ink)` text, weight 500 (vs. 400). Icon color also shifts to `var(--accent-ink)`.
- AddressDisplay: background → `var(--bg-2)` on hover; ✓ briefly displaces the copy icon on click (1.2s revert).
- Donut + legend + wallet table: hovering any of the three surfaces a wallet is in, highlights it across all three (donuts thicken, legend swatch gains a 3px halo, table row goes accent-tinted, all others fade to 0.45 / 0.38 / 0.18).
- Inputs: no visible hover state beyond the focus ring (default browser).

---

## 9. Responsive / Adaptive Notes

**Viewport assumption.** Desktop-first. The HTML `<meta name="viewport" content="width=1280">` and the application shell's `min-width: 1240px` make explicit that this design is not responsive. Below ~1240px the layout horizontally scrolls; it does not reflow or stack.

**Print viewport.** Page size is hard-set to `1280px × 1800px`, margin 0. The four content pages plus cover are rendered at the same density as the screen — print is essentially the desktop layout sliced into 1800px-tall pages, minus the sidebar.

**Elements that would need to stack on narrow screens** (if a future mobile pass were done):
- The Overview hero row (`1.4fr 1fr 1fr`) → stack to single column
- The three-card allocation row → stack
- Master card four-column grid → wrap to 2×2
- PlanStep five-column grid → re-layout as a vertical stack with From + arrow + To stacked left and the amount block flowing beneath
- Targets table seven-column structure → keep table but enable horizontal scroll, or collapse to per-wallet cards

**Density.** Two modes via `data-density="comfortable"` (default) or `data-density="compact"` on the root, toggled in the Tweaks panel. Only affects `--pad-row` (`14px` ↔ `10px`) — i.e. table cell vertical padding. The Tweaks panel is hidden in print.

---

## 10. What Makes This Design Distinctive

### Five defining choices

1. **OKLCH everywhere.** Every color is expressed in OKLCH, which keeps the off-white background, the violet accent, and the neutral text in the same lightness band. The result reads as "warm calm document" rather than the bluish glow you get from sRGB-mixed light-mode UI.
2. **Two-family typography, mono-everything-numeric.** Geist Sans + Geist Mono. The strict rule "every number is mono, tabular, sometimes hairline-bolder than the surrounding sans" creates an instantly recognizable rhythm. Number columns align perfectly without explicit `text-align` math.
3. **The Master account as a first-class visual entity.** A 3px left accent stripe, a 90° fading violet wash, a unique pill, a unique row position (always first), and an exclusive page-top hero card on Rebalance. The eye learns the Master pattern in the first 30 seconds and never confuses it with a sub-wallet thereafter.
4. **Strike-through `before → after` for deltas.** Instead of "Δ + value", the design shows the literal transition: `̶5̶0̶0̶ → 460   −40`. Reads like a corrected ledger entry. This was the user's explicit ask and gives the Rebalance card its character.
5. **One decorative element, used twice.** A single 220px / 460px radial violet glow appears on the hero card and the cover page — nowhere else. Every other surface is flat. This restraint makes the gradient land as a deliberate gesture, not a default.

### Pitfalls to avoid when reimplementing

- **Don't add a sparkline back.** Earlier iterations had sparklines on every stat card; they got removed because "last 30 days of what?" wasn't answerable in context. The design is now strictly snapshot-in-time. Avoid the temptation to add motion.
- **Don't introduce a third color family.** The accent is violet, period. If you need a second emphasis color, use `var(--accent-ink)` (darker violet) — don't reach for blue or orange.
- **Don't switch ETH/USDT to two new colors per chart.** They're token-color-coded once (in the asset-mix donut) and label-coded everywhere else. Adding ETH/USDT colors to the target table or plan steps would create competing visual coding against the per-wallet color hash.
- **Don't lose the warm-white background.** A pure `#ffffff` or `#fafafa` page bg breaks the editorial mood. The warmth (hue 90 in OKLCH) is critical — it pairs with the violet accent to feel "soft prosumer" rather than "fintech terminal".
- **Don't use shadows beyond `--shadow-sm`.** The whole design lives in a 1px elevation world. Bumping any card to `box-shadow: 0 8px 24px` makes the design feel like a generic SaaS dashboard.
- **Don't fill the design with iconography.** Icons are used sparingly: nav items (always paired with a label), copy/edit/trash on inline actions, ↑/↓ arrows in pills, and the gas pump. No icons for the sake of decoration. The 5px colored dot is the design's preferred "icon" for status markers.
- **Don't right-align labels.** Labels are always left-aligned (or naturally inline with text). Only numeric values are right-aligned, and only inside table columns or stat cards. Mixing the two creates the financial-statement feel; collapsing them breaks it.
- **Keep the master account at row 0, always.** Sorting the wallets table by Value would move the master and destroy the hierarchy. The master is pinned; sub-wallet ordering is separate.
- **Match the Unicode punctuation.** Middle dot (`·` U+00B7) as separator, em-dash (`—`) for sentence breaks, horizontal ellipsis (`…` U+2026) for address truncation, true minus (`−` U+2212) in compact USD outflows. Plain ASCII versions look wrong next to the mono numerics.
- **Don't add background pattern, grain, or noise.** The off-white is flat. Texture in this context immediately moves the design toward "indie crypto wallet" and away from "treasury report".

---

## Appendix A — File Layout

The reference implementation lives in a single React file:

```
Crypto Treasury.html          → entry HTML, CSS variables, font imports, root mount
app.jsx                       → all components (Babel-transformed inline)
tweaks-panel.jsx              → the Tweaks panel (hidden in print)
Crypto Treasury-print.html    → print-mode entry; sets window.__PRINT__ = true
                                and auto-fires window.print() once fonts and React mount
```

Print mode is selected by either `?print=1` in the URL or `window.__PRINT__ === true` set before the React app boots. In print mode the sidebar is omitted, all four screens render stacked with `break-before: page`, and the cover is prepended.

## Appendix B — Token Snippet (drop-in CSS)

```css
:root {
  --bg: oklch(0.985 0.003 90);
  --bg-2: oklch(0.97 0.005 90);
  --surface: #ffffff;
  --ink: oklch(0.22 0.012 280);
  --ink-2: oklch(0.4 0.012 280);
  --muted: oklch(0.55 0.012 280);
  --faint: oklch(0.72 0.008 280);
  --line: oklch(0.92 0.005 280);
  --line-2: oklch(0.95 0.004 280);
  --accent: oklch(0.55 0.14 282);
  --accent-soft: oklch(0.96 0.03 285);
  --accent-ink: oklch(0.35 0.14 282);
  --positive: oklch(0.58 0.13 165);
  --positive-soft: oklch(0.95 0.04 165);
  --negative: oklch(0.6 0.18 25);
  --negative-soft: oklch(0.96 0.03 25);
  --warning: oklch(0.7 0.13 70);
  --warning-soft: oklch(0.96 0.04 80);
  --shadow-sm: 0 1px 0 oklch(0.92 0.005 280 / 0.6),
               0 1px 2px oklch(0.5 0.01 280 / 0.04);
  --shadow-md: 0 1px 0 oklch(0.92 0.005 280 / 0.6),
               0 4px 14px -6px oklch(0.5 0.01 280 / 0.08);
  --radius-card: 12px;
  --radius-btn: 8px;
  --radius-input: 7px;
  --pad-row: 14px;
}
[data-density="compact"] { --pad-row: 10px; }

html, body { background: var(--bg); color: var(--ink); }
body {
  font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "ss01", "cv11";
}
.mono {
  font-family: 'Geist Mono', ui-monospace, monospace;
  font-feature-settings: "tnum", "zero";
  font-variant-numeric: tabular-nums;
}
::selection { background: var(--accent-soft); }
```
