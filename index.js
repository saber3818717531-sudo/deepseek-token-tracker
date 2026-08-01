/**
 * 🐋 Token & Cache Monitor — FUSION build (v5.1)
 * 抓取引擎(自研 fetch+XHR 双拦截) + 分析面板/归一化/趋势图(GitHub版) + 消息账单 + 扩展栏条目 + 人民币
 */
import {
    eventSource, event_types, saveSettingsDebounced,
} from '../../../../script.js';
import {
    extension_settings as extensionSettings, getContext,
} from '../../../extensions.js';

// ═══════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════
const EXT_NAME = 'token-cache-monitor';
const MAX_HISTORY = 20;
let _currentChatId = '';
function getChatKey() {
    if (!_currentChatId) {
        try { _currentChatId = getContext()?.name2 || 'default'; } catch { _currentChatId = 'default'; }
    }
    return `tcm_fusion_${_currentChatId}`;
}

/** 每百万 tokens 价格，统一人民币 ¥（DeepSeek 按官方价，其余按汇率折算） */
const PRICING = {
    'deepseek-v4-pro':   { input: 12.0,  cacheHit: 1.0,   output: 24.0  },
    'deepseek-v4-flash': { input: 1.0,   cacheHit: 0.02,  output: 2.0   },
    'deepseek-v3':       { input: 2.0,   cacheHit: 0.2,   output: 8.0   },
    'deepseek-r1':       { input: 4.0,   cacheHit: 1.0,   output: 16.0  },
    'claude-sonnet-4':   { input: 21.8,  cacheHit: 2.18,  output: 109.0 },
    'claude-haiku-4-5':  { input: 5.8,   cacheHit: 0.58,  output: 29.0  },
    'gpt-4o':            { input: 18.0,  cacheHit: 9.0,   output: 72.0  },
    'gpt-4o-mini':       { input: 1.1,   cacheHit: 0.55,  output: 4.4   },
};

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════
const defaults = {
    panelCollapsed: false,
    panelPosition:  { x: null, y: null },
    showCacheInfo:  true,
    showSession:    true,
    showCost:       true,
    showThroughput: true,
    showTrend:      true,
    showInChat:     true,
    verbose:        true,
    apiUrl:         'https://api.deepseek.com',
    costModel:      'deepseek-v4-flash',
    customPricing:  { input: 1.0, cacheHit: 0.02, output: 2.0 },
};
let cfg = { ...defaults };

const stats = {
    lastPrompt: 0, lastCompletion: 0, lastCacheHit: 0, lastCacheMiss: 0,
    lastTime: 0, lastDuration: 0,
    totalPrompt: 0, totalCompletion: 0, totalCacheHit: 0, totalCacheMiss: 0,
    requests: 0, cost: 0, totalDuration: 0,
    streamingCount: 0, genStartTime: 0,
    history: [],
};

// ═══════════════════════════════════════════════════════════════════════
// Per-chat persistence
// ═══════════════════════════════════════════════════════════════════════
function saveSession() {
    try {
        localStorage.setItem(getChatKey(), JSON.stringify({
            totalPrompt: stats.totalPrompt, totalCompletion: stats.totalCompletion,
            totalCacheHit: stats.totalCacheHit, totalCacheMiss: stats.totalCacheMiss,
            requests: stats.requests, cost: stats.cost, totalDuration: stats.totalDuration,
            history: stats.history.slice(0, MAX_HISTORY), savedAt: Date.now(),
        }));
    } catch {}
}
function loadSession() {
    try {
        const snap = JSON.parse(localStorage.getItem(getChatKey()) || 'null');
        if (!snap) return;
        for (const k of ['totalPrompt','totalCompletion','totalCacheHit','totalCacheMiss','requests','cost','totalDuration'])
            if (snap[k] !== undefined) stats[k] = snap[k];
        if (Array.isArray(snap.history)) stats.history = snap.history.slice(0, MAX_HISTORY);
    } catch {}
}
function clearSession() { try { localStorage.removeItem(getChatKey()); } catch {} }

function loadCfg() { if (extensionSettings[EXT_NAME]) cfg = { ...defaults, ...extensionSettings[EXT_NAME] }; }
function saveCfg() { extensionSettings[EXT_NAME] = cfg; saveSettingsDebounced(); }

// ═══════════════════════════════════════════════════════════════════════
// Pricing / log
// ═══════════════════════════════════════════════════════════════════════
function getPricing() {
    return cfg.costModel === 'custom' ? cfg.customPricing
        : (PRICING[cfg.costModel] || PRICING['deepseek-v4-flash']);
}
const log = (...a) => { if (cfg.verbose) console.log('%c[TCM🐋]', 'color:#4fc3f7;font-weight:bold', ...a); };

