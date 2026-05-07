// ── app.js ────────────────────────────────────────────────
// CryptoTreasury — Frontend Logic
// ─────────────────────────────────────────────────────────

let loadedWallets  = [];
let lastPoolConfig = [];   // wallet config captured before each /api/pool call
let lastPoolResult = null; // response from /api/pool

// Colour palette for chart slices — muted professional palette for light theme
const CHART_COLORS = [
    '#3B82F6', '#8B5CF6', '#F59E0B', '#059669',
    '#EF4444', '#06B6D4', '#EC4899', '#6366F1',
    '#F97316', '#14B8A6', '#84CC16', '#A855F7',
    '#0EA5E9', '#F43F5E', '#16A34A', '#D97706',
];

// Master wallet — neutral slate tint
const MASTER_CHART_COLOR = '#94A3B8';

// ── ETH / USD Price ───────────────────────────────────────
let ethUsdPrice = null;

async function fetchEthPrice() {
    try {
        const res  = await fetch(
            'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
            { signal: AbortSignal.timeout(8000) }
        );
        const json = await res.json();
        ethUsdPrice = json?.ethereum?.usd ?? null;
    } catch {
        ethUsdPrice = null;
    }
}

// Format ETH amount as USD string; returns null when price unavailable.
function fmtUsd(eth) {
    if (!ethUsdPrice || eth == null) return null;
    const usd = eth * ethUsdPrice;
    if (usd >= 1e9) return '$' + (usd / 1e9).toFixed(2) + 'B';
    if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(2) + 'M';
    return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Returns a <span class="val-usd"> or empty string when price unavailable.
function usdSpan(eth) {
    const v = fmtUsd(eth);
    return v ? `<span class="val-usd">${v}</span>` : '';
}

// Format a USDT amount (already in USD). Always returns a string.
function fmtUsdt(val) {
    if (val == null) return null;
    if (val >= 1e9) return '$' + (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return '$' + (val / 1e6).toFixed(2) + 'M';
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Step Progress ─────────────────────────────────────────
function setStep(active) {
    for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        el.classList.remove('active', 'done');
        if (i === active)    el.classList.add('active');
        else if (i < active) el.classList.add('done');
    }
}

function setLoading(btn, loading) {
    const text    = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled  = loading;
    if (text)    text.style.opacity = loading ? '0.4' : '1';
    if (spinner) spinner.classList.toggle('hidden', !loading);
}

// ── Subwallet Management ──────────────────────────────────
function addSubwallet() {
    const list = document.getElementById('subwallet-list');
    const row  = document.createElement('div');
    row.className = 'subwallet-row';
    row.innerHTML = `
        <input type="text" placeholder="0x..." class="sub-address"
            autocomplete="off" spellcheck="false" />
        <button class="btn-remove" onclick="removeSubwallet(this)" title="Remove">&#x2715;</button>
    `;
    list.appendChild(row);
}

function removeSubwallet(btn) { btn.parentElement.remove(); }

addSubwallet();
document.getElementById('add-subwallet').addEventListener('click', addSubwallet);
document.getElementById('load-btn').addEventListener('click', loadPortfolio);

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
    input.style.borderColor = '#DC2626';
    input.style.boxShadow   = '0 0 0 3px rgba(220,38,38,0.12)';
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

// ── Step 1: Load Portfolio ────────────────────────────────
async function loadPortfolio() {
    const errorEl = document.getElementById('load-error');
    const loadBtn = document.getElementById('load-btn');
    errorEl.textContent = '';

    const masterAddress = document.getElementById('master-address').value.trim();
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
            fetchEthPrice(),
        ]);
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = 'Server error. Please try again.'; return; }

        loadedWallets = data.wallets;
        displayPortfolio(data);
        buildPoolingSetup(data.wallets);

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
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
    return val.toFixed(2);
}

/**
 * Render a donut chart into svgEl.
 * wallets: array of { address, balance, role, _color, error }
 * containerId: CSS id of the accounts-panel whose rows to cross-highlight on hover.
 */
