// ── app.js ────────────────────────────────────────────────
// CryptoTreasury — Frontend Logic
// ─────────────────────────────────────────────────────────

let loadedWallets  = [];
let lastPoolConfig = [];   // wallet config captured before each /api/pool call
let lastPoolResult = null; // response from /api/pool

// ── Master wallet state (Phase 4 fix) ────────────────────────
let _masterLabel   = '';
let _masterAddress = '';
let _masterDesc    = '';
// ── /Master wallet state ──────────────────────────────────────

// Chart palette — muted, professional; blues/indigo primary family
// Ledgerline deterministic wallet palette — Phase 2F
// Mirrors --wallet-N-dark CSS variables from Phase 0.
const CHART_COLORS = [
    '#7c5cff',  // slot 0 — violet
    '#34d399',  // slot 1 — emerald
    '#f59e0b',  // slot 2 — amber
    '#ec4899',  // slot 3 — pink
    '#3b82f6',  // slot 4 — blue
];

// Master wallet — violet (slot 0, matches --wallet-0-dark)
const MASTER_CHART_COLOR = '#7c5cff';

// ── Phase 3C-Hover-Fix: Shared chart highlight state ─────────
let _activeHoverAddress = null;

function _highlightAddress(address) {
  _activeHoverAddress = address;

  // Highlight all chart slices across all 6 charts
  document.querySelectorAll('.chart-slice').forEach(p => {
    p.style.opacity = p.dataset.address === address
      ? '1' : '0.18';
  });

  // Highlight matching table rows, fade others
  document.querySelectorAll('.wt-row').forEach(el => {
    el.style.opacity = el.dataset.address === address
      ? '1' : '0.25';
  });
}

function _clearHighlight() {
  _activeHoverAddress = null;
  document.querySelectorAll('.chart-slice').forEach(p => {
    p.style.opacity = '';
  });
  document.querySelectorAll('.wt-row').forEach(el => {
    el.style.opacity = '';
  });
}
// ── /Phase 3C-Hover-Fix ───────────────────────────────────────

// ── Pricing & Metrics ─────────────────────────────────────
//
let ethUsdPrice      = null;
let usdtUsdPrice     = null;   // live market rate; falls back to 1.0 if unavailable
let pricesFetchedAt  = null;   // Date of last successful token-price fetch
let gasPriceGwei      = null;  // effective gas price in Gwei (base + tip, set when Run Pool fires)
let gasPriceFetchedAt = null;  // Date of last successful gas-price fetch
let planGeneratedAt   = null;  // Date when the last /api/pool plan was computed
let planStalenessInterval = null; // setInterval handle for plan-age staleness ticker
// Fallback effective gas price (Gwei) — base + tip — used when Etherscan is unavailable.
// Mirrors the server-side formula: base ~0.5 Gwei + tip min(0.5, 1) = 1 Gwei effective.
const GAS_PRICE_FALLBACK_GWEI = 1;

// ═══════════════════════════════════════════════════════════
// LEDGERLINE — Phase 1B: Tab navigation + sidebar feed
// Tab-panel elements do not exist yet (added in Phase 1C).
// Class toggles on missing elements are safe no-ops.
// ═══════════════════════════════════════════════════════════

const TAB_IDS = ['overview', 'wallets', 'targets', 'rebalance'];
const ACTIVE_TAB_KEY = 'ct_active_tab';

function activateTab(tabId) {
  if (!TAB_IDS.includes(tabId)) return;
  TAB_IDS.forEach(id => {
    const panel = document.getElementById(`tab-${id}`);
    const navBtn = document.querySelector(
      `.sidebar-nav-item[data-tab="${id}"]`
    );
    if (panel) panel.classList.toggle('is-active', id === tabId);
    if (navBtn) {
      navBtn.classList.toggle('is-active', id === tabId);
      navBtn.setAttribute('aria-selected', id === tabId ? 'true' : 'false');
    }
  });
  try { localStorage.setItem(ACTIVE_TAB_KEY, tabId); } catch (e) {}
}

function initTabs() {
  document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
  let initial = 'overview';
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    if (saved && TAB_IDS.includes(saved)) initial = saved;
  } catch (e) {}
  activateTab(initial);
  document.getElementById('ab-cancel-btn')
    ?.addEventListener('click', _hideAddForm);
  document.getElementById('ab-save-btn')
    ?.addEventListener('click', _saveAddForm);
  _renderMasterRow();
}

function _twoDigit(n) { return String(n).padStart(2, '0'); }
function _hhmm(d) { return `${_twoDigit(d.getHours())}:${_twoDigit(d.getMinutes())}`; }

function updateFeedDraftSaved() {
  const el = document.getElementById('feedDraftStatus');
  if (!el) return;
  el.textContent = `saved ${_hhmm(new Date())}`;
}

function updateFeedLastRun() {
  const el = document.getElementById('feedLastRun');
  if (!el) return;
  el.textContent = _hhmm(new Date());
}

async function fetchPrices() {
    // Token prices only — gas price is fetched separately when Run Pool fires.
    try {
        const res    = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,tether&vs_currencies=usd',
            { signal: AbortSignal.timeout(8000) }
        );
        const json   = await res.json();
        ethUsdPrice  = json?.ethereum?.usd ?? null;
        usdtUsdPrice = json?.tether?.usd   ?? null;
        pricesFetchedAt = new Date();
    } catch {
        ethUsdPrice     = null;
        usdtUsdPrice    = null;
        pricesFetchedAt = null;
    }
}

// Fetch the effective gas price (base + tip, computed server-side).
// Called only when Run Pool fires so the estimate reflects network
// conditions at the moment the plan is generated.
async function fetchGasPrice() {
    try {
        const res     = await fetch('/api/gas', { signal: AbortSignal.timeout(8000) });
        const json    = await res.json();
        const propose = json?.propose;
        gasPriceGwei  = (typeof propose === 'number' && isFinite(propose) && propose > 0)
            ? propose
            : GAS_PRICE_FALLBACK_GWEI;
    } catch {
        gasPriceGwei = GAS_PRICE_FALLBACK_GWEI;
    }
    gasPriceFetchedAt = new Date();  // stamp regardless of success/fallback
}

// ── USDT/USD rate ─────────────────────────────────────
// Uses the live CoinGecko rate when available; falls back to the
// canonical $1.00 peg if the fetch failed or price is unavailable.
function usdtRate() {
    return usdtUsdPrice ?? 1.0;
}

// ── Rounding utilities ────────────────────────────────────
// Use these instead of ad-hoc .toFixed() when storing numeric values.
const r2 = v => Math.round(v * 100)   / 100;   // 2 d.p. — USD / USDT amounts
const r4 = v => Math.round(v * 10000) / 10000; // 4 d.p. — ETH wallet balances
// r6 intentionally removed: it was applied prematurely to gas costs and
// zeroed out values at low Gwei prices (0.005 Gwei × 21000 / 1e9 = 1.05e-7,
// which r6 rounds to exactly 0). Gas computations stay as raw floats and are
// rounded only at the presentation layer via fmtGasEth / fmtDollars.

// ── Per-wallet USD metrics ────────────────────────────────
// Returns { eth_usd, usdt_usd, total_usd } for one wallet.
// eth_usd and total_usd are null when ethUsdPrice is unavailable.
// Safe to call on errored wallets (all fields null).
function walletMetrics(w) {
    if (w.error) return { eth_usd: null, usdt_usd: null, total_usd: null };
    const eth_usd   = ethToUsd(w.balance);
    const usdt_usd  = r2((w.usdt_balance ?? 0) * usdtRate());
    const total_usd = eth_usd != null ? r2(eth_usd + usdt_usd) : null;
    return { eth_usd, usdt_usd, total_usd };
}

// ── Portfolio-level aggregates ────────────────────────────
// Accepts either raw wallet objects (from /api/load) or summary
// entries (from /api/pool), unified via the `balanceKey` parameter.
// Default balanceKey = "balance" covers both cases; pass "post" for
// after-transfer summaries.
function portfolioMetrics(wallets, balanceKey = 'balance') {
    const ok          = wallets.filter(w => !w.error);
    const totalEth    = r4(ok.reduce((s, w) => s + (w[balanceKey] ?? 0), 0));
    const totalUsdt   = r2(ok.reduce((s, w) => s + (w.usdt_balance ?? w.usdt_post ?? 0), 0));
    const totalEthUsd = ethToUsd(totalEth);
    const totalUsdtUsd = r2(totalUsdt * usdtRate());
    const totalUsd    = totalEthUsd != null ? r2(totalEthUsd + totalUsdtUsd) : null;
    return { totalEth, totalUsdt, totalEthUsd, totalUsdtUsd, totalUsd };
}

// ── Formatting helpers ────────────────────────────────────
// All return null (not '') when a value is unavailable or zero-suppressed,
// so callers can use a consistent falsy check: if (v) { ... }

// Format a USD amount (from any source). Returns null for null input.
function fmtDollars(usd) {
    if (usd == null) return null;
    if (usd >= 1e9)  return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6)  return '$' + (usd / 1e6).toFixed(2) + 'M';
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Convert an ETH amount to its USD value (number). Returns null when unavailable.
// Use this for arithmetic; use fmtUsd() for display.
function ethToUsd(eth) {
    return (ethUsdPrice != null && eth != null) ? r2(eth * ethUsdPrice) : null;
}

// Convert ETH → USD string. Returns null when price is unavailable.
function fmtUsd(eth) {
    const v = ethToUsd(eth);
    return v != null ? fmtDollars(v) : null;
}

// Format a USDT amount as a plain number string (no $ prefix — USDT is a token,
// not a dollar sign). Returns null for null/zero so callers use the same falsy check.
function fmtUsdt(val) {
    if (val == null) return null;
    const n = r2(val * usdtRate());
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compact USD formatter for SVG chart centers — keeps the string under ~7 chars.
function fmtUsdCompact(v) {
    if (v == null) return '—';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(2);
}

// Returns a <span class="val-usd"> or '' when value is null/unavailable.
function usdSpan(eth) {
    const v = fmtUsd(eth);
    return v ? `<span class="val-usd">${v}</span>` : '';
}

// ── Gas Estimation ────────────────────────────────────────
// Gas limits by token — extend this map when new tokens are added.
const GAS_LIMITS = {
    ETH:  21000,   // native ETH transfer
    USDT: 65000,   // ERC-20 transfer
};


// ── Gas Computation (pure — no rounding) ─────────────────────────
// Returns raw IEEE 754 floats. Rounding happens ONLY in the presentation layer.

// Gas cost for one transfer in ETH.
// Uses the live gas price when available; falls back to GAS_PRICE_FALLBACK_GWEI
// so estimation works even after a page reload (before fetchPrices runs).
function gasInEth(token = 'ETH') {
    const gwei = gasPriceGwei ?? GAS_PRICE_FALLBACK_GWEI;
    return (gwei * (GAS_LIMITS[token] ?? GAS_LIMITS.ETH)) / 1e9;
}

// Gas cost for one transfer in USD. Null when ethUsdPrice is unavailable.
function gasInUsd(token = 'ETH') {
    const eth = gasInEth(token);
    return (eth != null && ethUsdPrice != null) ? eth * ethUsdPrice : null;
}

// ── Gas Formatting (presentation layer only) ──────────────────────

// Format a raw ETH gas cost. 8 d.p. covers the full realistic Gwei range.
function fmtGasEth(eth) {
    if (eth == null) return null;
    return eth.toFixed(8) + ' ETH';
}

// Format a gas cost in USD with enough precision to show sub-cent values.
// fmtDollars rounds to 2 d.p., making $0.0109 appear as $0.01 (looks like zero).
// At current mainnet gas prices (~0.2 Gwei) each transfer costs ~$0.01-$0.04,
// so 4 d.p. is needed to show a meaningful non-zero value.
function fmtGasUsd(usd) {
    if (usd == null) return null;
    if (usd < 0.01)  return '$' + usd.toFixed(4);  // e.g. $0.0011
    if (usd < 0.10)  return '$' + usd.toFixed(3);  // e.g. $0.011
    return fmtDollars(usd);                          // e.g. $1.23
}

// Full gas analysis for a transfer list. Returns null only when there are no transfers.
// gasInEth() handles missing gas price via GAS_PRICE_FALLBACK_GWEI internally.
function analyzeGas(transfers) {
    if (!transfers.length) return null;

    // Pre-compute gas cost per token type — all transfers of the same token
    // have identical gas costs, so there is no need to recompute inside the map.
    const gasCostByToken = {};
    for (const token of Object.keys(GAS_LIMITS)) {
        gasCostByToken[token] = { eth: gasInEth(token), usd: gasInUsd(token) };
    }
    const getGas = token => gasCostByToken[token] ?? gasCostByToken['ETH'];

    // Enrich each transfer with raw (unrounded) gas cost and viability flag.
    // valueUsd is also kept raw so the uneconomical comparison is lossless.
    const txGas = transfers.map(t => {
        const token    = t.token || 'ETH';
        const { eth: gasEth, usd: gasUsd } = getGas(token);
        const valueUsd = (token === 'ETH' && ethUsdPrice)
            ? t.amount * ethUsdPrice
            : t.amount * usdtRate();
        return { ...t, gasEth, gasUsd, valueUsd,
                 uneconomical: gasUsd != null && gasUsd > valueUsd };
    });

    // Sequential simulation: walk transfers in execution order, maintaining a
    // running balance per address so inbound ETH credits downstream senders.
    const simBalance = {};
    loadedWallets.forEach(w => {
        simBalance[w.address.toLowerCase()] = w.balance;
    });

    // Flag senders whose simulated balance goes negative at any execution step.
    // Store raw floats — rounding only happens when displayed.
    const insufficientGas = {};
    txGas.forEach(t => {
        const token      = t.token || 'ETH';
        const senderAddr = t.from.toLowerCase();

        if (simBalance[senderAddr] === undefined) simBalance[senderAddr] = 0;

        const gasCost  = t.gasEth ?? 0;
        const afterGas = simBalance[senderAddr] - gasCost;

        if (afterGas < 0) {
            // Can't cover gas at all — genuine deficiency.
            simBalance[senderAddr] = afterGas;
            const w        = loadedWallets.find(x => x.address.toLowerCase() === senderAddr);
            const shortfall = -afterGas;
            insufficientGas[senderAddr] = {
                name:      w ? (walletLabel(w) ?? shortAddr(w.address)) : shortAddr(t.from),
                balance:   w ? w.balance : 0,
                needed:    (w ? w.balance : 0) + shortfall,
                shortfall,
            };
        } else if (token === 'ETH') {
            // Gas is covered. For sweep-style transfers the planned amount may
            // equal the wallet's full balance — cap to what remains after gas
            // so the wallet lands at zero rather than triggering a false alarm.
            const effectiveAmount    = Math.min(t.amount, afterGas);
            simBalance[senderAddr]   = afterGas - effectiveAmount;

            // Credit the receiver immediately so downstream senders benefit.
            if (t.to) {
                const receiverAddr = t.to.toLowerCase();
                if (simBalance[receiverAddr] === undefined) simBalance[receiverAddr] = 0;
                simBalance[receiverAddr] += effectiveAmount;
            }
        } else {
            // USDT: only gas is deducted from ETH balance.
            simBalance[senderAddr] = afterGas;
        }
    });

    // Totals: sum raw values — do not round intermediate sums.
    const totalGasEth = txGas.reduce((s, t) => s + (t.gasEth ?? 0), 0);
    // totalGasUsd stays null (not 0) when ethUsdPrice is unavailable, so
    // the presentation layer can distinguish "no USD price" from "zero cost".
    const usdValues   = txGas.map(t => t.gasUsd).filter(v => v != null);
    const totalGasUsd = usdValues.length ? usdValues.reduce((s, v) => s + v, 0) : null;

    return {
        txGas,
        totalGasEth,
        totalGasUsd,
        insufficientGas,
        hasInsufficient: Object.keys(insufficientGas).length > 0,
        hasUneconomical: txGas.some(t => t.uneconomical),
    };
}

// Shared timestamp badge for the bottom-of-card legends.
// Returns a <span class="pricing-legend-ts"> string, or '' when date is null.
function fmtLegendTimestamp(date) {
    if (!date) return '';
    const hh     = String(date.getHours()).padStart(2, '0');
    const mm     = String(date.getMinutes()).padStart(2, '0');
    const ss     = String(date.getSeconds()).padStart(2, '0');
    const ageMin = Math.floor((Date.now() - date.getTime()) / 60000);
    const age    = ageMin === 0 ? 'just now' : `${ageMin} min ago`;
    return `<span class="pricing-legend-ts">fetched ${hh}:${mm}:${ss} — ${age}</span>`;
}

// ── Step Progress ─────────────────────────────────────────
function setStep(active) {
    // PHASE-1C: No-op. Linear step progression replaced
    // by sidebar tab navigation. Existing callers remain
    // in place but do nothing. Safe to remove in later
    // cleanup phase.
    return;
}

function setLoading(btn, loading) {
    const text    = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled  = loading;
    if (text)    text.style.opacity = loading ? '0.4' : '1';
    if (spinner) spinner.classList.toggle('hidden', !loading);
}

// ── Subwallet Management ──────────────────────────────────
function updateSubwalletCounter() {
    const n       = document.querySelectorAll('.subwallet-row').length;
    const btn     = document.getElementById('add-subwallet');
    const counter = document.getElementById('subwallet-counter');
    if (counter) counter.textContent = `Sub-wallets: ${n} / 15`;
    if (btn)     btn.disabled = n >= 15;
}

// ── Phase 4-REDO-B: Address book interactions ─────────────────

// ── Set Master flow ───────────────────────────────────────────
function _renderMasterRow() {
    const identity = document.getElementById('ab-master-identity');
    const actions  = document.getElementById('ab-master-actions');
    if (!identity || !actions) return;

    // First-time setup — no address set yet
    if (!_masterAddress) {
        identity.innerHTML = `
      <div class="ab-name-row">
        <span class="ab-name">Master Wallet</span>
        <span class="master-badge">★ MASTER</span>
      </div>
      <div class="ab-detail-row">
        <input type="text"
               id="master-address"
               class="ab-input address-input"
               placeholder="0x... master wallet address"
               style="max-width:420px;margin-top:4px;"
               autocomplete="off"
               spellcheck="false" />
      </div>
      <p class="error-msg" id="ab-master-setup-error"></p>`;

        actions.innerHTML = `
      <button class="btn-primary btn-sm"
              onclick="_saveMasterSetup()">
        Save
      </button>`;
        return;
    }

    // Read mode — master address is set
    const short = _masterAddress.slice(0, 6) + '…' + _masterAddress.slice(-4);

    identity.innerHTML = `
    <div class="ab-name-row">
      <span class="ab-name">${_masterLabel || 'Master Wallet'}</span>
      <span class="master-badge">★ MASTER</span>
    </div>
    <div class="ab-detail-row">
      <span class="ab-address-display">${short}</span>
      ${_masterDesc
        ? '<span class="ab-desc-display">· ' + _masterDesc + '</span>'
        : ''}
    </div>
    <input type="hidden" id="master-address" value="${_masterAddress}" />`;

    actions.innerHTML = `
    <button class="btn-ghost-action" onclick="_openMasterPicker()">
      ★ Set Master
    </button>`;
}

function _saveMasterSetup() {
    const input = document.getElementById('master-address');
    const errEl = document.getElementById('ab-master-setup-error');
    const addr  = input?.value.trim() ?? '';

    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        if (errEl) errEl.textContent = 'Invalid Ethereum address format.';
        return;
    }

    const subAddrs = Array.from(document.querySelectorAll('.sub-address'))
        .map(i => i.value.toLowerCase());
    if (subAddrs.includes(addr.toLowerCase())) {
        if (errEl) errEl.textContent = 'This address is already used as a sub-wallet.';
        return;
    }

    _masterAddress = addr;
    _masterLabel   = 'Master Wallet';
    _masterDesc    = '';
    _renderMasterRow();
    saveDraft();
}