// ═══════════════════════════════════════════════════════════════════════
// Record
// ═══════════════════════════════════════════════════════════════════════
function record(prompt, completion, cacheHit, cacheMiss, durationMs) {
    const now = Date.now();
    stats.lastPrompt = prompt; stats.lastCompletion = completion;
    stats.lastCacheHit = cacheHit; stats.lastCacheMiss = cacheMiss; stats.lastTime = now;
    stats.lastDuration = durationMs || (now - (stats.genStartTime || now));
    stats.totalPrompt += prompt; stats.totalCompletion += completion;
    stats.totalCacheHit += cacheHit; stats.totalCacheMiss += cacheMiss;
    stats.requests++; stats.totalDuration += stats.lastDuration; stats.streamingCount = 0;

    const p = getPricing();
    const costThis = (cacheMiss / 1e6) * p.input + (cacheHit / 1e6) * p.cacheHit + (completion / 1e6) * p.output;
    stats.cost += costThis;

    const tps = stats.lastDuration > 0 ? Math.round(completion / (stats.lastDuration / 1000)) : 0;
    const totIn = cacheHit + cacheMiss;
    const effScore = totIn > 0 ? Math.round((cacheHit / totIn) * 100) : 0;
    stats.history.unshift({ time: now, prompt, completion, cacheHit, cacheMiss, cost: costThis, tps, effScore, duration: stats.lastDuration });
    if (stats.history.length > MAX_HISTORY) stats.history.pop();

    log('✅ usage →', `in=${prompt} out=${completion} hit=${cacheHit} miss=${cacheMiss} 本次=${fmtCost(costThis)} 累计=${fmtCost(stats.cost)}`);
    saveSession(); refresh();
    if (cfg.showInChat) setTimeout(() => insertStatsIntoChat({ prompt, completion, cacheHit, cacheMiss }, costThis), 400);
}

// ═══════════════════════════════════════════════════════════════════════
// usage 归一化
// ═══════════════════════════════════════════════════════════════════════
function normalizeUsage(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const input  = raw.prompt_tokens ?? raw.input_tokens ?? 0;
    const output = raw.completion_tokens ?? raw.output_tokens ?? 0;
    const cacheRead = raw.prompt_tokens_details?.cached_tokens
        ?? raw.cache_read_input_tokens
        ?? raw.prompt_cache_hit_tokens
        ?? 0;
    const cacheWrite = raw.cache_creation_input_tokens ?? 0;
    let normIn = input;
    if (raw.input_tokens != null && (raw.cache_read_input_tokens || raw.cache_creation_input_tokens))
        normIn = input + cacheRead + cacheWrite;
    if (!normIn && !output) return null;
    return { input: normIn, output, cacheRead, cacheWrite, total: normIn + output };
}
function tryExtractUsage(text) {
    if (!text) return null;
    try { const j = JSON.parse(text); if (j?.usage) return j.usage; } catch {}
    const lines = text.split('\n');
    let merged = null;
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
            const j = JSON.parse(payload);
            const u = j?.usage || j?.message?.usage || j?.choices?.[0]?.usage;
            if (u && (u.prompt_tokens || u.input_tokens || u.completion_tokens || u.output_tokens)) {
                merged = { ...(merged || {}), ...u };
                if (u.prompt_tokens || u.input_tokens) break;
            }
        } catch {}
    }
    return merged;
}

// ═══════════════════════════════════════════════════════════════════════
// 抓取引擎：放宽URL + 注入stream_options + 旁路克隆（fetch & XHR）
// ═══════════════════════════════════════════════════════════════════════
function isChatUrl(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    const custom = (cfg.apiUrl || '').toLowerCase().replace(/\/+$/, '');
    return /\/(backends\/(chat|text)-completions|generate)/i.test(u)

        || u.includes('chat/completions') || u.includes('/v1/')
        || (custom && u.includes(custom));
}
function injectStreamOptions(bodyStr) {
    try {
        const b = JSON.parse(bodyStr);
        if (b && typeof b === 'object') { b.stream_options = { include_usage: true }; return JSON.stringify(b); }
    } catch {}
    return bodyStr;
}
function handleUsageFromText(text, startTs) {
    const raw = tryExtractUsage(text);
    const u = normalizeUsage(raw);
    if (!u || u.total <= 0) { log('⚠️ 响应里没找到 usage'); return; }
    const dur = startTs ? performance.now() - startTs : 0;
    record(u.input, u.output, u.cacheRead, Math.max(0, u.input - u.cacheRead), dur);
}

