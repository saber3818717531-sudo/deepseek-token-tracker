/**
 * Token & Cache Monitor for SillyTavern
 *
 * Inspired by RikkaHub (per-message badges) and CodeWhale (DeepSeek cache tracking).
 *
 * Features:
 *   - Multi-method token counting: API response → ST tokenizer → char estimate
 *   - Pre-send prompt-token estimation before the request fires
 *   - Per-message token badges (P / C / Cache / Cost)
 *   - Floating panel: last-request, cache (hit/miss/write), session totals, cost
 *   - Canvas trend chart of last 20 requests with cache-hit colouring
 *   - JSON / CSV one-click export
 *   - localStorage persistence so stats survive page reloads
 *   - Surgical fetch interception — wraps Response.prototype.json() only for ST proxy calls
 *   - Cache-breaker detection when system-prompt prefix changes
 *   - DeepSeek V3 / V4 Pro / V4 Flash pricing, custom model support
 *
 * Install: copy folder into SillyTavern/public/scripts/extensions/
 *   or paste GitHub repo URL into ST's extension installer.
 */

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    extensionSettings,
    getContext,
} from '../../../script.js';

// ── Crash diagnostics — catches ANY error before ST's loader swallows it ────
// ST's extension loader shows "[object Event]" when an uncaught error
// occurs during import or top-level execution. We save the real error
// to localStorage so the user can diagnose.
window.__tcm_diag = { errors: [] };
const _origOnerror = window.onerror;
window.onerror = function (msg, url, line, col, err) {
    const entry = { msg, url, line, col, stack: err?.stack || new Error().stack, time: Date.now() };
    window.__tcm_diag.errors.push(entry);
    try { localStorage.setItem('tcm_crash', JSON.stringify(entry)); } catch {}
    if (typeof _origOnerror === 'function') return _origOnerror(msg, url, line, col, err);
    return false;
};
window.addEventListener('unhandledrejection', function (e) {
    const entry = { reason: String(e.reason), stack: e.reason?.stack, time: Date.now() };
    window.__tcm_diag.errors.push(entry);
    try { localStorage.setItem('tcm_crash', JSON.stringify(entry)); } catch {}
});

// ── Constants ───────────────────────────────────────────────────────────────
const NAME = 'token-cache-monitor';
const HISTORY_MAX = 30;
const STATS_KEY  = 'tcm_stats_v1';
const HIST_KEY   = 'tcm_history_v1';

// Pricing (USD per 1M tokens) — source: DeepSeek API docs, June 2025
const PRICES = {
    'ds-v4-pro':   { input: 0.55, cacheHit: 0.14,  output: 2.19 },
    'ds-v4-flash': { input: 0.14, cacheHit: 0.0028, output: 0.28 },
    'ds-v3':       { input: 0.27, cacheHit: 0.07,  output: 1.10 },
};

// ST backend proxy endpoints we care about
const PROXY_PATHS = [
    '/api/backends/chat-completions',
    '/api/backends/text-completions',
    '/api/backends/generate',
];

// ── Settings ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
    panelCollapsed: false,
    panelPos:       { x: null, y: null },
    showCache:      true,
    showSession:    true,
    showCost:       true,
    showMsgBadges:  true,
    showTrend:      true,
    showWrite:      true,
    costModel:      'ds-v4-pro',
    customPrice:    { input: 0.55, cacheHit: 0.14, output: 2.19 },
};

let cfg = { ...DEFAULTS };

// ── Stats (persisted to localStorage) ────────────────────────────────────────
const S = {
    // Last request
    lastPrompt:      0,
    lastCompletion:  0,
    lastCacheHit:    0,
    lastCacheMiss:   0,
    lastCacheWrite:  0,
    // Session totals
    totalPrompt:     0,
    totalCompletion: 0,
    totalCacheHit:   0,
    totalCacheMiss:  0,
    totalCacheWrite: 0,
    requests:        0,
    cost:            0,
    streamTokens:    0,
    // Pre-send estimate
    preEstimate:     0,
    // Cache-breaker
    lastSysPrompt:   '',
    cacheBreaks:     0,
    // History ring (last N requests)
    history:         [],
};