function renderDonutChartTo(svgEl, wallets, total, containerId) {
    if (!svgEl || total === 0) return;

    const cx = 100, cy = 100, outerR = 82, innerR = 56;
    const GAP    = 1.2;   // degrees between segments
    const MIN_DEG = 2;    // visual minimum per slice

    const slices = wallets
        .filter(w => !w.error && w.balance > 0)
        .map(w => ({
            pct:     w.balance / total * 100,
            color:   w.role === 'master' ? MASTER_CHART_COLOR : w._color,
            address: w.address,
            balance: w.balance,
            role:    w.role,
        }));

    if (slices.length === 0) { svgEl.innerHTML = ''; return; }

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
        ${paths}
        <circle cx="${cx}" cy="${cy}" r="${innerR - 1}" fill="#FFFFFF" />
        <text x="${cx}" y="${cy - 4}" text-anchor="middle"
            class="chart-center-value">${fmtEth(total)}</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle"
            class="chart-center-label">ETH</text>`;

    // Hover: highlight matching slice + account row (bidirectional)
    const rowSel = `#${containerId} .account-row`;

    svgEl.querySelectorAll('.chart-slice').forEach(path => {
        path.addEventListener('mouseenter', () => {
            const addr = path.dataset.address;
            svgEl.querySelectorAll('.chart-slice').forEach(p => {
                p.style.opacity = p.dataset.address === addr ? '1' : '0.2';
            });
            document.querySelectorAll(rowSel).forEach(row => {
                row.style.opacity = row.dataset.address === addr ? '1' : '0.25';
            });
        });
        path.addEventListener('mouseleave', () => {
            svgEl.querySelectorAll('.chart-slice').forEach(p => { p.style.opacity = ''; });
            document.querySelectorAll(rowSel).forEach(row => { row.style.opacity = ''; });
        });
    });

    document.querySelectorAll(rowSel).forEach(row => {
        row.addEventListener('mouseenter', () => {
            const addr = row.dataset.address;
            svgEl.querySelectorAll('.chart-slice').forEach(p => {
                p.style.opacity = p.dataset.address === addr ? '1' : '0.2';
            });
            document.querySelectorAll(rowSel).forEach(r => {
                r.style.opacity = r.dataset.address === addr ? '1' : '0.25';
            });
        });
        row.addEventListener('mouseleave', () => {
            svgEl.querySelectorAll('.chart-slice').forEach(p => { p.style.opacity = ''; });
            document.querySelectorAll(rowSel).forEach(r => { r.style.opacity = ''; });
        });
    });
}