const _fetch = window.fetch.bind(window);
window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
    if (!isChatUrl(url)) return _fetch(...args);
    log('🔎 fetch 命中 →', url);
    const startTs = performance.now();
    let init = args[1];
    if (init?.body) { const nb = injectStreamOptions(init.body); if (nb !== init.body) { init = { ...init, body: nb }; log('   注入 stream_options'); } }
    const resp = await _fetch(...args);
    if (resp.ok) {
        try {
            const clone = resp.clone();
            const ct = (resp.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('event-stream') || ct.includes('stream')) {
                readSSEUsage(clone).then(raw => {
                    const u = normalizeUsage(raw);
                    if (u && u.total > 0) record(u.input, u.output, u.cacheRead, Math.max(0, u.input - u.cacheRead), performance.now() - startTs);
                    else log('⚠️ 流式没读到 usage');
                }).catch(e => log('SSE 读取失败', e));
            } else {
                clone.text().then(t => handleUsageFromText(t, startTs)).catch(() => {});
            }
        } catch (e) { log('clone 失败', e); }
    }
    return resp;
};
async function readSSEUsage(resp) {
    const reader = resp.body.getReader(); const dec = new TextDecoder();
    let buf = '', usage = {};
    const merge = u => { if (!u) return; for (const k of Object.keys(u)) { const v = u[k]; if (typeof v === 'number' && v > 0) usage[k] = v; else if (v && typeof v === 'object') usage[k] = { ...(usage[k] || {}), ...v }; } };
    while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
            const s = line.trim(); if (!s.startsWith('data:')) continue;
            const p = s.slice(5).trim(); if (!p || p === '[DONE]') continue;
            try { const o = JSON.parse(p); merge(o.usage); merge(o.message?.usage); if (o.choices?.[0]?.usage) merge(o.choices[0].usage); } catch {}
        }
    }
    return Object.keys(usage).length ? usage : null;
}

const _xhrOpen = XMLHttpRequest.prototype.open, _xhrSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__tcmUrl = url; return _xhrOpen.call(this, m, url, ...r); };
XMLHttpRequest.prototype.send = function (body) {
    if (!isChatUrl(this.__tcmUrl)) return _xhrSend.call(this, body);
    log('🔎 XHR 命中 →', this.__tcmUrl);
    const startTs = performance.now();
    let nb = body; if (body) { const x = injectStreamOptions(body); if (x !== body) nb = x; }
    let lastU = null;
    const eat = () => { const u = tryExtractUsage(this.responseText || ''); if (u && u !== lastU) { lastU = u; const n = normalizeUsage(u); if (n && n.total > 0) record(n.input, n.output, n.cacheRead, Math.max(0, n.input - n.cacheRead), performance.now() - startTs); } };
    this.addEventListener('progress', eat);
    this.addEventListener('load', eat);
    return _xhrSend.call(this, nb);
};