// ── Persistence ──────────────────────────────────────────────────────────────
function saveStats() {
    try {
        const stats = {
            totalPrompt:     S.totalPrompt,
            totalCompletion: S.totalCompletion,
            totalCacheHit:   S.totalCacheHit,
            totalCacheMiss:  S.totalCacheMiss,
            totalCacheWrite: S.totalCacheWrite,
            requests:        S.requests,
            cost:            S.cost,
            cacheBreaks:     S.cacheBreaks,
            lastSysPrompt:   S.lastSysPrompt,
        };
        localStorage.setItem(STATS_KEY, JSON.stringify(stats));
        localStorage.setItem(HIST_KEY,  JSON.stringify(S.history));
    } catch {
        console.warn(`[${NAME}] localStorage write failed — stats won't survive reload.`);
    }
}

function loadStats() {
    try {
        const raw = localStorage.getItem(STATS_KEY);
        if (raw) {
            const d = JSON.parse(raw);
            S.totalPrompt     = d.totalPrompt     ?? 0;
            S.totalCompletion = d.totalCompletion ?? 0;
            S.totalCacheHit   = d.totalCacheHit   ?? 0;
            S.totalCacheMiss  = d.totalCacheMiss  ?? 0;
            S.totalCacheWrite = d.totalCacheWrite ?? 0;
            S.requests        = d.requests        ?? 0;
            S.cost            = d.cost            ?? 0;
            S.cacheBreaks     = d.cacheBreaks     ?? 0;
            S.lastSysPrompt   = d.lastSysPrompt   ?? '';
        }
        const rawH = localStorage.getItem(HIST_KEY);
        if (rawH) {
            S.history = JSON.parse(rawH);
            if (!Array.isArray(S.history)) S.history = [];
        }
        console.log(`[${NAME}] Stats restored: ${S.requests} requests, $${S.cost.toFixed(5)}`);
    } catch {
        console.warn(`[${NAME}] localStorage read failed — starting fresh.`);
    }
}

function clearPersisted() {
    try { localStorage.removeItem(STATS_KEY); } catch {}
    try { localStorage.removeItem(HIST_KEY); }  catch {}
}

let _saveTimer = null;
function saveDebounced() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveStats, 1500);
}

// ── Settings helpers ─────────────────────────────────────────────────────────
function loadCfg() {
    if (extensionSettings[NAME]) cfg = { ...DEFAULTS, ...extensionSettings[NAME] };
}
function saveCfg() {
    extensionSettings[NAME] = cfg;
    saveSettingsDebounced();
}
function price() {
    return cfg.costModel === 'custom' ? cfg.customPrice : (PRICES[cfg.costModel] || PRICES['ds-v4-pro']);
}

// ── Multi-method token estimation ────────────────────────────────────────────

/**
 * Estimate token count with runtime tokenizer detection:
 *   1. window.tokenizers.tiktoken — ST's built-in tokenizer (most versions)
 *   2. window.SillyTavern?.tokenizers — alternative ST global
 *   3. Character-based heuristic — universal fallback
 */
function estimateTokens(text) {
    if (!text) return 0;

    // Tier 1: ST's global tokenizers (most SillyTavern versions)
    try {
        if (window.tokenizers?.tiktoken?.encode) {
            return window.tokenizers.tiktoken.encode(text).length;
        }
        // Alternative global in some ST builds
        if (window.SillyTavern?.tokenizers?.tiktoken?.encode) {
            return window.SillyTavern.tokenizers.tiktoken.encode(text).length;
        }
    } catch {}

    // Tier 2: character heuristic
    const cjk  = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const rest = text.length - cjk;
    // CJK ~1.5 chars/token, Latin ~4 chars/token, mixed ~3
    return Math.round(cjk / 1.5 + rest / 4);
}

/**
 * Estimate prompt tokens before the API request fires.
 * Walks the current chat array and runs it through the estimator.
 */
function estimatePromptFromChat() {
    const ctx = getContext();
    if (!ctx?.chat?.length) return 0;

    let text = '';
    for (const msg of ctx.chat) {
        if (msg.system_prompt) text += msg.system_prompt + '\n';
        if (msg.mes)           text += msg.mes + '\n';
        if (msg.name)          text += msg.name + ': ';
    }
    // Add world info / author's note if available
    if (ctx.worldInfo) {
        try { text += JSON.stringify(ctx.worldInfo); } catch {}
    }
    return estimateTokens(text);
}