function displayPortfolio(data) {
    const total     = data.total_eth;
    const totalUsdt = data.total_usdt || 0;
    const master    = data.wallets.find(w => w.role === 'master');
    const subs      = data.wallets.filter(w => w.role === 'sub');

    // Assign chart colours to sub-wallets (index-stable)
    subs.forEach((w, i) => { w._color = CHART_COLORS[i % CHART_COLORS.length]; });

    // ── Master hero ───────────────────────────────────────
    const masterShort  = master.address.slice(0,6) + '...' + master.address.slice(-4);
    const masterPct    = total > 0 && !master.error
        ? (master.balance / total * 100).toFixed(1) : '0';
    const masterBal    = master.error ? 'Error' : master.balance.toFixed(4);
    const masterUsdt   = !master.error && master.usdt_balance > 0
        ? fmtUsdt(master.usdt_balance) : null;
    const totalUsd     = fmtUsd(total);

    document.getElementById('master-overview').innerHTML = `
        <div class="master-left">
            <span class="master-badge">Master Wallet</span>
            <div class="master-addr">${masterShort}</div>
            <div class="master-balance">${masterBal} <span class="master-unit">ETH</span></div>
            ${master.error ? '' : usdSpan(master.balance)}
            ${masterUsdt ? `<div class="master-usdt-bal">${masterUsdt} USDT</div>` : ''}
            <div class="master-share">${masterPct}% of ETH portfolio</div>
        </div>
        <div class="portfolio-totals">
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtEth(total)}</div>
                <div class="ptotal-label">Total ETH</div>
            </div>
            <div class="ptotal-divider"></div>
            ${totalUsd ? `
            <div class="ptotal-item">
                <div class="ptotal-value">${totalUsd}</div>
                <div class="ptotal-label">Total USD</div>
            </div>
            <div class="ptotal-divider"></div>` : ''}
            ${totalUsdt > 0 ? `
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtUsdt(totalUsdt)}</div>
                <div class="ptotal-label">Total USDT</div>
            </div>
            <div class="ptotal-divider"></div>` : ''}
            <div class="ptotal-item">
                <div class="ptotal-value">${data.wallets.length}</div>
                <div class="ptotal-label">Wallets</div>
            </div>
            <div class="ptotal-divider"></div>
            <div class="ptotal-item">
                <div class="ptotal-value">${subs.length}</div>
                <div class="ptotal-label">Sub-accounts</div>
            </div>
        </div>`;
    document.getElementById('master-overview').classList.remove('hidden');

    // ── Sub-accounts list ─────────────────────────────────
    const panel = document.getElementById('sub-accounts-panel');
    if (subs.length === 0) {
        panel.innerHTML = `<p style="color:var(--text-2);font-size:13px;">No sub-accounts loaded.</p>`;
    } else {
        panel.innerHTML = `
            <div class="accounts-header">
                Sub-Accounts <span class="accounts-count">${subs.length}</span>
            </div>
            ${subs.map(w => {
                const short    = w.address.slice(0,6) + '...' + w.address.slice(-4);
                const pct      = total > 0 && !w.error ? (w.balance / total * 100).toFixed(1) : '0';
                const balEth   = w.error ? 'Error' : w.balance.toFixed(4) + ' ETH';
                const usdtLine = !w.error && w.usdt_balance > 0
                    ? `<div class="account-usdt">${fmtUsdt(w.usdt_balance)} USDT</div>` : '';
                return `
                    <div class="account-row" data-address="${w.address}">
                        <div class="account-dot"
                            style="background:${w._color};box-shadow:0 0 6px ${w._color}80;"></div>
                        <div class="account-info">
                            <div class="account-addr">${short}</div>
                            <div class="account-balance">${balEth}</div>
                            ${w.error ? '' : usdSpan(w.balance)}
                            ${usdtLine}
                        </div>
                        <div class="account-pct" style="color:${w._color}">${pct}%</div>
                    </div>`;
            }).join('')}`;
    }

    // ── Donut chart ───────────────────────────────────────
    renderDonutChartTo(
        document.getElementById('portfolio-chart'),
        data.wallets,
        total,
        'sub-accounts-panel'
    );

    document.getElementById('portfolio-view').classList.remove('hidden');
    document.getElementById('portfolio-view').scrollIntoView({ behavior: 'smooth' });
    setStep(2);
}

// ── Step 3: Build Pooling Setup ───────────────────────────
function buildPoolingSetup(wallets) {
    const tbody = document.getElementById('pooling-body');
    tbody.innerHTML = '';

    wallets.forEach((wallet, index) => {
        const short     = wallet.address.slice(0,6) + '...' + wallet.address.slice(-4);
        const isMaster  = wallet.role === 'master';
        const roleClass = isMaster ? 'role-master' : 'role-sub';
        const roleName  = isMaster ? 'Master' : 'Sub';
        const usdt      = wallet.usdt_balance != null ? wallet.usdt_balance.toFixed(2) : '0.00';

        const row = document.createElement('tr');
        row.dataset.index   = index;
        row.dataset.address = wallet.address;
        row.dataset.role    = wallet.role;

        // ETH/USD currency toggle — only rendered when ETH price is loaded
        const toggleBtn = ethUsdPrice
            ? '<button class="currency-toggle" onclick="toggleTargetCurrency(this)" disabled>ETH</button>'
            : '';

        if (isMaster) {
            row.innerHTML = `
                <td class="cell-mono">${short}</td>
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
                                ${toggleBtn}
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
                        <input type="number" class="target-input master-usdt-target-input"
                            placeholder="Min USDT" step="0.01" min="0" disabled />
                    </div>
                </td>`;
        } else {
            row.innerHTML = `
                <td class="cell-mono">${short}</td>
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
                                ${toggleBtn}
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
                        <input type="number" class="target-input sub-usdt-target-input"
                            placeholder="e.g. 100" step="0.01" min="0" disabled />
                    </div>
                </td>`;
        }
        tbody.appendChild(row);
    });

    document.getElementById('pooling-setup').classList.remove('hidden');
    document.getElementById('pooling-setup').scrollIntoView({ behavior: 'smooth' });
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
    const enable = select.value === 'target';
    input.disabled = !enable;
    input.value = '';
    if (enable) input.focus();
}

