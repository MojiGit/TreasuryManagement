// ── app.js ────────────────────────────────────────────────
// CryptoTreasury — Frontend Logic
// ─────────────────────────────────────────────────────────

let loadedWallets = [];

// Colour palette for chart slices — muted professional palette for light theme
const CHART_COLORS = [
    '#3B82F6', '#8B5CF6', '#F59E0B', '#059669',
    '#EF4444', '#06B6D4', '#EC4899', '#6366F1',
    '#F97316', '#14B8A6', '#84CC16', '#A855F7',
    '#0EA5E9', '#F43F5E', '#16A34A', '#D97706',
];

// Master wallet — neutral slate tint
const MASTER_CHART_COLOR = '#94A3B8';

// ── Step Progress ─────────────────────────────────────────
function setStep(active) {
    for (let i = 1; i <= 4; i++) {
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
        const response = await fetch('/api/load', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ wallets })
        });
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
    const total  = data.total_eth;
    const master = data.wallets.find(w => w.role === 'master');
    const subs   = data.wallets.filter(w => w.role === 'sub');

    // Assign chart colours to sub-wallets (index-stable)
    subs.forEach((w, i) => { w._color = CHART_COLORS[i % CHART_COLORS.length]; });

    // ── Master hero ───────────────────────────────────────
    const masterShort = master.address.slice(0,6) + '...' + master.address.slice(-4);
    const masterPct   = total > 0 && !master.error
        ? (master.balance / total * 100).toFixed(1) : '0';
    const masterBal   = master.error ? 'Error' : master.balance.toFixed(4);

    document.getElementById('master-overview').innerHTML = `
        <div class="master-left">
            <span class="master-badge">Master Wallet</span>
            <div class="master-addr">${masterShort}</div>
            <div class="master-balance">${masterBal} <span class="master-unit">ETH</span></div>
            <div class="master-share">${masterPct}% of total portfolio</div>
        </div>
        <div class="portfolio-totals">
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtEth(total)}</div>
                <div class="ptotal-label">Total ETH</div>
            </div>
            <div class="ptotal-divider"></div>
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
                const short   = w.address.slice(0,6) + '...' + w.address.slice(-4);
                const pct     = total > 0 && !w.error ? (w.balance / total * 100).toFixed(1) : '0';
                const balance = w.error ? 'Error' : w.balance.toFixed(4) + ' ETH';
                return `
                    <div class="account-row" data-address="${w.address}">
                        <div class="account-dot"
                            style="background:${w._color};box-shadow:0 0 6px ${w._color}80;"></div>
                        <div class="account-info">
                            <div class="account-addr">${short}</div>
                            <div class="account-balance">${balance}</div>
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

    // Show account prompt only when logged-out
    const prompt = document.getElementById('account-prompt');
    if (!currentUser) prompt.classList.remove('hidden');
    else              prompt.classList.add('hidden');
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

        const row = document.createElement('tr');
        row.dataset.index   = index;
        row.dataset.address = wallet.address;
        row.dataset.role    = wallet.role;

        if (isMaster) {
            row.innerHTML = `
                <td class="cell-mono">${short}</td>
                <td><span class="badge ${roleClass}">${roleName}</span></td>
                <td class="cell-num">${wallet.balance.toFixed(4)}</td>
                <td>
                    <select class="mode-select master-mode-select"
                        onchange="toggleMasterTarget(this)">
                        <option value="hub">Hub (no minimum)</option>
                        <option value="minimum">Minimum Balance</option>
                    </select>
                </td>
                <td>
                    <input type="number" class="target-input master-target-input"
                        placeholder="Min ETH" step="0.0001" min="0" disabled />
                </td>`;
        } else {
            row.innerHTML = `
                <td class="cell-mono">${short}</td>
                <td><span class="badge ${roleClass}">${roleName}</span></td>
                <td class="cell-num">${wallet.balance.toFixed(4)}</td>
                <td>
                    <select class="mode-select" onchange="toggleTarget(this)">
                        <option value="zero">Zero Balance</option>
                        <option value="target">Target Balance</option>
                    </select>
                </td>
                <td>
                    <input type="number" class="target-input sub-target-input"
                        placeholder="e.g. 1.0" step="0.0001" min="0" disabled />
                </td>`;
        }
        tbody.appendChild(row);
    });

    document.getElementById('pooling-setup').classList.remove('hidden');
    document.getElementById('pooling-setup').scrollIntoView({ behavior: 'smooth' });
    setStep(3);
}