// ── Record request ───────────────────────────────────────────────────────────
function record(prompt, completion, cacheHit, cacheMiss, cacheWrite) {
    S.lastPrompt     = prompt;
    S.lastCompletion = completion;
    S.lastCacheHit   = cacheHit;
    S.lastCacheMiss  = cacheMiss;
    S.lastCacheWrite = cacheWrite ?? Math.max(0, cacheMiss); // default write = miss
    S.totalPrompt     += prompt;
    S.totalCompletion += completion;
    S.totalCacheHit   += cacheHit;
    S.totalCacheMiss  += cacheMiss;
    S.totalCacheWrite += S.lastCacheWrite;
    S.requests++;
    S.streamTokens = 0;
    S.preEstimate  = 0;

    const p = price();
    S.cost += (cacheMiss        / 1e6) * p.input
            + (cacheHit         / 1e6) * p.cacheHit
            + (completion       / 1e6) * p.output;

    S.history.unshift({
        time: Date.now(),
        prompt, completion, cacheHit, cacheMiss, cacheWrite: S.lastCacheWrite,
        cost: (cacheMiss / 1e6) * p.input + (cacheHit / 1e6) * p.cacheHit + (completion / 1e6) * p.output,
    });
    if (S.history.length > HISTORY_MAX) S.history.pop();

    saveDebounced();
    refresh();
}

// ── Cache-breaker detection ──────────────────────────────────────────────────
function checkPrefixChange() {
    const ctx = getContext();
    if (!ctx?.chat) return;
    const parts = [];
    if (ctx.chat.system_prompt) parts.push(ctx.chat.system_prompt);
    const current = parts.join('\n').slice(0, 2000);

    if (S.lastSysPrompt && S.lastSysPrompt !== current && S.requests > 0) {
        S.cacheBreaks++;
        console.log(`[${NAME}] ⚠ Cache-breaker #${S.cacheBreaks} — prefix changed.`);
    }
    S.lastSysPrompt = current;
}

// ── Usage extraction (multi-API) ─────────────────────────────────────────────
function extractUsage(data) {
    if (!data) return null;
    // OpenAI / DeepSeek
    if (data.usage?.prompt_tokens !== undefined) return data.usage;
    // Anthropic
    if (data.usage?.input_tokens !== undefined) {
        return { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens };
    }
    // Gemini
    if (data.usageMetadata) {
        return {
            prompt_tokens:    data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
        };
    }
    return null;
}

function unwrapUsage(usage) {
    const pt = usage.prompt_tokens || 0;
    const ct = usage.completion_tokens || 0;
    const ch = usage.prompt_cache_hit_tokens || 0;
    const cm = usage.prompt_cache_miss_tokens !== undefined
        ? usage.prompt_cache_miss_tokens
        : Math.max(0, pt - ch);
    const cw = usage.prompt_cache_write_tokens !== undefined
        ? usage.prompt_cache_write_tokens
        : null; // not all providers return this
    return { pt, ct, ch, cm, cw };
}

// ── Surgical fetch interception ──────────────────────────────────────────────
let _interceptActive = false;

function enableIntercept() {
    if (_interceptActive) return;
    _interceptActive = true;

    const OrigResponseProtoJson = Response.prototype.json;
    const OrigResponseProtoText = Response.prototype.text;

    Response.prototype.json = async function () {
        const data = await OrigResponseProtoJson.call(this);
        if (this.url && PROXY_PATHS.some(p => this.url.includes(p))) {
            const usage = extractUsage(data);
            if (usage) {
                const { pt, ct, ch, cm, cw } = unwrapUsage(usage);
                record(pt, ct, ch, cm, cw);
                data.__tcm_usage = { pt, ct, ch, cm, cw };
            }
        }
        return data;
    };

    Response.prototype.text = async function () {
        const text = await OrigResponseProtoText.call(this);
        if (this.url && PROXY_PATHS.some(p => this.url.includes(p))) {
            if (this.headers?.get?.('content-type')?.includes('text/event-stream')) {
                parseSSEUsage(text);
            }
        }
        return text;
    };
}

function parseSSEUsage(raw) {
    let usage = null;
    const lines = raw.split('\n');
    for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
            const chunk = JSON.parse(payload);
            if (chunk.usage) usage = chunk.usage;
            if (chunk.choices?.[0]?.usage) usage = chunk.choices[0].usage;
        } catch { /* skip */ }
    }
    if (usage) {
        const { pt, ct, ch, cm, cw } = unwrapUsage(usage);
        record(pt, ct, ch, cm, cw);
    }
}