// ═══════════════════════════════════════════════════════════════════════
// ST 事件钩子
// ═══════════════════════════════════════════════════════════════════════
function hookEvents() {
    eventSource.on(event_types.GENERATION_STARTED, () => { stats.streamingCount = 0; stats.genStartTime = Date.now(); refresh(); });
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, () => { stats.streamingCount++; if (stats.streamingCount % 5 === 0) refresh(); });
    eventSource.on(event_types.CHAT_CHANGED, () => {
        try {
            const id = getContext()?.name2 || '';
            if (!id || id === _currentChatId) return;
            saveSession(); _currentChatId = id; resetStats(); loadSession(); refresh();
        } catch {}
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Analytics
// ═══════════════════════════════════════════════════════════════════════
const cacheEfficiencyScore = () => { const t = stats.totalCacheHit + stats.totalCacheMiss; return t > 0 ? Math.round(stats.totalCacheHit / t * 100) : 0; };
const avgTokensPerRequest  = () => stats.requests > 0 ? Math.round((stats.totalPrompt + stats.totalCompletion) / stats.requests) : 0;
function avgThroughput() { const v = stats.history.filter(h => h.tps > 0); return v.length ? Math.round(v.reduce((s, h) => s + h.tps, 0) / v.length) : 0; }
const projectedCost = (n = 50) => stats.requests === 0 ? 0 : stats.cost + (stats.cost / stats.requests) * n;
function effLabel(s) {
    if (s >= 80) return { text: '优秀', color: '#4caf50' };
    if (s >= 50) return { text: '良好', color: '#8bc34a' };
    if (s >= 30) return { text: '一般', color: '#ff9800' };
    return { text: '较低', color: '#f44336' };
}

// ═══════════════════════════════════════════════════════════════════════
// 格式
// ═══════════════════════════════════════════════════════════════════════
function fmt(n) {
    if (n == null || isNaN(n)) return '-';
    if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
    if (n >= 1000) return n.toLocaleString();
    return String(Math.round(n));
}
function fmtCost(n) {
    if (n == null || isNaN(n)) return '¥0.0000';
    if (n >= 1) return '¥' + n.toFixed(2);
    if (n >= 0.01) return '¥' + n.toFixed(4);
    return '¥' + n.toFixed(6);
}

// ═══════════════════════════════════════════════════════════════════════
// 浮动面板渲染
// ═══════════════════════════════════════════════════════════════════════
let root = null, dragging = false, dX = 0, dY = 0;
const $ = s => root?.querySelector(s);
function setText(id, v) { const e = $(`#${id}`); if (e) e.textContent = v; }
function render() {
    if (!root) return;
    const gen = getContext()?.generating ?? false;
    const lastTotal = stats.lastPrompt + stats.lastCompletion + stats.streamingCount;
    const sesTotal  = stats.totalPrompt + stats.totalCompletion + stats.streamingCount;
    const lastRate  = stats.lastPrompt > 0 ? Math.round(stats.lastCacheHit / stats.lastPrompt * 100) : null;
    const eff = cacheEfficiencyScore(), el = effLabel(eff), tps = avgThroughput();
    setText('tcm-prompt', fmt(stats.lastPrompt));
    setText('tcm-completion', fmt(stats.lastCompletion + stats.streamingCount));
    setText('tcm-total', fmt(lastTotal));
    setText('tcm-tps', stats.lastDuration > 0 ? Math.round((stats.lastCompletion || stats.streamingCount) / (stats.lastDuration / 1000)) + ' tok/秒' : '-');
    setText('tcm-ch-hit', fmt(stats.lastCacheHit)); setText('tcm-ch-miss', fmt(stats.lastCacheMiss));
    setText('tcm-ch-rate', lastRate !== null ? lastRate + '%' : '-');
    setText('tcm-eff-score', eff); setText('tcm-eff-label', el.text);
    const se = $('#tcm-eff-score'), le = $('#tcm-eff-label'); if (se) se.style.color = el.color; if (le) le.style.color = el.color;
    setText('tcm-ses-prompt', fmt(stats.totalPrompt)); setText('tcm-ses-compl', fmt(stats.totalCompletion + stats.streamingCount));
    setText('tcm-ses-total', fmt(sesTotal)); setText('tcm-ses-req', stats.requests);
    setText('tcm-ses-avg', fmt(avgTokensPerRequest())); setText('tcm-ses-tps', tps > 0 ? tps + ' tok/秒' : '-');
    setText('tcm-cost', fmtCost(stats.cost)); setText('tcm-cost-proj', fmtCost(projectedCost(50))); setText('tcm-model', cfg.costModel);
    const re = $('#tcm-ch-rate'); if (re && lastRate !== null) re.style.color = lastRate >= 50 ? '#4caf50' : lastRate >= 20 ? '#ff9800' : '#f44336';
    const bar = $('#tcm-eff-bar-fill'); if (bar) { bar.style.width = eff + '%'; bar.style.background = el.color; }
    const dot = $('#tcm-dot'); if (dot) { dot.textContent = gen ? '🟢' : '⚪'; dot.title = gen ? `生成中 (${stats.streamingCount} tok, ${tps || '?'} tok/秒)` : '空闲'; }
    drawTrend();
    updateExtDrawer();   // ★ 同步扩展栏条目的累计数字
}
function drawTrend() {
    const c = $('#tcm-trend-bars'); if (!c || !cfg.showTrend) return;
    const bars = c.querySelectorAll('.tcm-trend-bar'), items = stats.history.slice(0, bars.length).reverse();
    bars.forEach((bar, i) => {
        const it = items[i];
        if (it) {
            const m = Math.max(it.prompt, it.completion, 1);
            bar.querySelector('.tcm-trend-p').style.height = (it.prompt / m * 100) + '%';
            bar.querySelector('.tcm-trend-c').style.height = (it.completion / m * 100) + '%';
            bar.title = `#${stats.requests - items.length + i + 1}: 入${fmt(it.prompt)} 出${fmt(it.completion)} @${it.tps}tok/秒`;
            bar.style.opacity = '1';
        } else {
            bar.querySelector('.tcm-trend-p').style.height = '0%'; bar.querySelector('.tcm-trend-c').style.height = '0%'; bar.style.opacity = '0.4';
        }
    });
}

function insertStatsIntoChat(u, cost) {
    const $mes = (window.jQuery || window.$)?.('#chat .mes').last?.();
    if (!$mes || !$mes.length) return;
    $mes.find('.ds-token-stats').remove();
    const tot = u.cacheHit + u.cacheMiss;
    const html = `<div class="ds-token-stats">
      <span class="ds-stat-title">📊 Token 统计</span>
      <span>输入: <b>${fmt(u.prompt)}</b></span><span>输出: <b>${fmt(u.completion)}</b></span>
      <span>缓存总计: <b>${fmt(tot)}</b></span><span class="ds-hit">命中: <b>${fmt(u.cacheHit)}</b></span>
      <span class="ds-miss">未命中: <b>${fmt(u.cacheMiss)}</b></span><span class="ds-cost">本次: <b>${fmtCost(cost)}</b></span>
      <span class="ds-total">累计: <b>${fmtCost(stats.cost)}</b> (${stats.requests}次)</span></div>`;
    const $b = $mes.find('.mes_block'); ($b.length ? $b : $mes).append(html);
}

const PANEL_HTML = /* html */ `
<div id="tcm-panel" class="tcm-panel${cfg.panelCollapsed ? ' tcm-collapsed' : ''}">
  <div class="tcm-head">
    <span class="tcm-head-left"><span id="tcm-dot" class="tcm-dot" title="空闲">⚪</span><span class="tcm-title">🐋 Token 监控</span></span>
    <span class="tcm-head-btns">
      <button class="tcm-btn" id="tcm-btn-settings" title="设置">⚙</button>
      <button class="tcm-btn" id="tcm-btn-toggle" title="折叠">${cfg.panelCollapsed ? '➕' : '➖'}</button>
      <button class="tcm-btn" id="tcm-btn-reset"  title="重置统计">↺</button>
      <button class="tcm-btn" id="tcm-btn-close"  title="关闭面板">✕</button>
    </span>
  </div>
  <div class="tcm-body"${cfg.panelCollapsed ? ' style="display:none"' : ''}>
    <div class="tcm-section"><div class="tcm-section-title">▼ 本次请求</div>
      <div class="tcm-row"><span>输入</span><span id="tcm-prompt">-</span></div>
      <div class="tcm-row"><span>输出</span><span id="tcm-completion">-</span></div>
      <div class="tcm-row"><span>合计</span><span id="tcm-total">-</span></div>
      <div class="tcm-row"><span>速度</span><span id="tcm-tps">-</span></div></div>
    <div class="tcm-section" id="tcm-cache-section"${cfg.showCacheInfo ? '' : ' style="display:none"'}><div class="tcm-section-title">▼ 缓存命中</div>
      <div class="tcm-row"><span>命中</span><span class="tcm-green" id="tcm-ch-hit">-</span></div>
      <div class="tcm-row"><span>未命中</span><span class="tcm-red" id="tcm-ch-miss">-</span></div>
      <div class="tcm-row"><span>命中率</span><span id="tcm-ch-rate">-</span></div>
      <div class="tcm-row" style="margin-top:4px"><span>效率评分</span><span><span id="tcm-eff-score" style="font-weight:700">0</span> <span id="tcm-eff-label" style="font-size:10px">-</span></span></div>
      <div class="tcm-eff-bar"><div class="tcm-eff-bar-fill" id="tcm-eff-bar-fill"></div></div></div>
    <div class="tcm-section" id="tcm-session-section"${cfg.showSession ? '' : ' style="display:none"'}><div class="tcm-section-title">▼ 会话统计</div>
      <div class="tcm-row"><span>输入</span><span id="tcm-ses-prompt">0</span></div>
      <div class="tcm-row"><span>输出</span><span id="tcm-ses-compl">0</span></div>
      <div class="tcm-row"><span>合计</span><span id="tcm-ses-total">0</span></div>
      <div class="tcm-row"><span>请求数</span><span id="tcm-ses-req">0</span></div>
      <div class="tcm-row"><span>平均/请求</span><span id="tcm-ses-avg">0</span></div>
      <div class="tcm-row"><span>平均速度</span><span id="tcm-ses-tps">-</span></div></div>
    <div class="tcm-section" id="tcm-cost-section"${cfg.showCost ? '' : ' style="display:none"'}><div class="tcm-section-title">▼ 费用(¥) · <span id="tcm-model">-</span></div>
      <div class="tcm-row tcm-cost-row"><span>本次会话</span><span id="tcm-cost">¥0.0000</span></div>
      <div class="tcm-row tcm-cost-row"><span>预计 +50条</span><span id="tcm-cost-proj">¥0.0000</span></div></div>
    <div class="tcm-section" id="tcm-trend-section"${cfg.showTrend ? '' : ' style="display:none"'}><div class="tcm-section-title">▼ 趋势 (最近 ${MAX_HISTORY} 次)</div>
      <div class="tcm-trend-container"><div class="tcm-trend-bars" id="tcm-trend-bars">
        ${Array.from({ length: MAX_HISTORY }, () => `<div class="tcm-trend-bar"><div class="tcm-trend-p" style="height:0%"></div><div class="tcm-trend-c" style="height:0%"></div></div>`).join('')}
      </div><div class="tcm-trend-legend"><span><span class="tcm-legend-p"></span>输入</span><span><span class="tcm-legend-c"></span>输出</span></div></div></div>
  </div>
</div>`;

// —— ★ 扩展设置区折叠条（让图1扩展列表出现条目）——
const EXT_DRAWER_HTML = `
<div id="tcm_ext_settings" class="extension-settings">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🐋 Token &amp; Cache 监控</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
    </div>
    <div class="inline-drawer-content" style="display:block">
      <div class="tcm-ext-grid">
        <span>请求次数</span><span id="tcm-ext-req">0</span>
        <span>总输入</span><span id="tcm-ext-in">0</span>
        <span>总输出</span><span id="tcm-ext-out">0</span>
        <span>缓存命中</span><span id="tcm-ext-hit" class="tcm-green">0</span>
        <span>缓存未命中</span><span id="tcm-ext-miss" class="tcm-red">0</span>
        <span>累计消费</span><span id="tcm-ext-cost">¥0.0000</span>
      </div>
      <div class="tcm-ext-btns">
        <button id="tcm-ext-open" class="menu_button">⚙ 面板设置</button>
        <button id="tcm-ext-reset" class="menu_button">🗑 重置累计</button>
      </div>
      <div class="tcm-ext-note">计费(¥/百万)：命中 <b id="tcm-ext-p-hit"></b> · 未命中 <b id="tcm-ext-p-in"></b> · 输出 <b id="tcm-ext-p-out"></b> · 模型 <b id="tcm-ext-model"></b></div>
      <div class="tcm-ext-note">斜杠命令：<code>/token</code> 查看摘要 · <code>/tokenreset</code> 重置</div>
    </div>
  </div>
</div>`;

function updateExtDrawer() {
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    set('tcm-ext-req', stats.requests);
    set('tcm-ext-in', fmt(stats.totalPrompt));
    set('tcm-ext-out', fmt(stats.totalCompletion));
    set('tcm-ext-hit', fmt(stats.totalCacheHit));
    set('tcm-ext-miss', fmt(stats.totalCacheMiss));
    set('tcm-ext-cost', fmtCost(stats.cost));
    const p = getPricing();
    set('tcm-ext-p-hit', p.cacheHit); set('tcm-ext-p-in', p.input); set('tcm-ext-p-out', p.output);
    set('tcm-ext-model', cfg.costModel);
}
function bindExtDrawer() {
    document.getElementById('tcm-ext-open')?.addEventListener('click', openSettings);
    document.getElementById('tcm-ext-reset')?.addEventListener('click', () => {
        resetStats(); clearSession(); refresh();
        if (window.toastr) toastr.success('累计统计已重置');
    });
}
function injectExtDrawer() {
    try {
        const jq = window.jQuery || window.$;
        if (!jq || !jq('#extensions_settings').length) { log('⚠️ 未找到 #extensions_settings，跳过扩展栏条目（不影响面板）'); return; }
        jq('#tcm_ext_settings').remove();
        jq('#extensions_settings').append(EXT_DRAWER_HTML);
        bindExtDrawer(); updateExtDrawer();
        log('✅ 扩展栏条目已注入');
    } catch (e) { log('扩展栏注入失败（不影响面板）', e); }
}

function createUI() {
    if (root) root.remove();
    const w = document.createElement('div'); w.innerHTML = PANEL_HTML; root = w.firstElementChild;
    document.body.appendChild(root); position(); bindUI(); render();
}
function position() {
    if (!root) return;
    if (cfg.panelPosition.x !== null) { root.style.right = 'auto'; root.style.bottom = 'auto'; root.style.left = cfg.panelPosition.x + 'px'; root.style.top = cfg.panelPosition.y + 'px'; }
    else { root.style.left = 'auto'; root.style.top = 'auto'; root.style.right = '12px'; root.style.bottom = '90px'; }
}
function bindUI() {
    $('#tcm-btn-toggle')?.addEventListener('click', toggle);
    $('#tcm-btn-reset')?.addEventListener('click', () => { resetStats(); clearSession(); refresh(); if (window.toastr) toastr.success('统计已重置'); });
    $('#tcm-btn-close')?.addEventListener('click', () => { root.style.display = root.style.display === 'none' ? '' : 'none'; });
    $('#tcm-btn-settings')?.addEventListener('click', openSettings);
    const head = root.querySelector('.tcm-head');
    const start = (x, y) => { const r = root.getBoundingClientRect(); dX = x - r.left; dY = y - r.top; dragging = true; root.style.cursor = 'grabbing'; };
    const move  = (x, y) => { if (!dragging) return; cfg.panelPosition.x = x - dX; cfg.panelPosition.y = y - dY; root.style.right = 'auto'; root.style.bottom = 'auto'; root.style.left = cfg.panelPosition.x + 'px'; root.style.top = cfg.panelPosition.y + 'px'; };
    const end   = () => { if (!dragging) return; dragging = false; root.style.cursor = ''; saveCfg(); };
    head?.addEventListener('mousedown', e => { if (e.target.tagName === 'BUTTON') return; start(e.clientX, e.clientY); e.preventDefault(); });
    document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
    document.addEventListener('mouseup', end);
    head?.addEventListener('touchstart', e => { if (e.target.tagName === 'BUTTON') return; const t = e.touches[0]; start(t.clientX, t.clientY); }, { passive: true });
    head?.addEventListener('touchmove', e => { if (!dragging) return; const t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    head?.addEventListener('touchend', end);
    head?.addEventListener('dblclick', toggle);
}
function toggle() {
    cfg.panelCollapsed = !cfg.panelCollapsed; saveCfg();
    const body = root.querySelector('.tcm-body'), btn = $('#tcm-btn-toggle');
    if (cfg.panelCollapsed) { body.style.display = 'none'; if (btn) btn.textContent = '➕'; root.classList.add('tcm-collapsed'); }
    else { body.style.display = ''; if (btn) btn.textContent = '➖'; root.classList.remove('tcm-collapsed'); }
}
function resetStats() {
    Object.assign(stats, { lastPrompt:0,lastCompletion:0,lastCacheHit:0,lastCacheMiss:0,lastTime:0,lastDuration:0,
        totalPrompt:0,totalCompletion:0,totalCacheHit:0,totalCacheMiss:0,requests:0,cost:0,totalDuration:0,streamingCount:0,genStartTime:0,history:[] });
}
function rebuild() { if (!root) return; const p = cfg.panelPosition, c = cfg.panelCollapsed; root.remove(); root = null; createUI(); if (c) toggle(); if (p.x !== null) { root.style.left = p.x + 'px'; root.style.top = p.y + 'px'; root.style.right = 'auto'; root.style.bottom = 'auto'; } }

function openSettings() {
    const ov = document.createElement('div'); ov.className = 'tcm-overlay';
    ov.innerHTML = /* html */ `
    <div class="tcm-settings-box"><h3>🐋 Token 监控设置</h3>
      <label><input type="checkbox" id="tcm-set-cache" ${cfg.showCacheInfo?'checked':''}> 显示缓存命中区域</label>
      <label><input type="checkbox" id="tcm-set-session" ${cfg.showSession?'checked':''}> 显示会话统计</label>
      <label><input type="checkbox" id="tcm-set-cost" ${cfg.showCost?'checked':''}> 显示费用估算</label>
      <label><input type="checkbox" id="tcm-set-tput" ${cfg.showThroughput?'checked':''}> 显示吞吐量 (tok/秒)</label>
      <label><input type="checkbox" id="tcm-set-trend" ${cfg.showTrend?'checked':''}> 显示迷你趋势图</label>
      <label><input type="checkbox" id="tcm-set-inchat" ${cfg.showInChat?'checked':''}> 在每条回复下方挂账单</label>
      <label><input type="checkbox" id="tcm-set-verbose" ${cfg.verbose?'checked':''}> 控制台抓取诊断日志</label>
      <label>计价模型: <select id="tcm-set-model">
        <option value="deepseek-v4-flash" ${cfg.costModel==='deepseek-v4-flash'?'selected':''}>DeepSeek V4 Flash</option>
        <option value="deepseek-v4-pro" ${cfg.costModel==='deepseek-v4-pro'?'selected':''}>DeepSeek V4 Pro</option>
        <option value="deepseek-v3" ${cfg.costModel==='deepseek-v3'?'selected':''}>DeepSeek V3</option>
        <option value="deepseek-r1" ${cfg.costModel==='deepseek-r1'?'selected':''}>DeepSeek R1</option>
        <option value="gpt-4o" ${cfg.costModel==='gpt-4o'?'selected':''}>GPT-4o</option>
        <option value="gpt-4o-mini" ${cfg.costModel==='gpt-4o-mini'?'selected':''}>GPT-4o mini</option>
        <option value="claude-sonnet-4" ${cfg.costModel==='claude-sonnet-4'?'selected':''}>Claude Sonnet 4</option>
        <option value="claude-haiku-4-5" ${cfg.costModel==='claude-haiku-4-5'?'selected':''}>Claude Haiku 4.5</option>
        <option value="custom" ${cfg.costModel==='custom'?'selected':''}>自定义</option>
      </select></label>
      <div id="tcm-custom-block" style="display:${cfg.costModel==='custom'?'block':'none'}">
        <label>输入 ¥/百万: <input type="number" id="tcm-set-in"  value="${cfg.customPricing.input}" step="0.0001" min="0"></label>
        <label>缓存 ¥/百万: <input type="number" id="tcm-set-ch"  value="${cfg.customPricing.cacheHit}" step="0.0001" min="0"></label>
        <label>输出 ¥/百万: <input type="number" id="tcm-set-out" value="${cfg.customPricing.output}" step="0.0001" min="0"></label>
      </div>
      <label>API 匹配串: <input type="text" id="tcm-set-url" value="${cfg.apiUrl}" style="width:100%"></label>
      <div class="tcm-settings-actions"><button id="tcm-set-apply">应用</button><button id="tcm-set-dismiss">关闭</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#tcm-set-model').addEventListener('change', function () { ov.querySelector('#tcm-custom-block').style.display = this.value === 'custom' ? 'block' : 'none'; });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#tcm-set-dismiss').addEventListener('click', () => ov.remove());
    ov.querySelector('#tcm-set-apply').addEventListener('click', () => {
        cfg.showCacheInfo = ov.querySelector('#tcm-set-cache').checked;
        cfg.showSession = ov.querySelector('#tcm-set-session').checked;
        cfg.showCost = ov.querySelector('#tcm-set-cost').checked;
        cfg.showThroughput = ov.querySelector('#tcm-set-tput').checked;
        cfg.showTrend = ov.querySelector('#tcm-set-trend').checked;
        cfg.showInChat = ov.querySelector('#tcm-set-inchat').checked;
        cfg.verbose = ov.querySelector('#tcm-set-verbose').checked;
        cfg.costModel = ov.querySelector('#tcm-set-model').value;
        cfg.apiUrl = (ov.querySelector('#tcm-set-url').value || '').trim();
        if (cfg.costModel === 'custom') {
            cfg.customPricing.input = +ov.querySelector('#tcm-set-in').value || 0;
            cfg.customPricing.cacheHit = +ov.querySelector('#tcm-set-ch').value || 0;
            cfg.customPricing.output = +ov.querySelector('#tcm-set-out').value || 0;
        }
        saveCfg(); ov.remove(); rebuild();
    });
}

// ═══════════════════════════════════════════════════════════════════════
// 斜杠命令
// ═══════════════════════════════════════════════════════════════════════
function registerSlashCommands() {
    try {
        const ctx = getContext();
        if (typeof ctx.registerSlashCommand !== 'function') return;
        const summary = () => {
            const eff = cacheEfficiencyScore(), el = effLabel(eff), tps = avgThroughput();
            return [`🐋 **Token 监控摘要**`, ``, `**会话:** 请求 ${stats.requests} | 入 ${fmt(stats.totalPrompt)} | 出 ${fmt(stats.totalCompletion)} | 均 ${fmt(avgTokensPerRequest())}/请求`,
                `**缓存:** 命中 ${fmt(stats.totalCacheHit)} | 未命中 ${fmt(stats.totalCacheMiss)} | 效率 ${eff}% (${el.text})`,
                `**性能:** 均速 ${tps} tok/秒 | 总生成 ${(stats.totalDuration/1000).toFixed(1)}s`,
                `**费用(¥):** 会话 ${fmtCost(stats.cost)} | 预计+50条 ${fmtCost(projectedCost(50))}`].join('\n');
        };
        const show = m => { if (typeof ctx.sendSystemMessage === 'function') ctx.sendSystemMessage(m); else if (window.toastr) toastr.info(m.replace(/\*\*/g,''), 'Token', { timeOut: 8000 }); else console.log(m); };
        for (const name of ['token-stats', 'token']) ctx.registerSlashCommand(name, () => { show(summary()); return ''; }, [], '查看 token 统计摘要', true, true);
        for (const name of ['token-reset', 'tokenreset']) ctx.registerSlashCommand(name, () => { resetStats(); clearSession(); refresh(); show('✅ Token 统计已重置。'); return ''; }, [], '重置 token 统计', true, true);
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════
function refresh() { render(); }
function init() {
    loadCfg();
    try { _currentChatId = getContext()?.name2 || 'default'; } catch { _currentChatId = 'default'; }
    loadSession(); hookEvents(); createUI(); injectExtDrawer(); registerSlashCommands();
    log('🐋 融合版就绪 | 模型', cfg.costModel, '| fetch+XHR 双拦截已挂载 | 发消息后看 🔎 日志');
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

window.TokenCacheMonitor = {
    stats, cfg, reset: resetStats, refresh,
    getReport: () => ({ sessionRequests: stats.requests, totalTokens: stats.totalPrompt + stats.totalCompletion, totalCost: stats.cost, cacheEfficiency: cacheEfficiencyScore(), avgThroughput: avgThroughput() }),
};