function _openMasterPicker() {
    const picker  = document.getElementById('ab-master-picker');
    const listEl  = document.getElementById('ab-picker-list');
    const subRows = document.querySelectorAll('.subwallet-row');

    if (!picker || !listEl) return;

    if (subRows.length === 0) {
        listEl.innerHTML = `
      <p class="ab-picker-empty">
        No sub-wallets available. Add a sub-wallet first.
      </p>`;
    } else {
        listEl.innerHTML = Array.from(subRows).map(row => {
            const addr  = row.querySelector('.sub-address').value;
            const label = row.querySelector('.sub-label').value;
            const desc  = row.querySelector('.sub-desc').value;
            const color = row.querySelector('.ab-avatar-sub')?.style.background
                || CHART_COLORS[0];
            const short = addr.slice(0, 6) + '…' + addr.slice(-4);
            const safeLabel = label.replace(/'/g, "\\'");
            const safeDesc  = desc.replace(/'/g, "\\'");
            const safeColor = color.replace(/'/g, "\\'");
            return `
          <div class="ab-picker-item"
               onclick="_selectNewMaster('${addr}','${safeLabel}','${safeDesc}','${safeColor}')">
            <div class="ab-avatar ab-avatar-sub"
                 style="background:${color};width:32px;height:32px;font-size:12px;">
              ${label ? label[0].toUpperCase() : '?'}
            </div>
            <div class="ab-identity">
              <span class="ab-name" style="font-size:13px;">${label || 'Unlabelled'}</span>
              <span class="ab-address-display">${short}</span>
            </div>
          </div>`;
        }).join('');
    }

    picker.classList.remove('hidden');
}

function _closeMasterPicker() {
    document.getElementById('ab-master-picker')?.classList.add('hidden');
}

function _selectNewMaster(newAddr, newLabel, newDesc, newColor) {
    _closeMasterPicker();

    if (loadedWallets.length > 0) {
        const confirmed = window.confirm(
            'Changing the master wallet will clear the current portfolio ' +
            'and all pooling configuration. Continue?'
        );
        if (!confirmed) return;

        loadedWallets  = [];
        lastPoolResult = null;
        lastPoolConfig = [];

        ['portfolio-view', 'results-view', 'after-view',
         'pooling-setup', 'portfolio-hero'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
    }

    // Old master becomes a sub-wallet
    const oldAddr  = _masterAddress;
    const oldLabel = _masterLabel;
    const oldDesc  = _masterDesc;

    // Promote selected sub-wallet to master
    _masterAddress = newAddr;
    _masterLabel   = newLabel || 'Master Wallet';
    _masterDesc    = newDesc;
    _renderMasterRow();

    // Remove the promoted sub-wallet row from the list
    document.querySelectorAll('.subwallet-row').forEach(row => {
        if (row.querySelector('.sub-address')?.value.toLowerCase() ===
            newAddr.toLowerCase()) {
            row.remove();
        }
    });

    // Add old master as a new sub-wallet row
    const list  = document.getElementById('subwallet-list');
    const count = list.querySelectorAll('.subwallet-row').length;
    const color = CHART_COLORS[count % CHART_COLORS.length];
    list.appendChild(_makeSubRow(
        oldLabel === 'Master Wallet' ? '' : oldLabel,
        oldAddr, oldDesc, color, count
    ));

    updateSubwalletCounter();
    saveDraft();
}
// ── /Set Master flow ──────────────────────────────────────────

// Opens the inline add form; called by #add-subwallet click.
function addSubwallet() {
    const form = document.getElementById('ab-add-form');
    const btn  = document.getElementById('add-subwallet');
    if (!form || !btn) return;
    form.classList.remove('hidden');
    btn.classList.add('hidden');
    document.getElementById('ab-new-label')?.focus();
    const errEl = document.getElementById('ab-form-error');
    if (errEl) errEl.textContent = '';
}

function _hideAddForm() {
    const form = document.getElementById('ab-add-form');
    const btn  = document.getElementById('add-subwallet');
    if (form) form.classList.add('hidden');
    if (btn)  btn.classList.remove('hidden');
    ['ab-new-label', 'ab-new-address', 'ab-new-note'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const errEl = document.getElementById('ab-form-error');
    if (errEl) errEl.textContent = '';
}

function _makeSubRow(label, address, desc, color, index) {
    const short = address.slice(0, 6) + '…' + address.slice(-4);
    const row   = document.createElement('div');
    row.className       = 'subwallet-row ab-row ab-row-sub';
    row.dataset.address = address;

    const labelHtml = label
        ? `<span class="ab-name">${label}</span>`
        : `<span class="ab-name" style="color:var(--muted);font-weight:400">Unlabelled</span>`;

    const descHtml = desc
        ? `<span class="ab-desc-display">· ${desc}</span>`
        : '';

    row.innerHTML = `
    <input type="hidden" class="sub-address" value="${address}" />
    <input type="hidden" class="sub-label"   value="${label}" />
    <input type="hidden" class="sub-desc"    value="${desc}" />
    <div class="ab-avatar ab-avatar-sub"
         style="background:${color};color:#fff">${index + 1}</div>
    <div class="ab-identity">
      <div class="ab-name-row">${labelHtml}</div>
      <div class="ab-detail-row">
        <span class="ab-address-display">${short}</span>
        ${descHtml}
      </div>
    </div>
    <div class="ab-actions">
      <button class="btn-ghost-action"
              onclick="_editSubRow(this)">
        <span class="btn-action-icon">✎</span> Edit
      </button>
      <button class="btn-ghost-action btn-ghost-remove"
              onclick="removeSubwallet(this)"
              title="Remove wallet">
        <span class="btn-action-icon">🗑</span> Remove
      </button>
    </div>`;
    return row;
}

function _saveAddForm() {
    const label   = document.getElementById('ab-new-label').value.trim();
    const address = document.getElementById('ab-new-address').value.trim();
    const desc    = document.getElementById('ab-new-note').value.trim();
    const errEl   = document.getElementById('ab-form-error');

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        errEl.textContent = 'Invalid Ethereum address format.';
        return;
    }

    for (const inp of document.querySelectorAll('.sub-address')) {
        if (inp.value.toLowerCase() === address.toLowerCase()) {
            errEl.textContent = 'This address is already in the list.';
            return;
        }
    }

    const masterAddr = document.getElementById('master-address').value.trim();
    if (masterAddr.toLowerCase() === address.toLowerCase()) {
        errEl.textContent = 'Address matches the master wallet.';
        return;
    }

    const list  = document.getElementById('subwallet-list');
    const count = list.querySelectorAll('.subwallet-row').length;
    if (count >= 15) {
        errEl.textContent = 'Maximum 15 sub-wallets reached.';
        return;
    }

    const color = CHART_COLORS[count % CHART_COLORS.length];
    list.appendChild(_makeSubRow(label, address, desc, color, count));
    updateSubwalletCounter();
    _hideAddForm();
    saveDraft();
}

function _editSubRow(btn) {
    const row     = btn.closest('.subwallet-row');
    const address = row.querySelector('.sub-address').value;
    const label   = row.querySelector('.sub-label').value;
    const desc    = row.querySelector('.sub-desc').value;
    const color   = row.querySelector('.ab-avatar-sub').style.background;
    const index   = Array.from(
        document.querySelectorAll('.subwallet-row')
    ).indexOf(row);

    row.innerHTML = `
    <input type="hidden" class="sub-address" value="${address}" />
    <input type="hidden" class="sub-label"   value="" />
    <input type="hidden" class="sub-desc"    value="" />
    <div class="ab-avatar ab-avatar-sub"
         style="background:${color};color:#fff">${index + 1}</div>
    <div class="ab-identity">
      <div class="ab-form-grid" style="width:100%;gap:8px;">
        <div class="ab-form-field">
          <label class="ab-form-label">Label</label>
          <input type="text" class="ab-input ab-edit-label"
                 value="${label}" maxlength="30"
                 placeholder="Label (optional)" />
        </div>
        <div class="ab-form-field">
          <label class="ab-form-label">Address</label>
          <input type="text" class="ab-input ab-edit-address address-input"
                 value="${address}" placeholder="0x..." />
        </div>
      </div>
      <div class="ab-form-field" style="margin-top:6px;">
        <label class="ab-form-label">Note (optional)</label>
        <input type="text" class="ab-input ab-edit-desc"
               value="${desc}" maxlength="80"
               placeholder="Internal description..." />
      </div>
      <p class="error-msg ab-edit-error"></p>
    </div>
    <div class="ab-actions">
      <button class="btn-ghost-action"
              onclick="_cancelEditRow(this)">Cancel</button>
      <button class="btn-primary btn-sm"
              onclick="_saveEditRow(this)">Save</button>
    </div>`;
}

function _saveEditRow(btn) {
    const row     = btn.closest('.subwallet-row');
    const address = row.querySelector('.ab-edit-address').value.trim();
    const label   = row.querySelector('.ab-edit-label').value.trim();
    const desc    = row.querySelector('.ab-edit-desc').value.trim();
    const errEl   = row.querySelector('.ab-edit-error');
    const color   = row.querySelector('.ab-avatar-sub').style.background;
    const index   = Array.from(
        document.querySelectorAll('.subwallet-row')
    ).indexOf(row);

    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        errEl.textContent = 'Invalid Ethereum address format.';
        return;
    }

    for (const inp of document.querySelectorAll('.sub-address')) {
        if (inp.closest('.subwallet-row') === row) continue;
        if (inp.value.toLowerCase() === address.toLowerCase()) {
            errEl.textContent = 'This address is already in the list.';
            return;
        }
    }

    row.replaceWith(_makeSubRow(label, address, desc, color, index));
    saveDraft();
}

function _cancelEditRow(btn) {
    const row     = btn.closest('.subwallet-row');
    const address = row.querySelector('.sub-address').value;
    const color   = row.querySelector('.ab-avatar-sub').style.background;
    const index   = Array.from(
        document.querySelectorAll('.subwallet-row')
    ).indexOf(row);

    const draft = _loadRawDraft?.();
    const i     = draft?.subAddresses?.indexOf(address) ?? -1;
    const label = i >= 0 ? (draft.subLabels?.[i]        ?? '') : '';
    const desc  = i >= 0 ? (draft.subDescriptions?.[i]  ?? '') : '';

    row.replaceWith(_makeSubRow(label, address, desc, color, index));
}

// ── /Phase 4-REDO-B ───────────────────────────────────────────

function removeSubwallet(btn) { btn.closest('.subwallet-row').remove(); updateSubwalletCounter(); }

// ── Draft Persistence ─────────────────────────────────────
// Persists wallet addresses, live balances, prices, and pooling config.
// Never persists algorithm outputs (transfer plans, rebalance results).

const DRAFT_KEY = 'ct_draft_v1';

function saveDraft() {
    if (!loadedWallets.length) return;

    // Capture pooling config from current DOM state
    const poolingConfig = {};
    document.querySelectorAll('#pooling-body tr[data-address]').forEach(row => {
        const addr = row.dataset.address;
        const role = row.dataset.role;
        if (role === 'master') {
            poolingConfig[addr] = {
                ethMode:    row.querySelector('.master-mode-select')?.value  ?? 'hub',
                ethTarget:  parseFloat(row.querySelector('.master-target-input')?.value)  || 0,
                usdtMode:   row.querySelector('.master-usdt-mode-select')?.value ?? 'hub',
                usdtTarget: parseFloat(row.querySelector('.master-usdt-target-input')?.value) || 0,
            };
        } else {
            poolingConfig[addr] = {
                ethMode:    row.querySelector('.eth-mode-select')?.value  ?? 'zero',
                ethTarget:  parseFloat(row.querySelector('.sub-target-input')?.value)  || 0,
                usdtMode:   row.querySelector('.usdt-mode-select')?.value ?? 'zero',
                usdtTarget: parseFloat(row.querySelector('.sub-usdt-target-input')?.value) || 0,
            };
        }
    });

    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            savedAt:        new Date().toISOString(),
            masterAddress:  _masterAddress,
            masterLabel:    _masterLabel,
            masterDesc:     _masterDesc,
            subAddresses:   Array.from(document.querySelectorAll('.sub-address'))
                                .map(el => el.value.trim()).filter(Boolean),
            subLabels:      Array.from(document.querySelectorAll('.sub-label'))
                                .map(el => el.value.trim()),
            subDescriptions: Array.from(document.querySelectorAll('.sub-desc'))
                                .map(el => el.value.trim()),
            // Strip ephemeral _color before serialising
            loadedWallets:  loadedWallets.map(({ _color, ...w }) => w),
            ethUsdPrice,
            usdtUsdPrice,
            pricesFetchedAt: pricesFetchedAt?.toISOString() ?? null,
            poolingConfig,
        }));
    } catch (e) {
        console.warn('[CryptoTreasury] Draft save failed:', e);
    }
    updateFeedDraftSaved();
}