// ── ST Event hooks ───────────────────────────────────────────────────────────
function hookEvents() {
    // Pre-send estimate
    eventSource.on(event_types.GENERATION_STARTED, () => {
        S.streamTokens = 0;
        S.preEstimate  = estimatePromptFromChat();
        checkPrefixChange();
        refresh();
    });

    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => {
        S.streamTokens++;
        refresh();
    });

    // User message sent — also estimate (MESSAGE_SENT may not exist in all ST)
    try {
        eventSource.on(event_types.MESSAGE_SENT, () => {
            S.preEstimate = estimatePromptFromChat();
            refresh();
        });
    } catch { /* event type may not exist */ }

    eventSource.on(event_types.GENERATION_ENDED, (data) => {
        if (data?.usage?.prompt_tokens !== undefined) {
            const u = data.usage;
            const pt = u.prompt_tokens || 0;
            const ct = u.completion_tokens || 0;
            const ch = u.prompt_cache_hit_tokens || 0;
            const cm = u.prompt_cache_miss_tokens ?? Math.max(0, pt - ch);
            const cw = u.prompt_cache_write_tokens ?? null;
            record(pt, ct, ch, cm, cw);
        } else if (S.streamTokens > 0 && S.lastCompletion === 0) {
            S.lastCompletion = S.streamTokens;
            S.totalCompletion += S.streamTokens;
            S.cost += (S.streamTokens / 1e6) * price().output;
            S.streamTokens = 0;
        }

        if (cfg.showMsgBadges) {
            setTimeout(addMessageBadge, 200);
        }

        S.streamTokens = 0;
        S.preEstimate = 0;
        refresh();
    });
}

// ── Per-message token badges (RikkaHub style) ────────────────────────────────
function addMessageBadge() {
    const ctx = getContext();
    if (!ctx?.chat?.length) return;

    const mesBlocks = document.querySelectorAll('.mes');
    if (!mesBlocks.length) return;

    const lastMes = mesBlocks[mesBlocks.length - 1];
    if (lastMes.querySelector('.tcm-msg-badge')) return;

    const badge = document.createElement('div');
    badge.className = 'tcm-msg-badge';

    const p  = S.lastPrompt;
    const c  = S.lastCompletion || S.streamTokens;
    const ch = S.lastCacheHit;
    const cw = S.lastCacheWrite;
    const cacheRate = p > 0 ? Math.round((ch / p) * 100) : null;

    let html = `<span class="tcm-badge-p">P:${fmt(p)}</span>`;
    html    += `<span class="tcm-badge-c">C:${fmt(c)}</span>`;
    if (ch > 0 || (cw !== null && cw > 0)) {
        const color = (cacheRate ?? 0) >= 50 ? '#4caf50' : (cacheRate ?? 0) >= 20 ? '#ff9800' : '#f44336';
        html += `<span class="tcm-badge-ch" style="color:${color}">⚡${fmt(ch)}`;
        if (cw !== null) html += ` | W:${fmt(cw)}`;
        html += ` (${cacheRate ?? 0}%)</span>`;
    }
    const pObj = price();
    const reqCost = (S.lastCacheMiss / 1e6) * pObj.input
                  + (S.lastCacheHit   / 1e6) * pObj.cacheHit
                  + (c / 1e6) * pObj.output;
    html += `<span class="tcm-badge-cost">$${reqCost.toFixed(5)}</span>`;

    badge.innerHTML = html;
    lastMes.appendChild(badge);
}