function toggleTarget(select) {
    const input = select.closest('tr').querySelector('.sub-target-input');
    input.disabled = select.value !== 'target';
    if (!input.disabled) { input.value = ''; input.focus(); } else input.value = '';
}

function toggleMasterTarget(select) {
    const input = select.closest('tr').querySelector('.master-target-input');
    input.disabled = select.value !== 'minimum';
    if (!input.disabled) { input.value = ''; input.focus(); } else input.value = '';
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
            const mode   = row.querySelector('.master-mode-select').value;
            const target = mode === 'minimum'
                ? parseFloat(row.querySelector('.master-target-input').value) || 0 : 0;
            wallets.push({ address, role, mode: null, target });
        } else {
            const mode   = row.querySelector('.mode-select').value;
            const target = mode === 'target'
                ? parseFloat(row.querySelector('.sub-target-input').value) || 0 : 0;
            wallets.push({ address, role, mode, target });
        }
    });

    setLoading(poolBtn, true);

    try {
        const response = await fetch('/api/pool', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ wallets })
        });
        const data = await response.json();
        if (!response.ok) { errorEl.textContent = 'Server error. Please try again.'; return; }
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

    if (!data.feasible) {
        infeasible.textContent =
            `Insufficient funds. Shortfall: ${data.shortfall.toFixed(4)} ETH. ` +
            `Increase the master balance or reduce subwallet targets.`;
        infeasible.classList.remove('hidden');
        transferDiv.classList.add('hidden');
        document.getElementById('after-portfolio-section').classList.add('hidden');
        return;
    }

    infeasible.classList.add('hidden');
    transferDiv.classList.remove('hidden');

    // Stat cards
    const totalETH = data.transfers.reduce((s, t) => s + t.amount, 0);
    const affected  = new Set([
        ...data.transfers.map(t => t.from),
        ...data.transfers.map(t => t.to)
    ]).size;

    document.getElementById('results-summary').innerHTML = `
        <div class="stat-card">
            <div class="stat-card-value">${data.transfers.length}</div>
            <div class="stat-card-label">Transfers</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-value">${totalETH.toFixed(4)}</div>
            <div class="stat-card-label">ETH Moved</div>
        </div>
        <div class="stat-card">
            <div class="stat-card-value">${affected}</div>
            <div class="stat-card-label">Wallets Affected</div>
        </div>`;

    // Transfer table
    const typeLabels = {
        sub_to_sub:     { label: 'Sub → Sub',    css: 'type-sub-sub'    },
        sub_to_master:  { label: 'Sub → Master', css: 'type-sub-master' },
        master_to_sub:  { label: 'Master → Sub', css: 'type-master-sub' },
    };
    const typeOrder = { sub_to_sub: 1, sub_to_master: 2, master_to_sub: 3 };
    const sorted    = [...data.transfers].sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

    const tbody = document.getElementById('transfer-body');
    tbody.innerHTML = '';

    if (sorted.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-row"><td colspan="5">
                <div class="empty-icon">&#10003;</div>
                <div class="empty-text">All wallets are already at target</div>
                <div class="empty-sub">No transfers required.</div>
            </td></tr>`;
    } else {
        sorted.forEach((t, i) => {
            const from  = t.from.slice(0,6) + '...' + t.from.slice(-4);
            const to    = t.to.slice(0,6)   + '...' + t.to.slice(-4);
            const tInfo = typeLabels[t.type];
            const row   = document.createElement('tr');
            row.innerHTML = `
                <td class="cell-num">${i + 1}</td>
                <td><span class="type-badge ${tInfo.css}">${tInfo.label}</span></td>
                <td class="cell-mono">${from}</td>
                <td class="cell-mono">${to}</td>
                <td class="cell-num">${t.amount.toFixed(4)} ETH</td>`;
            tbody.appendChild(row);
        });
    }

    // After-transfer portfolio view
    renderAfterPortfolio(data);
}

// ── Step 4b: After-Transfer Portfolio View ────────────────
function renderAfterPortfolio(data) {
    if (!data.feasible || !data.summary || data.summary.length === 0) return;

    const total       = data.summary.reduce((s, w) => s + w.post, 0);
    const masterEntry = data.summary.find(w => w.role === 'master');
    const subEntries  = data.summary.filter(w => w.role === 'sub');

    // ── Master after-hero ─────────────────────────────────
    const mShort    = masterEntry.address.slice(0,6) + '...' + masterEntry.address.slice(-4);
    const mPct      = total > 0 ? (masterEntry.post / total * 100).toFixed(1) : '0';
    const mDelta    = masterEntry.delta;
    const mDeltaColor = mDelta > 0 ? 'var(--green)' : mDelta < 0 ? 'var(--red)' : 'var(--text-3)';
    const mDeltaStr = mDelta === 0
        ? 'No change'
        : `${mDelta > 0 ? '↑ +' : '↓ '}${mDelta.toFixed(4)} ETH`;

    document.getElementById('after-master-overview').innerHTML = `
        <div class="master-left">
            <span class="master-badge after-badge">After Transfer</span>
            <div class="master-addr">${mShort}</div>
            <div class="master-balance">${masterEntry.post.toFixed(4)} <span class="master-unit">ETH</span></div>
            <div class="master-delta" style="color:${mDeltaColor}">${mDeltaStr}</div>
            <div class="master-share">${mPct}% of total portfolio</div>
        </div>
        <div class="portfolio-totals">
            <div class="ptotal-item">
                <div class="ptotal-value">${fmtEth(total)}</div>
                <div class="ptotal-label">Total ETH</div>
            </div>
            <div class="ptotal-divider"></div>
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
        const short  = w.address.slice(0,6) + '...' + w.address.slice(-4);
        const color  = getWalletColor(w.address);
        const pct    = total > 0 ? (w.post / total * 100).toFixed(1) : '0';
        const delta  = w.delta;

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

        return `
            <div class="account-row" data-address="${w.address}">
                <div class="account-dot"
                    style="background:${color};box-shadow:0 0 6px ${color}80;"></div>
                <div class="account-info">
                    <div class="account-addr">${short}</div>
                    <div class="account-after-bal">
                        <span class="account-balance">${w.post.toFixed(4)} ETH</span>
                        <span class="delta-pill ${pillClass}">${pillText}</span>
                    </div>
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

    document.getElementById('after-portfolio-section').classList.remove('hidden');
}

// ── Auth State ────────────────────────────────────────────

let currentUser = null; // { user_id, email } or null

async function checkAuthState() {
    try {
        const res  = await fetch('/api/auth/me');
        const data = await res.json();
        currentUser = data.user_id ? data : null;
    } catch {
        currentUser = null;
    }
    updateAuthUI(currentUser);

    if (currentUser) {
        try {
            const res  = await fetch('/api/wallet-config');
            const data = await res.json();
            if (data.config && data.config.length > 0) {
                document.getElementById('saved-config-banner').classList.remove('hidden');
            }
        } catch { /* ignore */ }
    }
}

function updateAuthUI(user) {
    const topbarAuth    = document.getElementById('topbar-auth');
    const saveConfigBtn = document.getElementById('save-config-btn');

    if (user) {
        topbarAuth.innerHTML = `
            <span class="topbar-email">${user.email}</span>
            <button class="btn-ghost" onclick="logout()">Logout</button>`;
        saveConfigBtn.classList.remove('hidden');
        document.getElementById('account-prompt').classList.add('hidden');
    } else {
        topbarAuth.innerHTML = `
            <button id="open-auth-btn" class="btn-ghost" onclick="openAuthModal('login')">
                Login / Register
            </button>`;
        saveConfigBtn.classList.add('hidden');
    }
}

// ── Auth Modal ────────────────────────────────────────────

function openAuthModal(tab) {
    switchTab(tab);
    document.getElementById('auth-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
    document.getElementById('auth-modal').classList.add('hidden');
    document.body.style.overflow = '';
    document.getElementById('login-error').textContent  = '';
    document.getElementById('reg-error').textContent    = '';
}

function handleModalBackdrop(event) {
    if (event.target === document.getElementById('auth-modal')) closeAuthModal();
}

function switchTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
}

// ── Login / Register ──────────────────────────────────────

async function submitLogin(event) {
    event.preventDefault();
    const errorEl = document.getElementById('login-error');
    const btn     = document.getElementById('login-submit-btn');
    errorEl.textContent = '';

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    setLoading(btn, true);
    try {
        const res  = await fetch('/api/auth/login', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.detail || 'Login failed.'; return; }
        currentUser = data;
        updateAuthUI(currentUser);
        closeAuthModal();
    } catch {
        errorEl.textContent = 'Could not connect to server.';
    } finally {
        setLoading(btn, false);
    }
}

async function submitRegister(event) {
    event.preventDefault();
    const errorEl = document.getElementById('reg-error');
    const btn     = document.getElementById('reg-submit-btn');
    errorEl.textContent = '';

    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    setLoading(btn, true);
    try {
        const res  = await fetch('/api/auth/register', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) { errorEl.textContent = data.detail || 'Registration failed.'; return; }
        currentUser = data;
        updateAuthUI(currentUser);
        closeAuthModal();
    } catch {
        errorEl.textContent = 'Could not connect to server.';
    } finally {
        setLoading(btn, false);
    }
}

async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    currentUser = null;
    updateAuthUI(null);
    document.getElementById('saved-config-banner').classList.add('hidden');
}

// ── Save / Load Config ────────────────────────────────────

async function saveConfig() {
    if (!currentUser) return;

    const masterAddress = document.getElementById('master-address').value.trim();
    if (!masterAddress) return;

    const subInputs  = document.querySelectorAll('.sub-address');
    const wallets    = [
        { address: masterAddress, role: 'master', mode: null, target: null },
        ...Array.from(subInputs)
            .map(i => i.value.trim())
            .filter(a => a !== '')
            .map(addr => ({ address: addr, role: 'sub', mode: 'zero', target: null })),
    ];

    const btn = document.getElementById('save-config-btn');
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        const res = await fetch('/api/wallet-config', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ wallets }),
        });
        if (res.ok) {
            btn.textContent = 'Saved!';
            setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        } else {
            btn.textContent = 'Error';
            setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
        }
    } catch {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
}

async function loadSavedConfig() {
    try {
        const res  = await fetch('/api/wallet-config');
        const data = await res.json();
        if (!data.config || data.config.length === 0) return;

        const master = data.config.find(w => w.role === 'master');
        const subs   = data.config.filter(w => w.role === 'sub');

        if (master) {
            document.getElementById('master-address').value = master.address;
        }

        // Replace existing subwallet rows with saved ones
        const list = document.getElementById('subwallet-list');
        list.innerHTML = '';
        subs.forEach(w => {
            const row = document.createElement('div');
            row.className = 'subwallet-row';
            row.innerHTML = `
                <input type="text" placeholder="0x..." class="sub-address"
                    autocomplete="off" spellcheck="false" value="${w.address}" />
                <button class="btn-remove" onclick="removeSubwallet(this)" title="Remove">&#x2715;</button>
            `;
            list.appendChild(row);
        });

        dismissSavedBanner();
    } catch { /* ignore */ }
}

function dismissSavedBanner() {
    document.getElementById('saved-config-banner').classList.add('hidden');
}

// ── Init ──────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAuthModal();
});

checkAuthState();

// ── Copy to Clipboard ─────────────────────────────────────
document.getElementById('copy-btn').addEventListener('click', copyPlan);

function copyPlan() {
    const rows  = document.querySelectorAll('#transfer-body tr:not(.empty-row)');
    const lines = ['CryptoTreasury — Transfer Plan', ''];
    rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        lines.push(
            `${cells[0].textContent}. ${cells[1].textContent}  ` +
            `${cells[2].textContent} -> ${cells[3].textContent}  ` +
            `${cells[4].textContent}`
        );
    });
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const btn = document.getElementById('copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Plan', 2000);
    });
}