function _loadRawDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// Populate the pooling table rows from a saved config object without
// triggering the change-event handlers (we're restoring, not user-editing).
function _restorePoolingConfig(config) {
    document.querySelectorAll('#pooling-body tr[data-address]').forEach(row => {
        const addr = row.dataset.address;
        const role = row.dataset.role;
        const cfg  = config[addr];
        if (!cfg) return;

        const set = (selClass, modeVal, inputClass, targetVal, activeWhen) => {
            const modeEl   = row.querySelector(selClass);
            const inputEl  = row.querySelector(inputClass);
            const toggleEl = inputEl?.closest('.target-input-row')?.querySelector('.currency-toggle');
            if (modeEl)   modeEl.value = modeVal;
            const enabled = modeVal === activeWhen;
            if (inputEl)  { inputEl.disabled = !enabled; if (enabled && targetVal) inputEl.value = targetVal; }
            if (toggleEl) toggleEl.disabled = !enabled;
        };

        if (role === 'master') {
            set('.master-mode-select',      cfg.ethMode,  '.master-target-input',      cfg.ethTarget,  'minimum');
            set('.master-usdt-mode-select', cfg.usdtMode, '.master-usdt-target-input', cfg.usdtTarget, 'minimum');
        } else {
            set('.eth-mode-select',  cfg.ethMode,  '.sub-target-input',      cfg.ethTarget,  'target');
            set('.usdt-mode-select', cfg.usdtMode, '.sub-usdt-target-input', cfg.usdtTarget, 'target');
        }
    });
}

function restoreDraft() {
    const draft = _loadRawDraft();
    if (!draft?.loadedWallets?.length) return;

    // ── Step 1: restore address inputs ───────────────────
    if (draft.masterAddress) {
        _masterAddress = draft.masterAddress;
        _masterLabel   = draft.masterLabel || 'Master Wallet';
        _masterDesc    = draft.masterDesc  || '';
        _renderMasterRow();
    }
    if (draft.subAddresses?.length) {
        const list = document.getElementById('subwallet-list');
        list.innerHTML = '';
        draft.subAddresses.forEach((addr, i) => {
            const label = draft.subLabels?.[i]        ?? '';
            const desc  = draft.subDescriptions?.[i]  ?? '';
            const color = CHART_COLORS[i % CHART_COLORS.length];
            list.appendChild(_makeSubRow(label, addr, desc, color, i));
        });
        updateSubwalletCounter();
    }

    // ── Restore prices (must come before displayPortfolio) ─
    ethUsdPrice     = draft.ethUsdPrice   ?? null;
    usdtUsdPrice    = draft.usdtUsdPrice  ?? null;
    // Gas price is not restored from draft — it is fetched fresh when Run Pool fires.
    pricesFetchedAt = draft.pricesFetchedAt ? new Date(draft.pricesFetchedAt) : null;

    // ── Step 2: restore portfolio view ───────────────────
    // Re-run walletMetrics so USD fields are consistent with restored prices.
    loadedWallets = draft.loadedWallets.map(w => ({
        ...w,
        label: w.role === 'master' ? (_masterLabel || 'Master Wallet') : (w.label ?? ''),
        description: w.role === 'master' ? '' : (w.description ?? ''),
        ...walletMetrics(w),
    }));
    displayPortfolio({});   // reads loadedWallets global directly

    // ── Step 3: restore pooling setup ────────────────────
    buildPoolingSetup(loadedWallets);
    if (draft.poolingConfig && Object.keys(draft.poolingConfig).length) {
        _restorePoolingConfig(draft.poolingConfig);
    }
}

// ── Initialization ────────────────────────────────────────
document.getElementById('add-subwallet').addEventListener('click', addSubwallet);
document.getElementById('load-btn').addEventListener('click', loadPortfolio);

// Auto-save pooling config whenever the user edits it
document.getElementById('pooling-body').addEventListener('change', saveDraft);
document.getElementById('pooling-body').addEventListener('input',  saveDraft);

// Restore any persisted draft (runs before first paint)
restoreDraft();

// ── Validation ────────────────────────────────────────────
function validateWalletInputs(masterAddress, subAddresses) {
    const errors = [];

    document.querySelectorAll('.sub-address').forEach(el => {
        el.style.borderColor = '';
        el.style.boxShadow   = '';
    });
    const masterEl = document.getElementById('master-address');
    masterEl.style.borderColor = '';
    masterEl.style.boxShadow   = '';

    if (!masterAddress) {
        errors.push('Please enter a master wallet address.');
        return errors;
    }
    if (!isValidEthAddress(masterAddress)) {
        highlightInput(masterEl);
        errors.push('Master address is not a valid Ethereum address.');
    }
    if (subAddresses.length === 0) {
        errors.push('Please add at least one subwallet.');
        return errors;
    }

    const subInputs = document.querySelectorAll('.sub-address');
    subInputs.forEach(input => {
        const val = input.value.trim();
        if (val && !isValidEthAddress(val)) {
            highlightInput(input);
            errors.push(`Invalid address format: ${val.slice(0,10)}...`);
        }
    });

    const masterLower = masterAddress.toLowerCase();
    subInputs.forEach(input => {
        const val = input.value.trim().toLowerCase();
        if (val && val === masterLower) {
            highlightInput(input);
            highlightInput(masterEl);
            errors.push('Master address cannot also be a subwallet.');
        }
    });

    const seen = {};
    subInputs.forEach(input => {
        const val = input.value.trim().toLowerCase();
        if (!val) return;
        if (seen[val]) {
            highlightInput(input);
            highlightInput(seen[val]);
            errors.push(`Duplicate subwallet: ${input.value.trim().slice(0,10)}...`);
        } else { seen[val] = input; }
    });

    return errors;
}

function isValidEthAddress(addr) { return /^0x[0-9a-fA-F]{40}$/.test(addr); }

function highlightInput(input) {
    input.style.borderColor = '#B91C1C';
    input.style.boxShadow   = '0 0 0 2px #FEF2F2';
}

// ── Colour helpers ────────────────────────────────────────

// Return the chart colour assigned to a wallet during portfolio load.
// Sub-wallets get an indexed colour; master gets the neutral tint.
function getWalletColor(address) {
    const w = loadedWallets.find(
        w => w.address.toLowerCase() === address.toLowerCase()
    );
    if (!w) return MASTER_CHART_COLOR;
    return w.role === 'master' ? MASTER_CHART_COLOR : (w._color || MASTER_CHART_COLOR);
}

// ── Wallet identity helpers ───────────────────────────────

// Returns the wallet's label, or null if unset.
function walletLabel(w) {
    return w?.label?.trim() || null;
}

// Short address: 0x1234...5678
function shortAddr(addr) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
}

// Two-line identity block: label (primary) + address (secondary).
// Falls back to address-only when no label.
function walletIdHtml(w) {
    const label = walletLabel(w);
    const addr  = shortAddr(w.address);
    if (!label) return `<span class="wallet-addr-only">${addr}</span>`;
    return `<span class="wallet-label">${label}</span>`
         + `<span class="wallet-addr">${addr}</span>`;
}

// Same, but looks up the wallet by address from loadedWallets.
function walletIdHtmlByAddr(address) {
    const w = loadedWallets.find(x => x.address.toLowerCase() === address.toLowerCase());
    return w ? walletIdHtml(w) : `<span class="wallet-addr-only">${shortAddr(address)}</span>`;
}

// Build a label map from the current Step-1 sub-wallet inputs.
function getLabelMapFromInputs() {
    const map = {};
    document.querySelectorAll('.subwallet-row').forEach(row => {
        const addr  = row.querySelector('.sub-address')?.value.trim().toLowerCase();
        const label = row.querySelector('.sub-label')?.value.trim() ?? '';
        if (addr) map[addr] = label;
    });
    return map;
}

// ── Step 1: Load Portfolio ────────────────────────────────

// Clear any previous rebalance output so Steps 4 and 5 never show
// stale calculations after loading a new portfolio.
function clearRebalanceResults() {
    lastPoolResult = null;
    lastPoolConfig = [];
    gasPriceGwei      = null;
    gasPriceFetchedAt = null;

    ['results-view', 'after-view'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });

    // Clear inner content so DOM references are clean for the next run
    document.getElementById('results-summary').innerHTML  = '';
    const _tl = document.getElementById('transfer-list');
    if (_tl) _tl.innerHTML = '';
    document.getElementById('after-sub-accounts').innerHTML = '';
    document.getElementById('after-master-overview').innerHTML = '';

    // Hide the execution-order note and infeasibility banner
    document.getElementById('transfer-exec-note')?.classList.add('hidden');
    document.getElementById('infeasible-msg')?.classList.add('hidden');

    // Clear gas-specific elements
    const gasAlerts  = document.getElementById('gas-alerts');
    const gasLegend  = document.getElementById('gas-legend');
    const gasNotice  = document.getElementById('gas-notice');
    if (gasAlerts) gasAlerts.innerHTML = '';
    if (gasLegend) { gasLegend.innerHTML = ''; gasLegend.classList.add('hidden'); }
    if (gasNotice) { gasNotice.innerHTML = ''; gasNotice.classList.add('hidden'); }

    // Clear the three after-view charts
    ['after-chart', 'after-usdt-chart', 'after-usd-chart'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

async function refreshPortfolio() {
    if (!loadedWallets.length) return;

    const btn = document.getElementById('refresh-btn');
    setLoading(btn, true);

    try {
        // Snapshot pooling config before the table is rebuilt
        saveDraft();
        const savedConfig = _loadRawDraft()?.poolingConfig ?? {};

        // Only addresses and roles are needed for /api/load
        const walletInputs = loadedWallets.map(w => ({
            address: w.address, role: w.role, mode: null, target: null,
        }));

        const [response] = await Promise.all([
            fetch('/api/load', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ wallets: walletInputs }),
            }),
            fetchPrices(),
        ]);

        if (!response.ok) throw new Error('Server error');

        const data    = await response.json();
        // Re-attach labels from Step-1 inputs (they persist across refreshes)
        const lblMap  = getLabelMapFromInputs();
        loadedWallets = data.wallets.map(w => ({
            ...w,
            label: w.role === 'master' ? 'Master Wallet' : (lblMap[w.address.toLowerCase()] ?? ''),
            ...walletMetrics(w),
        }));

        displayPortfolio(data);

        // Rebuild the pooling table with fresh balances, then restore saved config
        buildPoolingSetup(loadedWallets);
        if (Object.keys(savedConfig).length) {
            _restorePoolingConfig(savedConfig);
        }

        // The rebalance plan was based on stale data — clear it
        clearRebalanceResults();

        saveDraft();
    } catch (err) {
        console.error('[CryptoTreasury] Refresh failed:', err);
    } finally {
        setLoading(btn, false);
    }
}

async function loadPortfolio() {
    const errorEl = document.getElementById('load-error');
    const loadBtn = document.getElementById('load-btn');
    errorEl.textContent = '';

    clearRebalanceResults();

    const masterAddress = _masterAddress.trim();
    const subInputs     = document.querySelectorAll('.sub-address');
    const subAddresses  = Array.from(subInputs)
        .map(i => i.value.trim()).filter(a => a !== '');

    const errors = validateWalletInputs(masterAddress, subAddresses);
    if (errors.length > 0) { errorEl.textContent = errors[0]; return; }

    const wallets = [
        { address: masterAddress, role: 'master', mode: null, target: null },
        ...subAddresses.map(addr => ({ address: addr, role: 'sub', mode: 'zero', target: null }))
    ];

    setLoading(loadBtn, true);

    try {
        const [response] = await Promise.all([
            fetch('/api/load', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ wallets })
            }),
            fetchPrices(),
        ]);
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = 'Server error. Please try again.'; return; }

        // Enrich each wallet with USD fields and attach any user-set labels.
        const labelMap = getLabelMapFromInputs();

        // Phase 4B: description map (address → description)
        const descMap = {};
        document.querySelectorAll('.subwallet-row').forEach(row => {
            const addr = row.querySelector('.sub-address')?.value.trim().toLowerCase();
            const desc = row.querySelector('.sub-desc')?.value.trim() ?? '';
            if (addr) descMap[addr] = desc;
        });

        loadedWallets = data.wallets.map(w => ({
            ...w,
            label: w.role === 'master'
                ? (_masterLabel || 'Master Wallet')
                : (labelMap[w.address.toLowerCase()] ?? ''),
            description: w.role === 'master' ? '' : (descMap[w.address.toLowerCase()] ?? ''),
            ...walletMetrics(w),
        }));
        displayPortfolio(data);
        buildPoolingSetup(loadedWallets);
        saveDraft();  // persist fresh portfolio state immediately after load

    } catch (err) {
        errorEl.textContent = 'Could not connect to server.';
    } finally {
        setLoading(loadBtn, false);
    }
}

// ── Step 2: Display Portfolio ─────────────────────────────

// ── SVG donut chart — shared by before and after views ────