// ── Trend chart (Canvas) ─────────────────────────────────────────────────────
function drawTrend() {
    if (!cfg.showTrend) return;
    const canvas = document.getElementById('tcm-trend-canvas');
    if (!canvas) return;

    const W = canvas.width  = canvas.clientWidth  * (window.devicePixelRatio || 1);
    const H = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    const ctx2d = canvas.getContext('2d');
    ctx2d.clearRect(0, 0, W, H);

    const hist = S.history.slice(0, 20).reverse(); // oldest → newest
    if (hist.length < 2) {
        ctx2d.fillStyle = '#555';
        ctx2d.font = `${Math.round(H * 0.35)}px "Segoe UI", sans-serif`;
        ctx2d.textAlign = 'center';
        ctx2d.fillText('≥2 requests for trend', W / 2, H / 2);
        return;
    }

    const n = hist.length;
    const pad = { top: 8, right: 6, bottom: 14, left: 6 };
    const cw = (W - pad.left - pad.right) / n;
    const maxVal = Math.max(1, ...hist.map(h => h.prompt + h.completion));
    const chartH = H - pad.top - pad.bottom;

    // Bars
    for (let i = 0; i < n; i++) {
        const h = hist[i];
        const total = h.prompt + h.completion;
        const barH = Math.max(2, (total / maxVal) * chartH);
        const x = pad.left + i * cw;
        const y = H - pad.bottom - barH;
        const w = Math.max(1, cw - 2);

        // Color by cache hit rate
        const rate = h.prompt > 0 ? h.cacheHit / h.prompt : 0;
        if (rate >= 0.7)      ctx2d.fillStyle = '#4caf50';
        else if (rate >= 0.3) ctx2d.fillStyle = '#ff9800';
        else                  ctx2d.fillStyle = '#ef5350';

        ctx2d.fillRect(x, y, w, barH);

        // Prompt / Completion split line
        if (h.prompt > 0) {
            const promptH = (h.prompt / total) * barH;
            ctx2d.fillStyle = 'rgba(144, 202, 249, 0.4)'; // blue overlay for prompt portion
            ctx2d.fillRect(x, y, w, Math.min(promptH, barH));
        }
    }
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportJSON() {
    const data = {
        exportedAt: new Date().toISOString(),
        session: {
            totalPrompt:     S.totalPrompt,
            totalCompletion: S.totalCompletion,
            totalCacheHit:   S.totalCacheHit,
            totalCacheMiss:  S.totalCacheMiss,
            totalCacheWrite: S.totalCacheWrite,
            requests:        S.requests,
            cost:            S.cost,
            cacheBreaks:     S.cacheBreaks,
        },
        history: S.history,
        model: cfg.costModel,
        pricing: price(),
    };
    download(JSON.stringify(data, null, 2), `tcm-export-${Date.now()}.json`, 'application/json');
}

function exportCSV() {
    const headers = ['time', 'prompt', 'completion', 'cache_hit', 'cache_miss', 'cache_write', 'cost'];
    const rows = [headers.join(',')];
    for (const h of S.history) {
        rows.push([
            new Date(h.time).toISOString(),
            h.prompt,
            h.completion,
            h.cacheHit,
            h.cacheMiss,
            h.cacheWrite ?? '',
            h.cost.toFixed(8),
        ].join(','));
    }
    // Also append session summary
    rows.push('');
    rows.push('Session Summary');
    rows.push(`total_prompt,${S.totalPrompt}`);
    rows.push(`total_completion,${S.totalCompletion}`);
    rows.push(`total_cache_hit,${S.totalCacheHit}`);
    rows.push(`total_cache_miss,${S.totalCacheMiss}`);
    rows.push(`total_cache_write,${S.totalCacheWrite}`);
    rows.push(`requests,${S.requests}`);
    rows.push(`cost,${S.cost.toFixed(8)}`);
    rows.push(`model,${cfg.costModel}`);

    download(rows.join('\n'), `tcm-export-${Date.now()}.csv`, 'text/csv');
}

function download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 200);
}

// ── Floating panel UI ────────────────────────────────────────────────────────
let root = null;
let dragOn = false, dragX = 0, dragY = 0;

function $(sel) { return root?.querySelector(sel); }
function fmt(n) {
    if (n === undefined || n === null || isNaN(n)) return '-';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
}

function render() {
    if (!root) return;
    const ctx = getContext();
    const gen = ctx?.generating ?? false;

    const lastTot = S.lastPrompt + S.lastCompletion + S.streamTokens;
    const sesTot  = S.totalPrompt + S.totalCompletion + S.streamTokens;
    const cacheRt = S.lastPrompt > 0 ? Math.round((S.lastCacheHit / S.lastPrompt) * 100) : null;

    put('tcm-prompt',   fmt(S.lastPrompt));
    put('tcm-compl',    fmt(S.lastCompletion + S.streamTokens));
    put('tcm-total',    fmt(lastTot));
    put('tcm-preest',   S.preEstimate > 0 ? fmt(S.preEstimate) : '—');
    put('tcm-ch-hit',   fmt(S.lastCacheHit));
    put('tcm-ch-miss',  fmt(S.lastCacheMiss));
    put('tcm-ch-write', S.lastCacheWrite !== null ? fmt(S.lastCacheWrite) : '-');
    put('tcm-ch-rate',  cacheRt !== null ? cacheRt + '%' : '-');
    put('tcm-ses-p',    fmt(S.totalPrompt));
    put('tcm-ses-c',    fmt(S.totalCompletion + S.streamTokens));
    put('tcm-ses-t',    fmt(sesTot));
    put('tcm-ses-req',  S.requests);
    put('tcm-cost',     S.cost.toFixed(5));
    put('tcm-model',    cfg.costModel);
    put('tcm-dot',      gen ? '🟢' : '⚪');

    // Cache-breaker warning
    const cb = $('tcm-cb-warn');
    if (cb) cb.style.display = S.cacheBreaks > 0 ? '' : 'none';

    // Color cache rate
    const rate = $('tcm-ch-rate');
    if (rate && cacheRt !== null) {
        rate.style.color = cacheRt >= 50 ? '#4caf50' : cacheRt >= 20 ? '#ff9800' : '#f44336';
    }

    // Tooltip on cost
    const cost = $('tcm-cost');
    if (cost) {
        const last = S.history[0]?.cost ?? 0;
        cost.title = `Last: $${last.toFixed(6)}\nSession: $${S.cost.toFixed(6)}`;
    }

    // Trend chart
    if (cfg.showTrend) drawTrend();
}