function toggleMasterUsdtTarget(select) {
    const row    = select.closest('.pool-config');
    const input  = row.querySelector('.master-usdt-target-input');
    const enable = select.value === 'minimum';
    input.disabled = !enable;
    input.value = '';
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

    const wallets = [];
    document.querySelectorAll('#pooling-body tr').forEach(row => {
        const address = row.dataset.address;
        const role    = row.dataset.role;

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
            const usdtTarget = usdtMode === 'minimum'
                ? (parseFloat(row.querySelector('.master-usdt-target-input').value) || 0)
                : 0;

            wallets.push({ address, role, mode: null, target: ethTarget,
                           usdt_mode: null, usdt_target: usdtTarget });
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
            const usdtTarget = usdtMode === 'target'
                ? (parseFloat(row.querySelector('.sub-usdt-target-input').value) || 0)
                : 0;

            wallets.push({ address, role, mode: ethMode, target: ethTarget,
                           usdt_mode: usdtMode, usdt_target: usdtTarget });
        }
    });

    lastPoolConfig = wallets.map(w => ({ ...w })); // snapshot before API call

    setLoading(poolBtn, true);

    try {
        const response = await fetch('/api/pool', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ wallets })
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = 'Server error. Please try again.'; return; }
        lastPoolResult = data;
        displayResults(data);
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
    section.scrollIntoView({ behavior: 'smooth' });
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

    // Stat cards
    document.getElementById('results-summary').innerHTML = `
        <div class="stat-card">
            <div class="stat-card-value">${transfers.length}</div>
            <div class="stat-card-label">Transfers</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-value">${totalETH.toFixed(4)}</div>
            <div class="stat-card-label">ETH Moved</div>
            ${usdSpan(totalETH)}
        </div>
        ${totalUSDT > 0 ? `
        <div class="stat-card">
            <div class="stat-card-value">${fmtUsdt(totalUSDT)}</div>
            <div class="stat-card-label">USDT Moved</div>
        </div>` : ''}
        <div class="stat-card">
            <div class="stat-card-value">${affected || '—'}</div>
            <div class="stat-card-label">Wallets Affected</div>
        </div>`;

    // Transfer table — sorted: ETH first, then USDT; within each: sub→sub, sub→master, master→sub
    const typeLabels = {
        sub_to_sub:     { label: 'Sub → Sub',    css: 'type-sub-sub'    },
        sub_to_master:  { label: 'Sub → Master', css: 'type-sub-master' },
        master_to_sub:  { label: 'Master → Sub', css: 'type-master-sub' },
    };
    const typeOrder = { sub_to_sub: 1, sub_to_master: 2, master_to_sub: 3 };
    const tokenOrder = t => t.token === 'USDT' ? 1 : 0;
    const sorted = [...transfers].sort((a, b) =>
        tokenOrder(a) - tokenOrder(b) || typeOrder[a.type] - typeOrder[b.type]
    );

    const tbody = document.getElementById('transfer-body');
    tbody.innerHTML = '';

    if (sorted.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row"><td colspan="6">
                <div class="empty-icon">&#10003;</div>
                <div class="empty-text">All wallets are already at target</div>
                <div class="empty-sub">No transfers required.</div>
            </td></tr>`;
    } else {
        sorted.forEach((t, i) => {
            const from   = t.from.slice(0,6) + '...' + t.from.slice(-4);
            const to     = t.to.slice(0,6)   + '...' + t.to.slice(-4);
            const tInfo  = typeLabels[t.type] || { label: t.type, css: '' };
            const token  = t.token || 'ETH';
            const row    = document.createElement('tr');
            row.innerHTML = `
                <td class="cell-num">${i + 1}</td>
                <td><span class="type-badge ${tInfo.css}">${tInfo.label}</span></td>
                <td><span class="token-badge token-${token.toLowerCase()}">${token}</span></td>
                <td class="cell-mono">${from}</td>
                <td class="cell-mono">${to}</td>
                <td class="cell-num">${t.amount.toFixed(4)} ${token}</td>`;
            tbody.appendChild(row);
        });
    }

    // After-transfer portfolio view
    renderAfterPortfolio(data);
}

// ── Step 4b: After-Transfer Portfolio View ────────────────
function renderAfterPortfolio(data) {
    if (!data.summary || data.summary.length === 0) return;

    const total       = data.summary.reduce((s, w) => s + w.post, 0);
    const totalUsdt   = data.summary.reduce((s, w) => s + (w.usdt_post || 0), 0);
    const masterEntry = data.summary.find(w => w.role === 'master');
    const subEntries  = data.summary.filter(w => w.role === 'sub');

    // ── Master after-hero ─────────────────────────────────
    const mShort    = masterEntry.address.slice(0,6) + '...' + masterEntry.address.slice(-4);
    const mPct      = total > 0 ? (masterEntry.post / total * 100).toFixed(1) : '0';
    const mDelta    = masterEntry.delta;
    const mDeltaColor = mDelta > 0 ? 'var(--green)' : mDelta < 0 ? 'var(--red)' : 'var(--text-3)';
    const mDeltaStr   = mDelta === 0
        ? 'No change'
        : `${mDelta > 0 ? '↑ +' : '↓ '}${mDelta.toFixed(4)} ETH`;
    const mUsdtDelta  = masterEntry.usdt_delta || 0;
    const mUsdtPost   = masterEntry.usdt_post  || 0;
    const afterTotalUsd = fmtUsd(total);

    document.getElementById('after-master-overview').innerHTML = `
        <div class="master-left">
            <span class="master-badge after-badge">Master Wallet</span>
            <div class="master-addr">${mShort}</div>
            <div class="master-balance">${masterEntry.post.toFixed(4)} <span class="master-unit">ETH</span></div>
            ${usdSpan(masterEntry.post)}
            ${mUsdtPost > 0 ? `<div class="master-usdt-bal">${fmtUsdt(mUsdtPost)} USDT</div>` : ''}
            <div class="master-delta" style="color:${mDeltaColor}">${mDeltaStr}</div>
            ${mUsdtDelta !== 0 ? `
            <div class="master-delta" style="color:${mUsdtDelta > 0 ? 'var(--green)' : 'var(--red)'}">
                ${mUsdtDelta > 0 ? '↑ +' : '↓ '}${mUsdtDelta.toFixed(2)} USDT
            </div>` : ''}
            <div class="master-share">${mPct}% of ETH portfolio</div>
        </div>
        <div class="portfolio-totals">
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtEth(total)}</div>
                <div class="ptotal-label">Total ETH</div>
            </div>
            <div class="ptotal-divider"></div>
            ${afterTotalUsd ? `
            <div class="ptotal-item">
                <div class="ptotal-value">${afterTotalUsd}</div>
                <div class="ptotal-label">Total USD</div>
            </div>
            <div class="ptotal-divider"></div>` : ''}
            ${totalUsdt > 0 ? `
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtUsdt(totalUsdt)}</div>
                <div class="ptotal-label">Total USDT</div>
            </div>
            <div class="ptotal-divider"></div>` : ''}
            <div class="ptotal-item">
                <div class="ptotal-value">${data.summary.length}</div>
                <div class="ptotal-label">Wallets</div>
            </div>
            <div class="ptotal-divider"></div>
            <div class="ptotal-item">
                <div class="ptotal-value">${subEntries.length}</div>
                <div class="ptotal-label">Sub-accounts</div>
            </div>
        </div>`;

    // ── Sub-accounts list with deltas ─────────────────────
    const rows = subEntries.map(w => {
        const short      = w.address.slice(0,6) + '...' + w.address.slice(-4);
        const color      = getWalletColor(w.address);
        const pct        = total > 0 ? (w.post / total * 100).toFixed(1) : '0';
        const delta      = w.delta;
        const usdtDelta  = w.usdt_delta || 0;

        let pillClass, pillText;
        if (delta > 0) {
            pillClass = 'up';
            pillText  = `↑ +${delta.toFixed(4)}`;
        } else if (delta < 0) {
            pillClass = 'down';
            pillText  = `↓ ${delta.toFixed(4)}`;
        } else {
            pillClass = 'flat';
            pillText  = 'no change';
        }

        let usdtPillHtml = '';
        if (usdtDelta > 0) {
            usdtPillHtml = `<span class="delta-pill up">↑ +${usdtDelta.toFixed(2)} USDT</span>`;
        } else if (usdtDelta < 0) {
            usdtPillHtml = `<span class="delta-pill down">↓ ${usdtDelta.toFixed(2)} USDT</span>`;
        }

        return `
            <div class="account-row" data-address="${w.address}">
                <div class="account-dot"
                    style="background:${color};box-shadow:0 0 6px ${color}80;"></div>
                <div class="account-info">
                    <div class="account-addr">${short}</div>
                    <div class="account-after-bal">
                        <span class="account-balance">${w.post.toFixed(4)} ETH</span>
                        <span class="delta-pill ${pillClass}">${pillText}</span>
                        ${usdtPillHtml}
                    </div>
                    ${usdSpan(w.post)}
                </div>
                <div class="account-pct" style="color:${color}">${pct}%</div>
            </div>`;
    }).join('');

    document.getElementById('after-sub-accounts').innerHTML = `
        <div class="accounts-header">
            Sub-Accounts <span class="accounts-count">${subEntries.length}</span>
        </div>
        ${rows}`;

    // ── After donut chart — same colours as before-chart ──
    // Build wallet list with post-transfer balances and preserved colours
    const afterWallets = data.summary.map(w => ({
        address: w.address,
        balance: w.post,
        role:    w.role,
        _color:  w.role === 'master' ? MASTER_CHART_COLOR : getWalletColor(w.address),
        error:   null,
    }));

    renderDonutChartTo(
        document.getElementById('after-chart'),
        afterWallets,
        total,
        'after-sub-accounts'
    );

    const afterView = document.getElementById('after-view');
    afterView.classList.remove('hidden');
    afterView.scrollIntoView({ behavior: 'smooth' });
    setStep(5);
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
        primary:  [94,  17,  200],
        pDim:     [237, 228, 252],
        text:     [26,  22,  48 ],
        sub:      [99,  104, 130],
        line:     [214, 218, 232],
        bg:       [244, 246, 251],
        green:    [5,   150, 105],
        gDim:     [209, 250, 229],
        red:      [220, 38,  38 ],
        rDim:     [254, 226, 226],
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

    const master     = loadedWallets.find(w => w.role === 'master');
    const subs       = loadedWallets.filter(w => w.role === 'sub');
    const total      = loadedWallets.reduce((s, w) => s + (!w.error ? (w.balance || 0) : 0), 0);

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
        { label: 'Total ETH',    val: `${total.toFixed(4)} ETH`  },
        { label: 'Wallets',      val: loadedWallets.length        },
        { label: 'Transfers',    val: transfers.length            },
        { label: 'ETH Moved',    val: totalMoved.toFixed(4)       },
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
            doc.text(`USDT — Insufficient funds. Shortfall: $${usdt_shortfall.toFixed(2)}`, M + 4, y + 6.2);
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
            { label: 'USDT Moved',    val: totalUsdtMoved > 0 ? '$' + totalUsdtMoved.toFixed(2) : '—' },
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
                    const udStr = ud === 0 ? '—' : `${ud > 0 ? '+' : ''}$${ud.toFixed(2)}`;
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
    const rows  = document.querySelectorAll('#transfer-body tr:not(.empty-row)');
    const lines = ['CryptoTreasury — Transfer Plan', ''];
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        // cols: # | Type | Token | From | To | Amount
        lines.push(
            `${cells[0].textContent}. [${cells[2].textContent.trim()}] ${cells[1].textContent.trim()}  ` +
            `${cells[3].textContent} -> ${cells[4].textContent}  ` +
            `${cells[5].textContent}`
        );
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Plan', 2000);
    });
}