function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutPath(cx, cy, outerR, innerR, startAngle, endAngle) {
    const end = Math.min(endAngle, startAngle + 359.99);
    const os  = polarToCartesian(cx, cy, outerR, startAngle);
    const oe  = polarToCartesian(cx, cy, outerR, end);
    const is_ = polarToCartesian(cx, cy, innerR, startAngle);
    const ie  = polarToCartesian(cx, cy, innerR, end);
    const lg  = (end - startAngle) > 180 ? 1 : 0;
    return [
        `M ${os.x.toFixed(3)} ${os.y.toFixed(3)}`,
        `A ${outerR} ${outerR} 0 ${lg} 1 ${oe.x.toFixed(3)} ${oe.y.toFixed(3)}`,
        `L ${ie.x.toFixed(3)} ${ie.y.toFixed(3)}`,
        `A ${innerR} ${innerR} 0 ${lg} 0 ${is_.x.toFixed(3)} ${is_.y.toFixed(3)}`,
        'Z'
    ].join(' ');
}

function fmtEth(val) {
    return val.toFixed(4);
}

// ── Phase 3B: Donut legend renderer ──────────────────────────
function renderDonutLegend(legendElId, wallets, total, balanceKey,
                           fmtVal) {
  const el = document.getElementById(legendElId);
  if (!el) return;
  const items = wallets
    .filter(w => !w.error && (w[balanceKey] ?? 0) > 0)
    .sort((a, b) => (b[balanceKey] ?? 0) - (a[balanceKey] ?? 0));
  if (items.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = items.map(w => {
    const val  = w[balanceKey] ?? 0;
    const pct  = total > 0 ? (val / total * 100).toFixed(1) : '0.0';
    const color = w.role === 'master' ? MASTER_CHART_COLOR : w._color;
    const label = w.label || (w.address.slice(0,6) + '…' +
                  w.address.slice(-4));
    return `
      <div class="donut-legend-row">
        <span class="donut-legend-swatch"
              style="background:${color}"></span>
        <span class="donut-legend-label">${label}</span>
        <span class="donut-legend-pct">${pct}%</span>
        <span class="donut-legend-val">${fmtVal(val)}</span>
      </div>`;
  }).join('');
}
// ── /Phase 3B ─────────────────────────────────────────────────

/**
 * Render a donut chart into svgEl.
 *
 * wallets      – array of wallet objects (must have address, role, _color, error)
 * total        – the aggregate value for 100 %; pass null/0 to skip rendering
 * containerId  – CSS id of the accounts-panel whose rows to cross-highlight
 * options      – optional overrides:
 *   balanceKey   field on each wallet to use as the slice value (default 'balance')
 *   centerLabel  text shown below the center number (default 'ETH')
 *   centerFmt    function(total) → string for the center number (default fmtEth)
 */
function renderDonutChartTo(svgEl, wallets, total, containerId, {
    balanceKey  = 'balance',
    centerLabel = 'ETH',
    centerFmt   = v => fmtEth(v),
} = {}) {
    // null/undefined means the value is unavailable — skip rendering.
    // 0 is a valid total (all balances are zero) — allow it through.
    if (!svgEl || total == null) return;

    const cx = 100, cy = 100, outerR = 82, innerR = 56;
    const GAP    = 1.2;   // degrees between segments
    const MIN_DEG = 2;    // visual minimum per slice

    const slices = wallets
        .filter(w => !w.error && (w[balanceKey] ?? 0) > 0)
        .map(w => ({
            pct:     (w[balanceKey] ?? 0) / total * 100,
            color:   w.role === 'master' ? MASTER_CHART_COLOR : w._color,
            address: w.address,
            balance: w[balanceKey] ?? 0,
            role:    w.role,
        }));

    if (slices.length === 0) {
        if (total === 0) {
            // Every wallet has a zero balance for this token — render a neutral
            // full-circle ring so the chart area is never blank.
            svgEl.innerHTML = `
                <circle cx="${cx}" cy="${cy}" r="${(outerR + innerR) / 2}"
                    fill="none"
                    stroke="var(--line-2)"
                    stroke-width="${outerR - innerR}" />
                <path d="${donutPath(cx, cy, outerR, innerR, 0, 360)}"
                    fill="${MASTER_CHART_COLOR}"
                    opacity="0.25" />
                <circle cx="${cx}" cy="${cy}" r="${innerR - 1}"
                    fill="var(--surface)" />
                <text x="${cx}" y="${cy - 4}" text-anchor="middle"
                    class="chart-center-value">${centerFmt(total)}</text>
                <text x="${cx}" y="${cy + 14}" text-anchor="middle"
                    class="chart-center-label">${centerLabel}</text>`;
            // Reuse the same opacity the hover system applies to non-highlighted elements.
            svgEl.style.opacity = '0.2';
        } else {
            svgEl.innerHTML = '';  // total > 0 but all wallets errored — nothing to draw
        }
        return;
    }

    // Enforce minimum visual angle so tiny wallets remain visible
    const tinyCount  = slices.filter(s => (s.pct / 100) * 360 < MIN_DEG).length;
    const reserved   = tinyCount * MIN_DEG;
    const available  = 360 - reserved;
    const largeTotal = slices
        .filter(s => (s.pct / 100) * 360 >= MIN_DEG)
        .reduce((sum, s) => sum + s.pct, 0);

    slices.forEach(s => {
        const natural = (s.pct / 100) * 360;
        s.visualDeg = natural < MIN_DEG
            ? MIN_DEG
            : (s.pct / largeTotal) * available;
    });

    let paths = '';
    let angle = 0;
    slices.forEach(s => {
        const start = angle;
        const end   = angle + s.visualDeg - GAP;
        paths += `<path
            d="${donutPath(cx, cy, outerR, innerR, start, end)}"
            fill="${s.color}"
            class="chart-slice"
            data-address="${s.address}"
            data-pct="${s.pct.toFixed(1)}"
            data-balance="${s.balance.toFixed(4)}"
            data-role="${s.role}" />`;
        angle += s.visualDeg;
    });

    svgEl.innerHTML = `
        <circle cx="${cx}" cy="${cy}" r="${(outerR + innerR) / 2}"
            fill="none"
            stroke="var(--line-2)"
            stroke-width="${outerR - innerR}" />
        ${paths}
        <circle cx="${cx}" cy="${cy}" r="${innerR - 1}"
            fill="var(--surface)" />
        <text x="${cx}" y="${cy - 4}" text-anchor="middle"
            class="chart-center-value">${centerFmt(total)}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle"
            class="chart-center-label">${centerLabel}</text>`;

    // ── Phase 3C-Hover-Fix: use shared coordinator ────────────
    svgEl.querySelectorAll('.chart-slice').forEach(path => {
        path.addEventListener('mouseenter', () => {
            _highlightAddress(path.dataset.address);
        });
        path.addEventListener('mouseleave', () => {
            _clearHighlight();
        });
    });

    document.querySelectorAll('.wt-row').forEach(el => {
        // Remove any previously attached listener to prevent
        // duplicates across 6 chart render calls
        el.removeEventListener('mouseenter', el._hoverEnter);
        el.removeEventListener('mouseleave', el._hoverLeave);

        el._hoverEnter = () => _highlightAddress(el.dataset.address);
        el._hoverLeave = () => _clearHighlight();

        el.addEventListener('mouseenter', el._hoverEnter);
        el.addEventListener('mouseleave', el._hoverLeave);
    });
    // ── /Phase 3C-Hover-Fix ────────────────────────────────────

    // Non-zero charts are never permanently dimmed; clear any opacity left from a prior
    // zero-total render of the same SVG element.
    svgEl.style.opacity = '';
}

function displayPortfolio(data) {
    // Use the globally-enriched loadedWallets (already have eth_usd, usdt_usd, total_usd).
    // data.wallets are the raw API objects used only for counts/totals from the server.
    const master = loadedWallets.find(w => w.role === 'master');
    const subs   = loadedWallets.filter(w => w.role === 'sub');

    // Assign chart colours to sub-wallets (index-stable, must run before rendering).
    subs.forEach((w, i) => { w._color = CHART_COLORS[i % CHART_COLORS.length]; });

    // Portfolio-level aggregates — single source of truth.
    const pm = portfolioMetrics(loadedWallets);

    // ── Phase 3A: Hero stats row ──────────────────────────────
    (function renderHeroStats() {
      const heroEl = document.getElementById('portfolio-hero');
      if (!heroEl) return;

      const totalVal  = pm.totalUsd != null
        ? fmtUsdCompact(pm.totalUsd) : '—';
      const ethVal    = pm.totalEth.toFixed(2);
      const ethUsd    = pm.totalEthUsd != null
        ? fmtUsdCompact(pm.totalEthUsd) : null;
      const usdtVal   = pm.totalUsdt.toLocaleString('en-US',
        { maximumFractionDigits: 0 });
      const usdtUsd   = pm.totalUsdtUsd != null
        ? fmtUsdCompact(pm.totalUsdtUsd) : null;
      const walletCount = loadedWallets.length;
      const syncAge = (() => {
        if (!pricesFetchedAt) return 'just now';
        const s = Math.round((Date.now() - pricesFetchedAt) / 1000);
        if (s < 60) return s + 's ago';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        const h = Math.floor(m / 60), rm = m % 60;
        return h + 'h ' + rm + 'm ago';
      })();

      heroEl.innerHTML = `
        <div class="hero-card">
          <div class="hero-card-glow"></div>
          <div class="hero-label">TOTAL PORTFOLIO VALUE</div>
          <div class="hero-value">${totalVal}</div>
          <div class="hero-sub">${walletCount} wallet${walletCount !== 1 ? 's' : ''} · last sync ${syncAge}</div>
        </div>
        <div class="side-stat-card">
          <div class="side-stat-label">ETH HOLDINGS</div>
          <div class="side-stat-value">
            ${ethVal} <span class="side-stat-unit">ETH</span>
          </div>
          ${ethUsd ? `<div class="side-stat-usd">${ethUsd}</div>` : ''}
        </div>
        <div class="side-stat-card">
          <div class="side-stat-label">USDT RESERVES</div>
          <div class="side-stat-value">
            ${usdtVal} <span class="side-stat-unit">USDT</span>
          </div>
          ${usdtUsd ? `<div class="side-stat-usd">${usdtUsd}</div>` : ''}
        </div>`;

      heroEl.classList.remove('hidden');
    })();
    // ── /Phase 3A ─────────────────────────────────────────────

    // Phase 3B: Update donut subtitles with live wallet count
    const walletCountStr = `Across ${loadedWallets.length} wallet${loadedWallets.length !== 1 ? 's' : ''}`;
    document.querySelectorAll('.donut-card-sub').forEach(el => {
      if (el.textContent.startsWith('Across'))
        el.textContent = walletCountStr;
    });

    // Master panel values.
    const masterShort    = master.address.slice(0,6) + '...' + master.address.slice(-4);
    const masterBal      = master.error ? 'Error' : master.balance.toFixed(4);
    const masterEthPct   = pm.totalEth  > 0 && !master.error
        ? (master.balance      / pm.totalEth  * 100).toFixed(1) : '0';
    const masterUsdtPct  = pm.totalUsdt > 0 && !master.error
        ? (master.usdt_balance / pm.totalUsdt * 100).toFixed(1) : '0';

    document.getElementById('master-overview').innerHTML = `
    <table class="wallets-table" id="wallets-table">
      <thead>
        <tr>
          <th class="wt-col-wallet">Wallet</th>
          <th class="wt-col-num">ETH</th>
          <th class="wt-col-num">USDT</th>
          <th class="wt-col-num">Value</th>
          <th class="wt-col-book">% of book</th>
        </tr>
      </thead>
      <tbody id="wallets-tbody">
        <tr class="wt-row wt-row-master"
            data-address="${master.address}">
          <td class="wt-col-wallet">
            <span class="wt-dot"
                  style="background:${MASTER_CHART_COLOR}"></span>
            <span class="wt-identity">
              <span class="wt-name">
                ${master.label
                  ? master.label
                  : 'Master Wallet'}
                <span class="master-badge">★ MASTER</span>
              </span>
              <span class="wt-addr">${
                master.address.slice(0,6) + '…' +
                master.address.slice(-4)
              }</span>
            </span>
          </td>
          <td class="wt-col-num">
            <span class="wt-bal">${masterBal}</span>
            ${master.eth_usd != null
              ? '<br><span class="wt-usd">' +
                fmtDollars(master.eth_usd) + '</span>'
              : ''}
          </td>
          <td class="wt-col-num">
            <span class="wt-bal">${
              (master.usdt_balance ?? 0).toFixed(2)
            }</span>
            ${master.usdt_usd != null
              ? '<br><span class="wt-usd">' +
                fmtDollars(master.usdt_usd) + '</span>'
              : ''}
          </td>
          <td class="wt-col-num wt-col-value">
            ${master.total_usd != null
              ? fmtDollars(master.total_usd)
              : '—'}
          </td>
          <td class="wt-col-book">
            <div class="wt-book-bar-wrap">
              <div class="wt-book-bar"
                   style="width:${
                     pm.totalUsd > 0 && master.total_usd != null
                       ? Math.min(100,
                           master.total_usd / pm.totalUsd * 100
                         ).toFixed(1)
                       : 0
                   }%"></div>
            </div>
            <span class="wt-book-pct">${
              pm.totalUsd > 0 && master.total_usd != null
                ? (master.total_usd / pm.totalUsd * 100)
                    .toFixed(1) + '%'
                : '—'
            }</span>
          </td>
        </tr>
      </tbody>
    </table>`;
    const masterOverviewEl = document.getElementById('master-overview');
    masterOverviewEl.classList.remove('hidden');
    masterOverviewEl.dataset.address = master.address;  // enables chart hover interaction

    // ── Phase 3C: Sub-wallet rows appended to wallets table ──
    const tbody = document.getElementById('wallets-tbody');
    if (tbody) {
      if (subs.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="5"
          style="color:var(--muted);font-size:13px;
                 padding:12px 16px;">
          No sub-wallets loaded.</td>`;
        tbody.appendChild(tr);
      } else {
        subs.forEach(w => {
          const ethPct = pm.totalEth > 0 && !w.error
            ? (w.balance / pm.totalEth * 100).toFixed(1) : '0';
          const usdtPct = pm.totalUsdt > 0 && !w.error
            ? (w.usdt_balance / pm.totalUsdt * 100).toFixed(1)
            : '0';
          const bookPct = pm.totalUsd > 0 && w.total_usd != null
            ? (w.total_usd / pm.totalUsd * 100).toFixed(1)
            : ethPct;
          const bookPctNum = pm.totalUsd > 0 && w.total_usd != null
            ? Math.min(100,
                w.total_usd / pm.totalUsd * 100
              ).toFixed(1)
            : 0;

          const tr = document.createElement('tr');
          tr.className = 'wt-row';
          tr.dataset.address = w.address;

          if (w.error) {
            tr.innerHTML = `
              <td class="wt-col-wallet">
                <span class="wt-dot"
                      style="background:${w._color}"></span>
                <span class="wt-identity">
                  <span class="wt-name">${
                    walletIdHtml(w)
                  }</span>
                </span>
              </td>
              <td colspan="4"
                  style="color:var(--negative);
                         font-size:11px;">
                ${w.error}
              </td>`;
          } else {
            tr.innerHTML = `
              <td class="wt-col-wallet">
                <span class="wt-dot"
                      style="background:${w._color}"></span>
                <span class="wt-identity">
                  <span class="wt-name">${
                    w.label || ''
                  }</span>
                  <span class="wt-addr">${
                    w.address.slice(0,6) + '…' +
                    w.address.slice(-4)
                  }</span>
                </span>
              </td>
              <td class="wt-col-num">
                <span class="wt-bal">${
                  w.balance.toFixed(4)
                }</span>
                ${w.eth_usd != null
                  ? '<br><span class="wt-usd">' +
                    fmtDollars(w.eth_usd) + '</span>'
                  : ''}
              </td>
              <td class="wt-col-num">
                <span class="wt-bal">${
                  (w.usdt_balance ?? 0).toFixed(2)
                }</span>
                ${w.usdt_usd != null
                  ? '<br><span class="wt-usd">' +
                    fmtDollars(w.usdt_usd) + '</span>'
                  : ''}
              </td>
              <td class="wt-col-num wt-col-value">${
                w.total_usd != null
                  ? fmtDollars(w.total_usd) : '—'
              }</td>
              <td class="wt-col-book">
                <div class="wt-book-bar-wrap">
                  <div class="wt-book-bar"
                       style="width:${bookPctNum}%"></div>
                </div>
                <span class="wt-book-pct">${bookPct}%</span>
              </td>`;
          }
          tbody.appendChild(tr);
        });
      }
    }
    // ── /Phase 3C ─────────────────────────────────────────────
    document.getElementById('sub-accounts-panel').innerHTML = '';

    // ── ETH donut ─────────────────────────────────────────
    renderDonutChartTo(
        document.getElementById('portfolio-chart'),
        loadedWallets,
        pm.totalEth,
        'sub-accounts-panel'
        // defaults: balanceKey='balance', centerLabel='ETH'
    );
    renderDonutLegend('legend-eth', loadedWallets,
        pm.totalEth, 'balance', v => v.toFixed(4) + ' ETH');

    // ── USDT donut ────────────────────────────────────────
    renderDonutChartTo(
        document.getElementById('portfolio-usdt-chart'),
        loadedWallets,
        pm.totalUsdt,
        'sub-accounts-panel',
        {
            balanceKey:  'usdt_balance',
            centerLabel: 'USDT',
            centerFmt:   v => fmtUsdt(v) ?? '0.00',
        }
    );
    renderDonutLegend('legend-usdt', loadedWallets,
        pm.totalUsdt, 'usdt_balance',
        v => v.toLocaleString('en-US',
          { maximumFractionDigits: 0 }) + ' USDT');

    // ── USD donut (only when ETH price is available) ──────
    if (pm.totalUsd != null) {
        renderDonutChartTo(
            document.getElementById('portfolio-usd-chart'),
            loadedWallets,
            pm.totalUsd,
            'sub-accounts-panel',
            {
                balanceKey:  'total_usd',
                centerLabel: 'USD',
                centerFmt:   fmtUsdCompact,
            }
        );
        renderDonutLegend('legend-usd', loadedWallets,
            pm.totalUsd, 'total_usd', fmtUsdCompact);
    } else {
        const el = document.getElementById('portfolio-usd-chart');
        if (el) el.innerHTML = '';   // clear stale content
        const legendUsd = document.getElementById('legend-usd');
        if (legendUsd) legendUsd.innerHTML = '';
    }

    // ── Pricing legend ────────────────────────────────────
    const legendEl    = document.getElementById('portfolio-pricing-legend');
    const ethPriceStr = ethUsdPrice  != null
        ? '$' + ethUsdPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : 'unavailable';
    const usdtStr     = usdtUsdPrice != null
        ? usdtUsdPrice.toFixed(4)
        : '1.0000 (peg)';

    const timestampHtml = fmtLegendTimestamp(pricesFetchedAt);

    legendEl.innerHTML = `
        <span class="pricing-legend-label">Pricing basis</span>
        <span class="pricing-legend-item">
            <span class="pricing-legend-token">ETH/USD</span>
            <span class="pricing-legend-value">${ethPriceStr}</span>
        </span>
        <span class="pricing-legend-item">
            <span class="pricing-legend-token">USDT/USD</span>
            <span class="pricing-legend-value">${usdtStr}</span>
        </span>
        <span class="pricing-legend-source">CoinGecko</span>
        ${timestampHtml}`;
    legendEl.classList.remove('hidden');

    document.getElementById('portfolio-view').classList.remove('hidden');
    setStep(2);
}

// ── Step 3: Build Pooling Setup ───────────────────────────
function buildPoolingSetup(wallets) {
    const tbody = document.getElementById('pooling-body');
    tbody.innerHTML = '';

    wallets.forEach((wallet, index) => {
        const isMaster  = wallet.role === 'master';
        const roleClass = isMaster ? 'role-master' : 'role-sub';
        const roleName  = isMaster ? 'Master' : 'Sub';
        const usdt      = wallet.usdt_balance != null ? wallet.usdt_balance.toFixed(2) : '0.00';

        const row = document.createElement('tr');
        row.dataset.index   = index;
        row.dataset.address = wallet.address;
        row.dataset.role    = wallet.role;

        // ETH/USD toggle — only when ETH price is available
        const ethToggleBtn = ethUsdPrice
            ? '<button class="currency-toggle" onclick="toggleTargetCurrency(this)" disabled>ETH</button>'
            : '';
        // USDT/USD toggle — always available (usdtRate() always returns a value)
        const usdtToggleBtn =
            '<button class="currency-toggle" onclick="toggleUsdtTargetCurrency(this)" disabled>USDT</button>';

        if (isMaster) {
            row.innerHTML = `
                <td>${walletIdHtml(wallet)}</td>
                <td><span class="badge ${roleClass}">${roleName}</span></td>
                <td class="cell-num">${wallet.balance.toFixed(4)} ETH</td>
                <td>
                    <div class="pool-config">
                        <select class="mode-select master-mode-select"
                            onchange="toggleMasterTarget(this)">
                            <option value="hub">Hub (no minimum)</option>
                            <option value="minimum">Minimum Balance</option>
                        </select>
                        <div class="target-field">
                            <div class="target-input-row">
                                <input type="number" class="target-input master-target-input"
                                    placeholder="Min ETH" step="0.0001" min="0" disabled
                                    data-currency="eth" oninput="updateConversionHint(this)" />
                                ${ethToggleBtn}
                            </div>
                            <span class="conversion-hint"></span>
                        </div>
                    </div>
                </td>
                <td class="cell-num">${usdt} USDT</td>
                <td>
                    <div class="pool-config">
                        <select class="mode-select master-usdt-mode-select"
                            onchange="toggleMasterUsdtTarget(this)">
                            <option value="hub">Hub (no minimum)</option>
                            <option value="minimum">Minimum Balance</option>
                        </select>
                        <div class="target-field">
                            <div class="target-input-row">
                                <input type="number" class="target-input master-usdt-target-input"
                                    placeholder="Min USDT" step="0.01" min="0" disabled
                                    data-currency="usdt" oninput="updateUsdtConversionHint(this)" />
                                ${usdtToggleBtn}
                            </div>
                            <span class="conversion-hint"></span>
                        </div>
                    </div>
                </td>`;
        } else {
            row.innerHTML = `
                <td>${walletIdHtml(wallet)}</td>
                <td><span class="badge ${roleClass}">${roleName}</span></td>
                <td class="cell-num">${wallet.balance.toFixed(4)} ETH</td>
                <td>
                    <div class="pool-config">
                        <select class="mode-select eth-mode-select"
                            onchange="toggleTarget(this)">
                            <option value="zero">Zero Balance</option>
                            <option value="target">Target Balance</option>
                        </select>
                        <div class="target-field">
                            <div class="target-input-row">
                                <input type="number" class="target-input sub-target-input"
                                    placeholder="e.g. 1.0" step="0.0001" min="0" disabled
                                    data-currency="eth" oninput="updateConversionHint(this)" />
                                ${ethToggleBtn}
                            </div>
                            <span class="conversion-hint"></span>
                        </div>
                    </div>
                </td>
                <td class="cell-num">${usdt} USDT</td>
                <td>
                    <div class="pool-config">
                        <select class="mode-select usdt-mode-select"
                            onchange="toggleUsdtTarget(this)">
                            <option value="zero">Zero Balance</option>
                            <option value="target">Target Balance</option>
                        </select>
                        <div class="target-field">
                            <div class="target-input-row">
                                <input type="number" class="target-input sub-usdt-target-input"
                                    placeholder="e.g. 5,000" step="0.01" min="0" disabled
                                    data-currency="usdt" oninput="updateUsdtConversionHint(this)" />
                                ${usdtToggleBtn}
                            </div>
                            <span class="conversion-hint"></span>
                        </div>
                    </div>
                </td>`;
        }
        tbody.appendChild(row);
    });

    document.getElementById('pooling-setup').classList.remove('hidden');
    setStep(3);
}

function toggleTarget(select) {
    const row    = select.closest('.pool-config');
    const input  = row.querySelector('.sub-target-input');
    const toggle = row.querySelector('.currency-toggle');
    const hint   = row.querySelector('.conversion-hint');
    const enable = select.value === 'target';

    input.disabled = !enable;
    if (toggle) toggle.disabled = !enable;
    input.value = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    if (enable) input.focus();
}

function toggleMasterTarget(select) {
    const row    = select.closest('.pool-config');
    const input  = row.querySelector('.master-target-input');
    const toggle = row.querySelector('.currency-toggle');
    const hint   = row.querySelector('.conversion-hint');
    const enable = select.value === 'minimum';

    input.disabled = !enable;
    if (toggle) toggle.disabled = !enable;
    input.value = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    if (enable) input.focus();
}

function toggleUsdtTarget(select) {
    const row    = select.closest('.pool-config');
    const input  = row.querySelector('.sub-usdt-target-input');
    const toggle = row.querySelector('.currency-toggle');
    const hint   = row.querySelector('.conversion-hint');
    const enable = select.value === 'target';

    input.disabled = !enable;
    if (toggle) toggle.disabled = !enable;
    input.value = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    if (enable) input.focus();
}

function toggleMasterUsdtTarget(select) {
    const row    = select.closest('.pool-config');
    const input  = row.querySelector('.master-usdt-target-input');
    const toggle = row.querySelector('.currency-toggle');
    const hint   = row.querySelector('.conversion-hint');
    const enable = select.value === 'minimum';

    input.disabled = !enable;
    if (toggle) toggle.disabled = !enable;
    input.value = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    if (enable) input.focus();
}

// Switch a target input between ETH and USD entry modes
function toggleTargetCurrency(btn) {
    const input  = btn.previousElementSibling;
    const hint   = btn.closest('.target-field').querySelector('.conversion-hint');
    const toUsd  = input.dataset.currency !== 'usd';

    input.dataset.currency = toUsd ? 'usd' : 'eth';
    btn.textContent        = toUsd ? 'USD' : 'ETH';
    btn.classList.toggle('active', toUsd);
    input.placeholder      = toUsd
        ? 'e.g. 1,000'
        : (input.classList.contains('master-target-input') ? 'Min ETH' : 'e.g. 1.0');
    input.step             = toUsd ? '1' : '0.0001';
    input.value            = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    input.focus();
}

// Switch a USDT target input between USDT and USD entry modes
function toggleUsdtTargetCurrency(btn) {
    const input   = btn.previousElementSibling;
    const hint    = btn.closest('.target-field').querySelector('.conversion-hint');
    const toUsd   = input.dataset.currency !== 'usd';

    input.dataset.currency = toUsd ? 'usd' : 'usdt';
    btn.textContent        = toUsd ? 'USD' : 'USDT';
    btn.classList.toggle('active', toUsd);
    input.placeholder      = toUsd
        ? 'e.g. 5,000'
        : (input.classList.contains('master-usdt-target-input') ? 'Min USDT' : 'e.g. 5,000');
    input.step             = toUsd ? '1' : '0.01';
    input.value            = '';
    if (hint) { hint.textContent = ''; hint.style.display = 'none'; }
    input.focus();
}

// Show live USDT↔USD conversion hint below the USDT target input
function updateUsdtConversionHint(input) {
    const field = input.closest('.target-field');
    if (!field) return;
    const hint = field.querySelector('.conversion-hint');
    if (!hint) return;

    const val = parseFloat(input.value);
    if (!val || val <= 0) {
        hint.textContent   = '';
        hint.style.display = 'none';
        return;
    }

    const rate = usdtRate();
    if (input.dataset.currency === 'usd') {
        hint.textContent = '≈ ' + (val / rate).toFixed(2) + ' USDT';
    } else {
        const usd = val * rate;
        hint.textContent = '≈ $' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    hint.style.display = 'block';
}

// Show live ETH↔USD conversion hint below the target input
function updateConversionHint(input) {
    const field = input.closest('.target-field');
    if (!field || !ethUsdPrice) return;
    const hint = field.querySelector('.conversion-hint');
    if (!hint) return;

    const val = parseFloat(input.value);
    if (!val || val <= 0) {
        hint.textContent  = '';
        hint.style.display = 'none';
        return;
    }

    if (input.dataset.currency === 'usd') {
        hint.textContent = '≈ ' + (val / ethUsdPrice).toFixed(4) + ' ETH';
    } else {
        const usd = val * ethUsdPrice;
        hint.textContent = '≈ $' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    hint.style.display = 'block';
}

// ── Step 4: Pool ──────────────────────────────────────────
document.getElementById('pool-btn').addEventListener('click', runPool);

async function runPool() {
    const errorEl = document.getElementById('pool-error');
    const poolBtn = document.getElementById('pool-btn');
    errorEl.textContent = '';

    // Reset plan age state so a stale ticker from a previous run never carries over.
    if (planStalenessInterval) { clearInterval(planStalenessInterval); planStalenessInterval = null; }
    planGeneratedAt = null;

    const wallets = [];
    document.querySelectorAll('#pooling-body tr').forEach(row => {
        const address = row.dataset.address;
        const role    = row.dataset.role;

        // Pass the already-loaded balances so the backend can skip its second
        // Etherscan round-trip.  A re-fetch can silently return 0 for USDT
        // (rate-limit / transient error), which causes USDT to vanish from the
        // transfer plan even when wallets genuinely hold USDT.
        const loaded      = loadedWallets.find(
            w => w.address.toLowerCase() === address.toLowerCase());
        const balance     = loaded?.balance      ?? null;
        const usdtBalance = loaded?.usdt_balance ?? null;

        if (role === 'master') {
            // ETH config
            const ethMode = row.querySelector('.master-mode-select').value;
            let ethTarget = 0;
            if (ethMode === 'minimum') {
                const inp = row.querySelector('.master-target-input');
                const raw = parseFloat(inp.value) || 0;
                ethTarget = inp.dataset.currency === 'usd' && ethUsdPrice
                    ? raw / ethUsdPrice : raw;
            }
            // USDT config
            const usdtMode = row.querySelector('.master-usdt-mode-select').value;
            let usdtTarget = 0;
            if (usdtMode === 'minimum') {
                const inp = row.querySelector('.master-usdt-target-input');
                const raw = parseFloat(inp.value) || 0;
                usdtTarget = inp.dataset.currency === 'usd' ? raw / usdtRate() : raw;
            }

            wallets.push({ address, role, mode: null, target: ethTarget,
                           usdt_mode: null, usdt_target: usdtTarget,
                           balance, usdt_balance: usdtBalance });
        } else {
            // ETH config
            const ethMode = row.querySelector('.eth-mode-select').value;
            let ethTarget = 0;
            if (ethMode === 'target') {
                const inp = row.querySelector('.sub-target-input');
                const raw = parseFloat(inp.value) || 0;
                ethTarget = inp.dataset.currency === 'usd' && ethUsdPrice
                    ? raw / ethUsdPrice : raw;
            }
            // USDT config
            const usdtMode = row.querySelector('.usdt-mode-select').value;
            let usdtTarget = 0;
            if (usdtMode === 'target') {
                const inp = row.querySelector('.sub-usdt-target-input');
                const raw = parseFloat(inp.value) || 0;
                usdtTarget = inp.dataset.currency === 'usd' ? raw / usdtRate() : raw;
            }

            wallets.push({ address, role, mode: ethMode, target: ethTarget,
                           usdt_mode: usdtMode, usdt_target: usdtTarget,
                           balance, usdt_balance: usdtBalance });
        }
    });

    lastPoolConfig = wallets.map(w => ({ ...w })); // snapshot before API call

    setLoading(poolBtn, true);

    try {
        const [response] = await Promise.all([
            fetch('/api/pool', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ wallets }),
            }),
            fetchGasPrice(),   // refresh gas price in parallel — no extra latency
        ]);
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = 'Server error. Please try again.'; return; }
        lastPoolResult  = data;
        planGeneratedAt = new Date();
        displayResults(data);
        updateFeedLastRun();
    } catch (err) {
        errorEl.textContent = 'Could not connect to server.';
    } finally {
        setLoading(poolBtn, false);
    }
}

// ── Step 4a: Transfer plan ────────────────────────────────
function displayResults(data) {
    const section     = document.getElementById('results-view');
    const infeasible  = document.getElementById('infeasible-msg');
    const transferDiv = document.getElementById('transfer-results');

    section.classList.remove('hidden');
    setStep(4);

    // Show infeasibility warnings (one or both tokens may be infeasible)
    const msgs = [];
    if (!data.eth_feasible)
        msgs.push(`ETH — Insufficient funds. Shortfall: ${data.eth_shortfall.toFixed(4)} ETH.`);
    if (!data.usdt_feasible)
        msgs.push(`USDT — Insufficient funds. Shortfall: ${fmtUsdt(data.usdt_shortfall)}.`);

    if (msgs.length > 0) {
        infeasible.innerHTML = msgs.join('<br>') +
            '<br><small>Increase the master balance or reduce subwallet targets.</small>';
        infeasible.classList.remove('hidden');
    } else {
        infeasible.classList.add('hidden');
    }

    transferDiv.classList.remove('hidden');

    const transfers   = data.transfers || [];
    const ethXfers    = transfers.filter(t => !t.token || t.token === 'ETH');
    const usdtXfers   = transfers.filter(t => t.token === 'USDT');
    const totalETH    = ethXfers.reduce((s, t) => s + t.amount, 0);
    const totalUSDT   = usdtXfers.reduce((s, t) => s + t.amount, 0);
    const affected    = new Set([...transfers.map(t => t.from), ...transfers.map(t => t.to)]).size;

    // ── Phase 6A: Hub card ────────────────────────────────────
    (function renderHubCard() {
        const hubEl = document.getElementById('hub-card');
        if (!hubEl) return;

        const master = loadedWallets.find(w => w.role === 'master');
        if (!master) { hubEl.classList.add('hidden'); return; }

        // Gross flows from master perspective
        const ethIn   = transfers
            .filter(t => t.token !== 'USDT' &&
                         t.to.toLowerCase() === master.address.toLowerCase())
            .reduce((s, t) => s + t.amount, 0);
        const ethOut  = transfers
            .filter(t => t.token !== 'USDT' &&
                         t.from.toLowerCase() === master.address.toLowerCase())
            .reduce((s, t) => s + t.amount, 0);
        const usdtIn  = transfers
            .filter(t => t.token === 'USDT' &&
                         t.to.toLowerCase() === master.address.toLowerCase())
            .reduce((s, t) => s + t.amount, 0);
        const usdtOut = transfers
            .filter(t => t.token === 'USDT' &&
                         t.from.toLowerCase() === master.address.toLowerCase())
            .reduce((s, t) => s + t.amount, 0);

        const collectsUsd = ethToUsd(ethIn) != null
            ? r2(ethToUsd(ethIn) + usdtIn * usdtRate()) : null;
        const coversUsd   = ethToUsd(ethOut) != null
            ? r2(ethToUsd(ethOut) + usdtOut * usdtRate()) : null;

        const fmtDelta = (v, dp) => v === 0 ? null
            : `${v > 0 ? '+' : ''}${v.toFixed(dp)}`;

        const masterLabel = _masterLabel || 'Master Wallet';
        const masterShort = master.address.slice(0, 6) + '…' + master.address.slice(-4);

        hubEl.innerHTML = `
      <div class="hub-card-inner">
        <div class="hub-col hub-col-identity">
          <div class="hub-eyebrow">Rebalance Overview</div>
          <div class="hub-master-name">${masterLabel}</div>
          <div class="hub-master-addr">${masterShort}</div>
          <div class="hub-master-desc">
            Hub wallet — absorbs surplus from sub-wallets and covers their deficits.
          </div>
        </div>
        <div class="hub-col hub-col-collects">
          <div class="hub-col-label">COLLECTS FROM SUB-WALLETS</div>
          <div class="hub-flow-value hub-positive">${
            collectsUsd != null
                ? '+' + fmtUsdCompact(collectsUsd)
                : ethIn > 0 || usdtIn > 0 ? '—' : '$0'}</div>
          <div class="hub-delta-row">
            <span class="hub-delta-token">ETH in</span>
            <span class="hub-delta-val">+${ethIn.toFixed(4)}</span>
          </div>
          <div class="hub-delta-row">
            <span class="hub-delta-token">USDT in</span>
            <span class="hub-delta-val">+${usdtIn.toFixed(2)}</span>
          </div>
        </div>
        <div class="hub-col hub-col-covers">
          <div class="hub-col-label">COVERS SUB-WALLET DEFICITS</div>
          <div class="hub-flow-value hub-accent">${
            coversUsd != null
                ? '−' + fmtUsdCompact(coversUsd)
                : ethOut > 0 || usdtOut > 0 ? '—' : '$0'}</div>
          <div class="hub-delta-row">
            <span class="hub-delta-token">ETH out</span>
            <span class="hub-delta-val hub-accent">−${ethOut.toFixed(4)}</span>
          </div>
          <div class="hub-delta-row">
            <span class="hub-delta-token">USDT out</span>
            <span class="hub-delta-val hub-accent">−${usdtOut.toFixed(2)}</span>
          </div>
        </div>
      </div>`;

        hubEl.classList.remove('hidden');
    })();
    // ── /Phase 6A ─────────────────────────────────────────────

    // Sort transfers and run gas analysis
    const typeLabels = {
        sub_to_sub:     { label: 'Sub → Sub',    css: 'type-sub-sub'    },
        sub_to_master:  { label: 'Sub → Master', css: 'type-sub-master' },
        master_to_sub:  { label: 'Master → Sub', css: 'type-master-sub' },
    };
    const typeOrder  = { sub_to_sub: 1, sub_to_master: 2, master_to_sub: 3 };
    const tokenOrder = t => t.token === 'USDT' ? 1 : 0;
    const sorted     = [...transfers].sort((a, b) =>
        tokenOrder(a) - tokenOrder(b) || typeOrder[a.type] - typeOrder[b.type]
    );
    const gasAnalysis = analyzeGas(sorted);   // null when gas price unavailable

    // Stat cards (gas stat added when available)
    document.getElementById('results-summary').innerHTML = `
        <div class="stat-card">
            <div class="stat-card-value">${transfers.length}</div>
            <div class="stat-card-label">Transfers</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-value">${totalETH.toFixed(4)}</div>
            <div class="stat-card-label">ETH Moved</div>
        </div>
        ${totalUSDT > 0 ? `
        <div class="stat-card">
            <div class="stat-card-value">${fmtUsdt(totalUSDT)}</div>
            <div class="stat-card-label">USDT Moved</div>
        </div>` : ''}
        <div class="stat-card">
            <div class="stat-card-value">${affected || '—'}</div>
            <div class="stat-card-label">Wallets Affected</div>
        </div>
        ${gasAnalysis?.totalGasUsd != null ? `
        <div class="stat-card">
            <div class="stat-card-value">${fmtGasUsd(gasAnalysis.totalGasUsd)}</div>
            <div class="stat-card-label">Est. Gas Fee</div>
        </div>` : ''}`;

    // Gas validation alerts
    const gasAlertsEl = document.getElementById('gas-alerts');
    if (gasAlertsEl && gasAnalysis) {
        let alertsHtml = '';
        if (gasAnalysis.hasInsufficient) {
            const rows = Object.values(gasAnalysis.insufficientGas)
                .map(w => `<strong>${w.name}</strong> — ${w.balance.toFixed(4)} ETH available, `
                         + `~${fmtGasEth(w.needed)} needed (gas shortfall: ${fmtGasEth(w.shortfall)})`)
                .join('<br>');
            alertsHtml += `<div class="alert alert-warning" style="margin-bottom:8px;">
                ⛽ ETH balance insufficient to cover transfer + gas:<br>${rows}<br>
                <small>For full-sweep wallets, reduce the transfer amount by the gas shortfall before executing.</small>
            </div>`;
        }
        if (gasAnalysis.hasUneconomical) {
            const n = gasAnalysis.txGas.filter(t => t.uneconomical).length;
            alertsHtml += `<div class="alert alert-warning">
                ⚠ ${n} transfer${n > 1 ? 's' : ''} where estimated gas exceeds the transfer value.
                Review these transfers before executing.
            </div>`;
        }
        gasAlertsEl.innerHTML = alertsHtml;
    }

    // Plan-age timestamp — remove any leftover from a previous render then rebuild.
    document.getElementById('plan-stale-banner')?.remove();
    document.getElementById('plan-age')?.remove();
    if (planGeneratedAt && gasAlertsEl) {
        gasAlertsEl.insertAdjacentHTML('beforebegin',
            `<div id="plan-age" class="pricing-legend" style="margin-bottom:6px;">` +
            `<span class="pricing-legend-label">Plan</span>` +
            fmtLegendTimestamp(planGeneratedAt) +
            `</div>`);
    }

    // ── Phase 6B: Grouped transaction cards ──────────────────
    const listEl   = document.getElementById('transfer-list');
    const execNote = document.getElementById('transfer-exec-note');

    if (!listEl) return;
    listEl.innerHTML = '';

    if (sorted.length === 0) {
        if (execNote) execNote.classList.add('hidden');
        listEl.innerHTML = `
            <div class="tx-empty">
                <div class="tx-empty-icon">✓</div>
                <div class="tx-empty-text">
                    All wallets are already at target.
                    No transfers required.
                </div>
            </div>`;
    } else {
        if (execNote) execNote.classList.remove('hidden');

        // Define phase groups in render order
        const phaseGroups = [
            { token: 'ETH',  type: 'sub_to_sub',
              label: 'ETH · SUB TO SUB',              dot: 'var(--accent)' },
            { token: 'ETH',  type: 'sub_to_master',
              label: 'ETH · COLLECT INTO MASTER',     dot: 'var(--positive)' },
            { token: 'ETH',  type: 'master_to_sub',
              label: 'ETH · DISTRIBUTE FROM MASTER',  dot: 'var(--accent)' },
            { token: 'USDT', type: 'sub_to_sub',
              label: 'USDT · SUB TO SUB',             dot: 'var(--accent)' },
            { token: 'USDT', type: 'sub_to_master',
              label: 'USDT · COLLECT INTO MASTER',    dot: 'var(--positive)' },
            { token: 'USDT', type: 'master_to_sub',
              label: 'USDT · DISTRIBUTE FROM MASTER', dot: 'var(--accent)' },
        ];

        let globalIndex = 1;

        phaseGroups.forEach(group => {
            const groupXfers = sorted.filter(t =>
                (t.token || 'ETH') === group.token && t.type === group.type
            );
            if (groupXfers.length === 0) return;

            // Phase header
            const header = document.createElement('div');
            header.className = 'tx-phase-header';
            header.innerHTML = `
                <span class="tx-phase-dot"
                      style="background:${group.dot}"></span>
                ${group.label}`;
            listEl.appendChild(header);

            // Transfer cards for this group
            groupXfers.forEach(t => {
                const token  = t.token || 'ETH';
                const gasRow = gasAnalysis
                    ? (() => {
                          const tGas = gasAnalysis.txGas.find(
                              g => g.from === t.from &&
                                   g.to   === t.to   &&
                                   g.amount === t.amount &&
                                   (g.token || 'ETH') === token);
                          if (!tGas) return '';
                          const gasStr = tGas.gasUsd != null
                              ? fmtGasUsd(tGas.gasUsd)
                              : `${GAS_LIMITS[token]?.toLocaleString() ?? '—'} gas`;
                          const badge = tGas.uneconomical
                              ? ' <span class="gas-uneconomical-badge">⚠ uneconomical</span>'
                              : '';
                          return `<div class="tx-gas">⛽ ${GAS_LIMITS[token]?.toLocaleString() ?? '—'} gas · ${gasStr}${badge}</div>`;
                      })()
                    : '';

                const fromHtml = walletIdHtmlByAddr(t.from);
                const toHtml   = walletIdHtmlByAddr(t.to);
                const amtDp    = token === 'USDT' ? 2 : 4;
                const amtStr   = t.amount.toFixed(amtDp) + ' ' + token;
                const usdStr   = token === 'ETH' && ethUsdPrice
                    ? '≈ ' + fmtUsdCompact(t.amount * ethUsdPrice)
                    : token === 'USDT'
                    ? '≈ ' + fmtUsdCompact(t.amount * usdtRate())
                    : '';

                const card = document.createElement('div');
                card.className = 'tx-card';
                card.innerHTML = `
                    <div class="tx-index">${globalIndex}</div>
                    <div class="tx-from">
                        <div class="tx-block-eyebrow">FROM</div>
                        <div class="tx-block-name">${fromHtml}</div>
                    </div>
                    <div class="tx-arrow">→</div>
                    <div class="tx-to">
                        <div class="tx-block-eyebrow">TO</div>
                        <div class="tx-block-name">${toHtml}</div>
                    </div>
                    <div class="tx-amount">
                        <div class="tx-amount-val">${amtStr}</div>
                        ${usdStr ? `<div class="tx-amount-usd">${usdStr}</div>` : ''}
                        ${gasRow}
                    </div>`;
                listEl.appendChild(card);
                globalIndex++;
            });
        });
    }
    // ── /Phase 6B ─────────────────────────────────────────────

    // Gas legend — pricing-basis style with gas price, limits and timestamp
    const gasLegendEl = document.getElementById('gas-legend');
    if (gasLegendEl) {
        if (gasAnalysis) {
            const liveGwei   = gasPriceGwei ?? GAS_PRICE_FALLBACK_GWEI;
            const isFallback = gasPriceGwei == null;
            gasLegendEl.innerHTML = `
                <span class="pricing-legend-label">Gas basis</span>
                <span class="pricing-legend-item">
                    <span class="pricing-legend-token">Gas Price</span>
                    <span class="pricing-legend-value">${liveGwei.toFixed(3)} Gwei${isFallback ? ' (fallback)' : ''}</span>
                </span>
                <span class="pricing-legend-item">
                    <span class="pricing-legend-token">ETH tx</span>
                    <span class="pricing-legend-value">${GAS_LIMITS.ETH.toLocaleString()} gas</span>
                </span>
                <span class="pricing-legend-item">
                    <span class="pricing-legend-token">ERC-20 tx</span>
                    <span class="pricing-legend-value">${GAS_LIMITS.USDT.toLocaleString()} gas</span>
                </span>
                <span class="pricing-legend-source">Etherscan</span>
                ${fmtLegendTimestamp(gasPriceFetchedAt)}`;
            gasLegendEl.classList.remove('hidden');
        } else {
            gasLegendEl.innerHTML = '';
            gasLegendEl.classList.add('hidden');
        }
    }

    // Gas disclaimer notice
    const gasNoticeEl = document.getElementById('gas-notice');
    if (gasNoticeEl) {
        if (gasAnalysis) {
            gasNoticeEl.innerHTML =
                '⛽ Gas fee estimates are indicative only and may vary based on network usage at execution time.';
            gasNoticeEl.classList.remove('hidden');
        } else {
            gasNoticeEl.innerHTML = '';
            gasNoticeEl.classList.add('hidden');
        }
    }

    // Plan staleness ticker — updates the age badge every 60 s; warns after 15 min.
    if (planStalenessInterval) { clearInterval(planStalenessInterval); planStalenessInterval = null; }
    if (planGeneratedAt) {
        planStalenessInterval = setInterval(() => {
            const planAgeEl = document.getElementById('plan-age');
            if (!planAgeEl || !planGeneratedAt) {
                clearInterval(planStalenessInterval);
                planStalenessInterval = null;
                return;
            }
            const ageMin = Math.floor((Date.now() - planGeneratedAt.getTime()) / 60000);
            planAgeEl.innerHTML =
                `<span class="pricing-legend-label">Plan</span>` +
                fmtLegendTimestamp(planGeneratedAt);
            if (ageMin > 15) {
                planAgeEl.classList.add('alert-warning');
                let bannerEl = document.getElementById('plan-stale-banner');
                if (!bannerEl) {
                    bannerEl = document.createElement('div');
                    bannerEl.id        = 'plan-stale-banner';
                    bannerEl.className = 'alert alert-warning';
                    planAgeEl.insertAdjacentElement('afterend', bannerEl);
                }
                bannerEl.textContent =
                    `⚠ Plan is ${ageMin} minutes old. Refresh and re-run before executing.`;
            }
        }, 60000);
    }

    // After-transfer portfolio view
    renderAfterPortfolio(data);
}

// ── Step 4b: After-Transfer Portfolio View ────────────────
function renderAfterPortfolio(data) {
    if (!data.summary || data.summary.length === 0) return;

    // ── Phase 6C: Normalise for portfolioMetrics ──────────
    const summaryForMetrics = data.summary.map(w => ({
        ...w,
        balance:      w.post,
        usdt_balance: w.usdt_post ?? 0,
        error:        null,
    }));
    const pm          = portfolioMetrics(summaryForMetrics);
    const masterEntry = data.summary.find(w => w.role === 'master');
    const subEntries  = data.summary.filter(w => w.role === 'sub');

    // ── Section header ────────────────────────────────────
    const headerEl = document.getElementById('after-master-overview');
    if (headerEl) {
        headerEl.innerHTML = `
            <div class="after-section-header">
                <div class="after-section-title">Post-rebalance check</div>
                <div class="after-section-sub">Projected balances after all transfers execute.</div>
            </div>`;
    }

    // ── Projected wallets table ───────────────────────────
    const tableContainer = document.getElementById('after-sub-accounts');
    if (tableContainer) {

        const masterColor       = MASTER_CHART_COLOR;
        const masterShort       = masterEntry.address.slice(0,6) + '…' + masterEntry.address.slice(-4);
        const masterPostEthUsd  = ethToUsd(masterEntry.post);
        const masterPostUsdtUsd = r2((masterEntry.usdt_post ?? 0) * usdtRate());
        const masterPostTotalUsd = masterPostEthUsd != null
            ? r2(masterPostEthUsd + masterPostUsdtUsd) : null;

        const masterEthDelta  = masterEntry.delta ?? 0;
        const masterUsdtDelta = masterEntry.usdt_delta ?? 0;

        const fmtDeltaPill = (val, dp, suffix) => {
            if (val === 0) return '<span class="wt-delta-flat">—</span>';
            const cls  = val > 0 ? 'delta-positive' : 'delta-negative';
            const sign = val > 0 ? '+' : '';
            return `<span class="${cls}">${sign}${val.toFixed(dp)}${suffix ? ' ' + suffix : ''}</span>`;
        };

        tableContainer.innerHTML = `
            <table class="wallets-table">
                <thead>
                    <tr>
                        <th class="wt-col-wallet">Wallet</th>
                        <th class="wt-col-num">ETH (proj)</th>
                        <th class="wt-col-num">Δ ETH</th>
                        <th class="wt-col-num pt-col-divider">USDT (proj)</th>
                        <th class="wt-col-num">Δ USDT</th>
                        <th class="wt-col-num">Value (proj)</th>
                    </tr>
                </thead>
                <tbody id="after-wallets-tbody">
                    <tr class="wt-row wt-row-master" data-address="${masterEntry.address}">
                        <td class="wt-col-wallet">
                            <span class="wt-dot" style="background:${masterColor}"></span>
                            <span class="wt-identity">
                                <span class="wt-name">
                                    ${_masterLabel || 'Master Wallet'}
                                    <span class="master-badge">★ MASTER</span>
                                </span>
                                <span class="wt-addr">${masterShort}</span>
                            </span>
                        </td>
                        <td class="wt-col-num">
                            <span class="wt-bal">${masterEntry.post.toFixed(4)}</span>
                            ${masterPostEthUsd != null
                                ? `<br><span class="wt-usd">${fmtDollars(masterPostEthUsd)}</span>`
                                : ''}
                        </td>
                        <td class="wt-col-num">${fmtDeltaPill(masterEthDelta, 4, '')}</td>
                        <td class="wt-col-num pt-col-divider">
                            <span class="wt-bal">${(masterEntry.usdt_post ?? 0).toFixed(2)}</span>
                            ${masterPostUsdtUsd != null
                                ? `<br><span class="wt-usd">${fmtDollars(masterPostUsdtUsd)}</span>`
                                : ''}
                        </td>
                        <td class="wt-col-num">${fmtDeltaPill(masterUsdtDelta, 2, '')}</td>
                        <td class="wt-col-num wt-col-value">
                            ${masterPostTotalUsd != null ? fmtDollars(masterPostTotalUsd) : '—'}
                        </td>
                    </tr>
                </tbody>
            </table>`;

        const tbody = document.getElementById('after-wallets-tbody');
        subEntries.forEach(w => {
            const color        = getWalletColor(w.address);
            const short        = w.address.slice(0,6) + '…' + w.address.slice(-4);
            const postEthUsd   = ethToUsd(w.post);
            const postUsdtUsd  = r2((w.usdt_post ?? 0) * usdtRate());
            const postTotalUsd = postEthUsd != null ? r2(postEthUsd + postUsdtUsd) : null;
            const ethDelta     = w.delta ?? 0;
            const usdtDelta    = w.usdt_delta ?? 0;
            const lw           = loadedWallets.find(
                x => x.address.toLowerCase() === w.address.toLowerCase());
            const walletName   = lw?.label || '';

            const tr = document.createElement('tr');
            tr.className       = 'wt-row';
            tr.dataset.address = w.address;
            tr.innerHTML = `
                <td class="wt-col-wallet">
                    <span class="wt-dot" style="background:${color}"></span>
                    <span class="wt-identity">
                        <span class="wt-name">${walletName}</span>
                        <span class="wt-addr">${short}</span>
                    </span>
                </td>
                <td class="wt-col-num">
                    <span class="wt-bal">${w.post.toFixed(4)}</span>
                    ${postEthUsd != null
                        ? `<br><span class="wt-usd">${fmtDollars(postEthUsd)}</span>`
                        : ''}
                </td>
                <td class="wt-col-num">${fmtDeltaPill(ethDelta, 4, '')}</td>
                <td class="wt-col-num pt-col-divider">
                    <span class="wt-bal">${(w.usdt_post ?? 0).toFixed(2)}</span>
                    ${postUsdtUsd != null
                        ? `<br><span class="wt-usd">${fmtDollars(postUsdtUsd)}</span>`
                        : ''}
                </td>
                <td class="wt-col-num">${fmtDeltaPill(usdtDelta, 2, '')}</td>
                <td class="wt-col-num wt-col-value">
                    ${postTotalUsd != null ? fmtDollars(postTotalUsd) : '—'}
                </td>`;
            tbody.appendChild(tr);
        });
    }

    // ── Projected donut charts ────────────────────────────
    const afterWallets = data.summary.map(w => {
        const postEthUsd   = ethToUsd(w.post);
        const postUsdtUsd  = r2((w.usdt_post ?? 0) * usdtRate());
        const postTotalUsd = postEthUsd != null ? r2(postEthUsd + postUsdtUsd) : null;
        const lw           = loadedWallets.find(
            x => x.address.toLowerCase() === w.address.toLowerCase());
        return {
            address:      w.address,
            balance:      w.post,
            usdt_balance: w.usdt_post ?? 0,
            total_usd:    postTotalUsd,
            role:         w.role,
            label:        lw?.label || '',
            _color:       w.role === 'master' ? MASTER_CHART_COLOR : getWalletColor(w.address),
            error:        null,
        };
    });

    renderDonutChartTo(
        document.getElementById('after-chart'),
        afterWallets, pm.totalEth, 'after-sub-accounts'
    );
    renderDonutLegend(
        'after-legend-eth', afterWallets,
        pm.totalEth, 'balance',
        v => v.toFixed(4) + ' ETH'
    );

    renderDonutChartTo(
        document.getElementById('after-usdt-chart'),
        afterWallets, pm.totalUsdt, 'after-sub-accounts',
        { balanceKey: 'usdt_balance', centerLabel: 'USDT', centerFmt: v => fmtUsdt(v) ?? '0.00' }
    );
    renderDonutLegend(
        'after-legend-usdt', afterWallets,
        pm.totalUsdt, 'usdt_balance',
        v => v.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' USDT'
    );

    if (pm.totalUsd != null) {
        renderDonutChartTo(
            document.getElementById('after-usd-chart'),
            afterWallets, pm.totalUsd, 'after-sub-accounts',
            { balanceKey: 'total_usd', centerLabel: 'USD', centerFmt: fmtUsdCompact }
        );
        renderDonutLegend(
            'after-legend-usd', afterWallets,
            pm.totalUsd, 'total_usd', fmtUsdCompact
        );
    } else {
        const el  = document.getElementById('after-usd-chart');
        if (el)  el.innerHTML = '';
        const leg = document.getElementById('after-legend-usd');
        if (leg) leg.innerHTML = '';
    }

    // ── Show the section ──────────────────────────────────
    document.getElementById('after-view')?.classList.remove('hidden');
}

// ── PDF Report ────────────────────────────────────────────

function generatePDF() {
    if (!lastPoolResult || !loadedWallets.length) return;
    const btn = document.getElementById('pdf-btn');
    btn.textContent = 'Generating…';
    btn.disabled = true;
    setTimeout(() => {
        try { _renderPDF(); } catch (e) { console.error('PDF error:', e); }
        btn.textContent = '⇩ PDF Report';
        btn.disabled = false;
    }, 30);
}

function _renderPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const PW = 210, PH = 297, M = 18, CW = 210 - 36, FOOT = 297 - 14;

    // ── Colour palette (RGB arrays) ───────────────────────
    const C = {
        primary:  [29,  78,  216],   // blue-700
        pDim:     [239, 246, 255],   // blue-50
        text:     [15,  23,  42 ],   // slate-900
        sub:      [71,  85,  105],   // slate-600
        line:     [226, 232, 240],   // slate-200
        bg:       [248, 250, 252],   // slate-50
        green:    [21,  128, 61 ],   // green-700
        gDim:     [240, 253, 244],   // green-50
        red:      [185, 28,  28 ],   // red-700
        rDim:     [254, 242, 242],   // red-50
        white:    [255, 255, 255],
    };

    let y = M;

    // ── Helpers ───────────────────────────────────────────

    const shorten = a => a.slice(0, 6) + '…' + a.slice(-4);

    function needSpace(h) {
        if (y + h > FOOT) { doc.addPage(); y = M; }
    }

    function rule(ly, thickness = 0.25, color = C.line) {
        doc.setDrawColor(...color);
        doc.setLineWidth(thickness);
        doc.line(M, ly, PW - M, ly);
    }

    function sectionBar(num, title) {
        needSpace(14);
        doc.setFillColor(...C.primary);
        doc.roundedRect(M, y, CW, 8.5, 1.5, 1.5, 'F');
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C.white);
        doc.text(`${num}   ${title.toUpperCase()}`, M + 4, y + 5.8);
        y += 13;
    }

    function miniStats(stats) {
        needSpace(18);
        const w = CW / stats.length;
        doc.setFillColor(...C.bg);
        doc.roundedRect(M, y, CW, 14, 2, 2, 'F');
        stats.forEach((s, i) => {
            const cx = M + i * w + w / 2;
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...(s.color || C.primary));
            doc.text(String(s.val), cx, y + 7, { align: 'center' });
            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...C.sub);
            doc.text(s.label.toUpperCase(), cx, y + 12, { align: 'center' });
        });
        y += 18;
    }

    function masterBox(wallet, total, mode) {
        const isAfter  = mode === 'after';
        const bal      = isAfter ? wallet.post : wallet.balance;
        const pct      = total > 0 ? (bal / total * 100).toFixed(1) : '0';
        const bg       = isAfter ? C.gDim    : C.pDim;
        const accent   = isAfter ? C.green   : C.primary;
        const badge    = isAfter ? 'AFTER TRANSFER' : 'MASTER WALLET';
        const badgeW   = isAfter ? 31 : 27;

        needSpace(32);
        doc.setFillColor(...bg);
        doc.setDrawColor(...accent);
        doc.setLineWidth(0.4);
        doc.roundedRect(M, y, CW, 27, 2, 2, 'FD');

        doc.setFillColor(...accent);
        doc.roundedRect(M + 4, y + 3.5, badgeW, 5, 1.2, 1.2, 'F');
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C.white);
        doc.text(badge, M + 6, y + 7.3);

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.sub);
        doc.text(shorten(wallet.address), M + 4, y + 15.5);

        doc.setFontSize(17);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C.text);
        doc.text(`${bal.toFixed(4)} ETH`, M + 4, y + 24.5);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...accent);
        doc.text(`${pct}%`, PW - M - 4, y + 14, { align: 'right' });
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.sub);
        doc.text('of portfolio', PW - M - 4, y + 20, { align: 'right' });

        if (isAfter && wallet.delta !== undefined) {
            const d     = wallet.delta;
            const dClr  = d > 0 ? C.green : d < 0 ? C.red : C.sub;
            const dText = d === 0 ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(4)} ETH`;
            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...dClr);
            doc.text(dText, PW - M - 4, y + 25, { align: 'right' });
        }
        y += 31;
    }

    function tbl(head, rows, colStyles, cellHook) {
        doc.autoTable({
            startY: y,
            margin: { left: M, right: M },
            head:   [head],
            body:   rows,
            theme:  'striped',
            styles: {
                fontSize:    8.5,
                cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
                textColor:   [...C.text],
                lineColor:   [...C.line],
                lineWidth:   0.15,
            },
            headStyles: {
                fillColor:  [...C.primary],
                textColor:  [...C.white],
                fontStyle:  'bold',
                fontSize:   7.5,
                lineWidth:  0,
            },
            alternateRowStyles: { fillColor: [248, 249, 252] },
            columnStyles: colStyles || {},
            didParseCell: cellHook || null,
        });
        y = doc.lastAutoTable.finalY + 7;
    }

    // ── Data ──────────────────────────────────────────────
    // loadedWallets are already enriched with eth_usd / usdt_usd / total_usd.

    const master     = loadedWallets.find(w => w.role === 'master');
    const subs       = loadedWallets.filter(w => w.role === 'sub');
    const pm         = portfolioMetrics(loadedWallets);  // canonical aggregates
    const total      = pm.totalEth;                       // replaces manual reduce

    const {
        transfers = [], summary = [],
        eth_feasible = false, eth_shortfall = 0,
        usdt_feasible = false, usdt_shortfall = 0,
    } = lastPoolResult;
    const feasible   = eth_feasible;
    const shortfall  = eth_shortfall;
    const masterAfter  = summary.find(w => w.role === 'master');
    const subsAfter    = summary.filter(w => w.role === 'sub');
    const totalAfter   = summary.reduce((s, w) => s + w.post, 0);
    const ethXfers     = transfers.filter(t => !t.token || t.token === 'ETH');
    const usdtXfers    = transfers.filter(t => t.token === 'USDT');
    const totalMoved   = ethXfers.reduce((s, t) => s + t.amount, 0);
    const totalUsdtMoved = usdtXfers.reduce((s, t) => s + t.amount, 0);

    const now  = new Date();
    const pad  = n => String(n).padStart(2, '0');
    const ts   = now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const fname = `pooling-report-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.pdf`;

    // ══════════════════════════════════════════════════════
    // HEADER
    // ══════════════════════════════════════════════════════

    doc.setFillColor(...C.primary);
    doc.roundedRect(M, y, 9, 9, 1.5, 1.5, 'F');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.white);
    doc.text('CT', M + 3, y + 6.2);

    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...C.text);
    doc.text('Portfolio Pooling Report', M + 13, y + 7.5);

    y += 14;
    rule(y, 0.5, C.primary);
    y += 6;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...C.sub);
    doc.text(`Generated  ${ts}`, M, y);
    y += 6;

    miniStats([
        { label: 'Total ETH',       val: `${total.toFixed(4)} ETH`                           },
        { label: 'Portfolio USD',   val: pm.totalUsd  != null ? fmtDollars(pm.totalUsd)  : '—' },
        { label: 'Wallets',         val: loadedWallets.length                                 },
        { label: 'Transfers',       val: transfers.length                                     },
    ]);
    y += 4;

    // ══════════════════════════════════════════════════════
    // 01 — PORTFOLIO BEFORE
    // ══════════════════════════════════════════════════════

    sectionBar('01', 'Portfolio Before Pooling');

    if (master) masterBox(master, total, 'before');

    if (subs.length > 0) {
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C.sub);
        doc.text('SUB-ACCOUNTS', M, y);
        y += 4;

        tbl(
            ['Address', 'Balance (ETH)', '% of Portfolio'],
            subs.map(w => [
                shorten(w.address),
                w.error ? 'Error' : w.balance.toFixed(6),
                (!w.error && total > 0) ? (w.balance / total * 100).toFixed(2) + '%' : '—',
            ]),
            { 0: { font: 'courier', fontSize: 8, cellWidth: 60 }, 1: { halign: 'right' }, 2: { halign: 'right' } },
            d => {
                if (d.section === 'body' && d.column.index === 2 && d.cell.raw !== '—') {
                    d.cell.styles.textColor = [...C.primary];
                    d.cell.styles.fontStyle = 'bold';
                }
            }
        );
    }

    // ══════════════════════════════════════════════════════
    // 02 — CASH POOLING CONFIGURATION
    // ══════════════════════════════════════════════════════

    needSpace(22);
    sectionBar('02', 'Cash Pooling Configuration');

    tbl(
        ['Address', 'Role', 'Pooling Mode', 'Target Balance'],
        lastPoolConfig.map(w => {
            const isMaster = w.role === 'master';
            const mode     = isMaster
                ? (w.target > 0 ? 'Minimum Balance' : 'Hub — No Minimum')
                : (w.mode === 'zero' ? 'Zero Balance' : 'Target Balance');
            const target   = (isMaster && w.target > 0) || (!isMaster && w.mode === 'target')
                ? `${(w.target || 0).toFixed(4)} ETH` : '—';
            return [shorten(w.address), isMaster ? 'Master' : 'Sub', mode, target];
        }),
        { 0: { font: 'courier', fontSize: 8, cellWidth: 55 }, 1: { cellWidth: 18 }, 3: { halign: 'right', cellWidth: 34 } },
        d => {
            if (d.section === 'body' && d.column.index === 1 && d.cell.raw === 'Master') {
                d.cell.styles.textColor = [...C.primary];
                d.cell.styles.fontStyle = 'bold';
            }
        }
    );

    // ══════════════════════════════════════════════════════
    // 03 — TRANSFER PLAN
    // ══════════════════════════════════════════════════════

    needSpace(30);
    sectionBar('03', 'Transfer Plan');

    if (!eth_feasible || !usdt_feasible) {
        needSpace(10);
        if (!eth_feasible) {
            doc.setFillColor(...C.rDim);
            doc.setDrawColor(...C.red);
            doc.setLineWidth(0.3);
            doc.roundedRect(M, y, CW, 9, 1.5, 1.5, 'FD');
            doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.red);
            doc.text(`ETH — Insufficient funds. Shortfall: ${eth_shortfall.toFixed(4)} ETH`, M + 4, y + 6.2);
            y += 13;
        }
        if (!usdt_feasible) {
            doc.setFillColor(...C.rDim);
            doc.setDrawColor(...C.red);
            doc.setLineWidth(0.3);
            doc.roundedRect(M, y, CW, 9, 1.5, 1.5, 'FD');
            doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.red);
            doc.text(`USDT — Insufficient funds. Shortfall: ${usdt_shortfall.toFixed(2)} USDT`, M + 4, y + 6.2);
            y += 13;
        }
    }
    if (transfers.length === 0) {
        needSpace(12);
        doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(...C.sub);
        doc.text('No transfers required.', M, y + 6);
        y += 12;
    } else {
        const affected = new Set([...transfers.map(t => t.from), ...transfers.map(t => t.to)]);
        miniStats([
            { label: 'Transfers',     val: transfers.length                                          },
            { label: 'ETH Moved',     val: totalMoved.toFixed(4)                                     },
            { label: 'USDT Moved',    val: totalUsdtMoved > 0 ? totalUsdtMoved.toFixed(2) + ' USDT' : '—' },
            { label: 'Wallets',       val: affected.size                                             },
        ]);
        const typeLabel = { sub_to_sub: 'Sub → Sub', sub_to_master: 'Sub → Master', master_to_sub: 'Master → Sub' };
        tbl(
            ['#', 'Type', 'Token', 'From', 'To', 'Amount'],
            transfers.map((t, i) => [
                String(i + 1),
                typeLabel[t.type] || t.type,
                t.token || 'ETH',
                shorten(t.from),
                shorten(t.to),
                t.amount.toFixed(6) + ' ' + (t.token || 'ETH'),
            ]),
            {
                0: { cellWidth: 10, halign: 'center' },
                1: { cellWidth: 30 },
                2: { cellWidth: 12, halign: 'center' },
                3: { font: 'courier', fontSize: 8, cellWidth: 36 },
                4: { font: 'courier', fontSize: 8, cellWidth: 36 },
                5: { halign: 'right', fontStyle: 'bold' },
            },
            d => {
                if (d.section === 'body' && d.column.index === 2) {
                    d.cell.styles.textColor = d.cell.raw === 'USDT' ? [...C.green] : [...C.primary];
                    d.cell.styles.fontStyle = 'bold';
                }
            }
        );
    }

    // ══════════════════════════════════════════════════════
    // 04 — PORTFOLIO AFTER
    // ══════════════════════════════════════════════════════

    if (summary.length > 0) {
        needSpace(32);
        sectionBar('04', 'Projected Portfolio After Transfer');

        if (masterAfter) masterBox(masterAfter, totalAfter, 'after');

        if (subsAfter.length > 0) {
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...C.sub);
            doc.text('SUB-ACCOUNTS — AFTER TRANSFER', M, y);
            y += 4;

            tbl(
                ['Address', 'ETH After', 'ETH Change', 'USDT Change', '% of Portfolio'],
                subsAfter.map(w => {
                    const d     = w.delta;
                    const dStr  = d === 0 ? 'No change' : `${d > 0 ? '+' : ''}${d.toFixed(6)}`;
                    const ud    = w.usdt_delta || 0;
                    const udStr = ud === 0 ? '—' : `${ud > 0 ? '+' : ''}${ud.toFixed(2)} USDT`;
                    return [
                        shorten(w.address),
                        w.post.toFixed(6),
                        dStr,
                        udStr,
                        totalAfter > 0 ? (w.post / totalAfter * 100).toFixed(2) + '%' : '—',
                    ];
                }),
                { 0: { font: 'courier', fontSize: 8, cellWidth: 50 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
                d => {
                    if (d.section === 'body' && d.column.index === 2) {
                        const v = d.cell.raw;
                        d.cell.styles.fontStyle = 'bold';
                        d.cell.styles.textColor = v.startsWith('+') ? [...C.green] : v.startsWith('-') ? [...C.red] : [...C.sub];
                    }
                    if (d.section === 'body' && d.column.index === 3) {
                        const v = d.cell.raw;
                        d.cell.styles.fontStyle = 'bold';
                        d.cell.styles.textColor = v.startsWith('+') ? [...C.green] : v.startsWith('-') ? [...C.red] : [...C.sub];
                    }
                    if (d.section === 'body' && d.column.index === 4) {
                        d.cell.styles.textColor = [...C.primary];
                        d.cell.styles.fontStyle = 'bold';
                    }
                }
            );
        }

        // ══════════════════════════════════════════════════
        // 05 — SUMMARY OF CHANGES
        // ══════════════════════════════════════════════════

        needSpace(30);
        sectionBar('05', 'Summary of Changes');

        const beforeMap  = Object.fromEntries(loadedWallets.map(w => [w.address.toLowerCase(), w.balance || 0]));
        const changeRows = summary
            .map(w => ({
                label:  `${shorten(w.address)} (${w.role === 'master' ? 'Master' : 'Sub'})`,
                before: beforeMap[w.address.toLowerCase()] || 0,
                after:  w.post,
                delta:  w.delta,
            }))
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

        tbl(
            ['Wallet', 'Before (ETH)', 'After (ETH)', 'Net Change (ETH)'],
            changeRows.map(r => [
                r.label,
                r.before.toFixed(6),
                r.after.toFixed(6),
                r.delta === 0 ? 'No change' : `${r.delta > 0 ? '+' : ''}${r.delta.toFixed(6)}`,
            ]),
            { 0: { cellWidth: 68 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
            d => {
                if (d.section === 'body' && d.column.index === 3) {
                    const v = d.cell.raw;
                    d.cell.styles.fontStyle = 'bold';
                    d.cell.styles.textColor = v.startsWith('+') ? [...C.green] : v.startsWith('-') ? [...C.red] : [...C.sub];
                }
            }
        );

        // Callout boxes: largest gain / largest reduction
        const gainers = changeRows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta);
        const losers  = changeRows.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta);

        if (gainers.length > 0 || losers.length > 0) {
            needSpace(24);
            const bW = (CW - 5) / 2;

            if (gainers.length > 0) {
                const g = gainers[0];
                doc.setFillColor(...C.gDim);
                doc.setDrawColor(...C.green);
                doc.setLineWidth(0.3);
                doc.roundedRect(M, y, bW, 20, 2, 2, 'FD');
                doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.green);
                doc.text('LARGEST GAIN', M + 4, y + 6);
                doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
                doc.text(`+${g.delta.toFixed(4)} ETH`, M + 4, y + 13);
                doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.sub);
                doc.text(g.label.length > 28 ? g.label.slice(0, 28) + '…' : g.label, M + 4, y + 18.5);
            }

            if (losers.length > 0) {
                const l = losers[0], lx = M + bW + 5;
                doc.setFillColor(...C.rDim);
                doc.setDrawColor(...C.red);
                doc.setLineWidth(0.3);
                doc.roundedRect(lx, y, bW, 20, 2, 2, 'FD');
                doc.setFontSize(6.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.red);
                doc.text('LARGEST REDUCTION', lx + 4, y + 6);
                doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...C.text);
                doc.text(`${l.delta.toFixed(4)} ETH`, lx + 4, y + 13);
                doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(...C.sub);
                doc.text(l.label.length > 28 ? l.label.slice(0, 28) + '…' : l.label, lx + 4, y + 18.5);
            }
            y += 26;
        }
    }

    // ── Page footers ──────────────────────────────────────
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        rule(PH - 12, 0.25, C.line);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.sub);
        doc.text('CryptoTreasury — Portfolio Pooling Report', M, PH - 7);
        doc.text(`${p} / ${pages}`, PW - M, PH - 7, { align: 'right' });
    }

    doc.save(fname);
}

// ── Copy to Clipboard ─────────────────────────────────────
document.getElementById('copy-btn').addEventListener('click', copyPlan);

function copyPlan() {
    const cards = document.querySelectorAll('#transfer-list .tx-card');
    const lines = ['CryptoTreasury — Transfer Plan', ''];
    cards.forEach(card => {
        const idx    = card.querySelector('.tx-index')?.textContent.trim() ?? '';
        const from   = card.querySelector('.tx-from .tx-block-name')?.textContent.trim() ?? '';
        const to     = card.querySelector('.tx-to .tx-block-name')?.textContent.trim() ?? '';
        const amount = card.querySelector('.tx-amount-val')?.textContent.trim() ?? '';
        const usd    = card.querySelector('.tx-amount-usd')?.textContent.trim() ?? '';
        lines.push(`${idx}. ${from} -> ${to}  ${amount}${usd ? '  ' + usd : ''}`);
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Plan', 2000);
    });
}

// ── Phase 1B: Tab initialization ──────────────────────────
// Case (c): no DOMContentLoaded handler existed — adding one here.
document.addEventListener('DOMContentLoaded', () => { initTabs(); });