function put(id, val) {
    const el = $(`#${id}`);
    if (el) el.textContent = val;
}

const PANEL = /* html */ `
<div id="tcm-panel" class="tcm-panel${cfg.panelCollapsed ? ' tcm-collapsed' : ''}">
  <div class="tcm-head">
    <span class="tcm-head-l"><span id="tcm-dot">⚪</span> Token Monitor</span>
    <span class="tcm-head-r">
      <button class="tcm-b" id="tcm-btn-s" title="Settings">⚙</button>
      <button class="tcm-b" id="tcm-btn-t" title="Collapse">${cfg.panelCollapsed ? '➕' : '➖'}</button>
      <button class="tcm-b" id="tcm-btn-r" title="Reset">↺</button>
      <button class="tcm-b" id="tcm-btn-x" title="Hide">✕</button>
    </span>
  </div>
  <div class="tcm-body"${cfg.panelCollapsed ? ' style="display:none"' : ''}>
    <div id="tcm-cb-warn" class="tcm-cb-warn" style="display:${S.cacheBreaks > 0 ? '' : 'none'}">
      ⚠ Cache broken ${S.cacheBreaks}x — prefix changed
    </div>

    <div class="tcm-sec">
      <div class="tcm-sec-t">▼ Last</div>
      <div class="tcm-r"><span>Prompt</span><span id="tcm-prompt">-</span></div>
      <div class="tcm-r"><span>Completion</span><span id="tcm-compl">-</span></div>
      <div class="tcm-r"><span>Total</span><span id="tcm-total">-</span></div>
      <div class="tcm-r"><span>Pre-send Est.</span><span class="tcm-est" id="tcm-preest">—</span></div>
    </div>

    <div class="tcm-sec" id="tcm-cache-sec"${cfg.showCache ? '' : ' style="display:none"'}>
      <div class="tcm-sec-t">▼ Cache</div>
      <div class="tcm-r"><span>Hit</span><span class="tcm-g" id="tcm-ch-hit">-</span></div>
      <div class="tcm-r"><span>Miss</span><span class="tcm-r2" id="tcm-ch-miss">-</span></div>
      <div class="tcm-r" id="tcm-cache-write-r"${cfg.showWrite ? '' : ' style="display:none"'}>
        <span>Write</span><span class="tcm-write" id="tcm-ch-write">-</span>
      </div>
      <div class="tcm-r"><span>Rate</span><span id="tcm-ch-rate">-</span></div>
    </div>

    <div class="tcm-sec" id="tcm-ses-sec"${cfg.showSession ? '' : ' style="display:none"'}>
      <div class="tcm-sec-t">▼ Session</div>
      <div class="tcm-r"><span>Prompt</span><span id="tcm-ses-p">0</span></div>
      <div class="tcm-r"><span>Completion</span><span id="tcm-ses-c">0</span></div>
      <div class="tcm-r"><span>Total</span><span id="tcm-ses-t">0</span></div>
      <div class="tcm-r"><span>Requests</span><span id="tcm-ses-req">0</span></div>
    </div>

    <div class="tcm-sec" id="tcm-cost-sec"${cfg.showCost ? '' : ' style="display:none"'}>
      <div class="tcm-sec-t">▼ Cost · <span id="tcm-model">-</span></div>
      <div class="tcm-r"><span>Estimate</span><span class="tcm-y" id="tcm-cost">0.00000</span></div>
    </div>

    <div class="tcm-sec" id="tcm-trend-sec"${cfg.showTrend ? '' : ' style="display:none"'}>
      <div class="tcm-sec-t">▼ Trend <span style="font-weight:400;font-size:10px;opacity:0.6">(last 20)</span></div>
      <div class="tcm-trend-wrap">
        <canvas id="tcm-trend-canvas"></canvas>
      </div>
    </div>

    <div class="tcm-export-btns">
      <button class="tcm-export-btn" id="tcm-btn-json" title="Export full stats + history as JSON">📥 JSON</button>
      <button class="tcm-export-btn" id="tcm-btn-csv"  title="Export history + summary as CSV">📥 CSV</button>
    </div>
  </div>
</div>`;

function buildUI() {
    if (root) root.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = PANEL;
    root = wrap.firstElementChild;
    document.body.appendChild(root);
    place();
    wireUI();
    render();
}

function place() {
    if (!root) return;
    if (cfg.panelPos.x !== null) {
        root.style.right = root.style.bottom = 'auto';
        root.style.left = cfg.panelPos.x + 'px';
        root.style.top  = cfg.panelPos.y + 'px';
    } else {
        root.style.left = root.style.top = 'auto';
        root.style.right = '12px';
        root.style.bottom = '90px';
    }
}

function wireUI() {
    $('#tcm-btn-t')?.addEventListener('click', toggle);
    $('#tcm-btn-r')?.addEventListener('click', reset);
    $('#tcm-btn-x')?.addEventListener('click', () => { root.style.display = root.style.display === 'none' ? '' : 'none'; });
    $('#tcm-btn-s')?.addEventListener('click', settings);
    $('#tcm-btn-json')?.addEventListener('click', exportJSON);
    $('#tcm-btn-csv')?.addEventListener('click', exportCSV);

    const head = root.querySelector('.tcm-head');
    head?.addEventListener('mousedown', e => {
        if (e.target.tagName === 'BUTTON') return;
        dragOn = true;
        const r = root.getBoundingClientRect();
        dragX = e.clientX - r.left;
        dragY = e.clientY - r.top;
        root.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (!dragOn) return;
        cfg.panelPos.x = e.clientX - dragX;
        cfg.panelPos.y = e.clientY - dragY;
        root.style.right = root.style.bottom = 'auto';
        root.style.left = cfg.panelPos.x + 'px';
        root.style.top  = cfg.panelPos.y + 'px';
    });
    document.addEventListener('mouseup', () => {
        if (!dragOn) return;
        dragOn = false;
        root.style.cursor = '';
        saveCfg();
    });
}

function toggle() {
    cfg.panelCollapsed = !cfg.panelCollapsed;
    saveCfg();
    const b = root.querySelector('.tcm-body');
    const btn = $('#tcm-btn-t');
    if (cfg.panelCollapsed) {
        b.style.display = 'none';
        if (btn) btn.textContent = '➕';
        root.classList.add('tcm-collapsed');
    } else {
        b.style.display = '';
        if (btn) btn.textContent = '➖';
        root.classList.remove('tcm-collapsed');
    }
}

function reset() {
    S.lastPrompt = S.lastCompletion = S.lastCacheHit = S.lastCacheMiss = S.lastCacheWrite = 0;
    S.totalPrompt = S.totalCompletion = S.totalCacheHit = S.totalCacheMiss = S.totalCacheWrite = 0;
    S.requests = S.cost = S.streamTokens = S.cacheBreaks = S.preEstimate = 0;
    S.history = [];
    clearPersisted();
    render();
}

// ── Settings overlay ─────────────────────────────────────────────────────────
function settings() {
    const ov = document.createElement('div');
    ov.className = 'tcm-overlay';
    ov.innerHTML = /* html */ `
      <div class="tcm-set">
        <h3>Token &amp; Cache Monitor</h3>
        <label><input type="checkbox" id="tcm-s-badge" ${cfg.showMsgBadges ? 'checked' : ''}> Per-message token badges</label>
        <label><input type="checkbox" id="tcm-s-cache" ${cfg.showCache ? 'checked' : ''}> Show cache section</label>
        <label><input type="checkbox" id="tcm-s-write" ${cfg.showWrite ? 'checked' : ''}> Show cache write tokens</label>
        <label><input type="checkbox" id="tcm-s-ses"   ${cfg.showSession ? 'checked' : ''}> Show session stats</label>
        <label><input type="checkbox" id="tcm-s-cost"  ${cfg.showCost ? 'checked' : ''}> Show cost estimate</label>
        <label><input type="checkbox" id="tcm-s-trend" ${cfg.showTrend ? 'checked' : ''}> Show trend chart</label>
        <label>Model: <select id="tcm-s-model">
          <option value="ds-v4-pro"   ${cfg.costModel === 'ds-v4-pro'   ? 'selected' : ''}>DeepSeek V4 Pro</option>
          <option value="ds-v4-flash" ${cfg.costModel === 'ds-v4-flash' ? 'selected' : ''}>DeepSeek V4 Flash</option>
          <option value="ds-v3"       ${cfg.costModel === 'ds-v3'       ? 'selected' : ''}>DeepSeek V3</option>
          <option value="custom"      ${cfg.costModel === 'custom'      ? 'selected' : ''}>Custom</option>
        </select></label>
        <div id="tcm-custom" style="display:${cfg.costModel === 'custom' ? 'block' : 'none'}">
          <label>Input $/M: <input type="number" id="tcm-s-in"  value="${cfg.customPrice.input}" step="0.0001"></label>
          <label>Cache $/M: <input type="number" id="tcm-s-ch"  value="${cfg.customPrice.cacheHit}" step="0.0001"></label>
          <label>Output $/M: <input type="number" id="tcm-s-out" value="${cfg.customPrice.output}" step="0.0001"></label>
        </div>
        <div class="tcm-set-btns">
          <button id="tcm-s-ok">Apply</button>
          <button id="tcm-s-no">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    ov.querySelector('#tcm-s-model').addEventListener('change', function () {
        ov.querySelector('#tcm-custom').style.display = this.value === 'custom' ? 'block' : 'none';
    });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#tcm-s-no').addEventListener('click', () => ov.remove());
    ov.querySelector('#tcm-s-ok').addEventListener('click', () => {
        cfg.showMsgBadges = ov.querySelector('#tcm-s-badge').checked;
        cfg.showCache     = ov.querySelector('#tcm-s-cache').checked;
        cfg.showWrite     = ov.querySelector('#tcm-s-write').checked;
        cfg.showSession   = ov.querySelector('#tcm-s-ses').checked;
        cfg.showCost      = ov.querySelector('#tcm-s-cost').checked;
        cfg.showTrend     = ov.querySelector('#tcm-s-trend').checked;
        cfg.costModel     = ov.querySelector('#tcm-s-model').value;
        if (cfg.costModel === 'custom') {
            cfg.customPrice.input    = +ov.querySelector('#tcm-s-in').value || 0;
            cfg.customPrice.cacheHit = +ov.querySelector('#tcm-s-ch').value || 0;
            cfg.customPrice.output   = +ov.querySelector('#tcm-s-out').value || 0;
        }
        saveCfg();
        ov.remove();
        rebuild();
    });
}

function rebuild() {
    if (!root) return buildUI();
    const pos = cfg.panelPos;
    const collapsed = cfg.panelCollapsed;
    root.remove();
    root = null;
    buildUI();
    if (collapsed) toggle();
    if (pos.x !== null) {
        root.style.left = pos.x + 'px';
        root.style.top  = pos.y + 'px';
        root.style.right = root.style.bottom = 'auto';
    }
    // Update section visibility
    const cache = $('#tcm-cache-sec');
    const ses   = $('#tcm-ses-sec');
    const cost  = $('#tcm-cost-sec');
    const trend = $('#tcm-trend-sec');
    const write = $('#tcm-cache-write-r');
    if (cache) cache.style.display = cfg.showCache ? '' : 'none';
    if (ses)   ses.style.display   = cfg.showSession ? '' : 'none';
    if (cost)  cost.style.display  = cfg.showCost ? '' : 'none';
    if (trend) trend.style.display = cfg.showTrend ? '' : 'none';
    if (write) write.style.display = cfg.showWrite ? '' : 'none';
    render();
}

// ── Message badge observer ───────────────────────────────────────────────────
function startBadgeObserver() {
    if (!cfg.showMsgBadges) return;
    const chatArea = document.querySelector('#chat');
    if (!chatArea) return setTimeout(startBadgeObserver, 1000);

    const observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1 && (node.classList?.contains('mes') || node.querySelector?.('.mes'))) {
                    setTimeout(addMessageBadge, 300);
                }
            }
        }
    });
    observer.observe(chatArea, { childList: true, subtree: true });
}

// ── Init ─────────────────────────────────────────────────────────────────────
function refresh() { render(); }

function init() {
    try {
        loadCfg();
        loadStats();
        enableIntercept();
        hookEvents();
        buildUI();
        startBadgeObserver();
        console.log(`[${NAME}] Ready — multi-method stats + persistence + trend + export.`);
    } catch (err) {
        const entry = { msg: String(err), stack: err?.stack, phase: 'init', time: Date.now() };
        window.__tcm_diag.errors.push(entry);
        try { localStorage.setItem('tcm_crash', JSON.stringify(entry)); } catch {}
        console.error(`[${NAME}] Init failed:`, err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

window.TokenCacheMonitor = { stats: S, cfg, reset, refresh, exportJSON, exportCSV, saveStats, loadStats };
