// ============================================================
//  DeepSeek Token Usage Tracker — SillyTavern Extension  v1.1
//  修复：兼容后端代理 / fetch+XHR 双拦截 / 旁路克隆读流
// ============================================================

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const EXTENSION_NAME = 'deepseek-token-tracker';

const PRICE = {
    INPUT_CACHE_HIT:  0.02,   // 元 / 百万 tokens（缓存命中）
    INPUT_CACHE_MISS: 1.00,   // 元 / 百万 tokens（缓存未命中）
    OUTPUT:           2.00,   // 元 / 百万 tokens（输出）
};

const DEFAULT_SETTINGS = {
    enabled: true,
    showInChat: true,
    showNotification: false,
    showConsole: true,
    apiUrl: 'https://api.deepseek.com',
    verbose: false,            // ★ 打印诊断日志（排查时务必开）
    totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0,
    totalCacheHit: 0, totalCacheMiss: 0, requestCount: 0,
};

let lastUsage = null;

// -------------------- 工具 --------------------
const S = () => extension_settings[EXTENSION_NAME];
const fmt = n => (n || 0).toLocaleString('zh-CN');
function fmtCost(v) {
    if (!v || v < 0.0001) return '¥' + (v || 0).toExponential(2);
    if (v < 1) return '¥' + v.toFixed(4);
    return '¥' + v.toFixed(2);
}
function calcCost(u) {
    const hit  = u.prompt_cache_hit_tokens  || 0;
    const miss = u.prompt_cache_miss_tokens || 0;
    const out  = u.completion_tokens        || 0;
    return (hit * PRICE.INPUT_CACHE_HIT + miss * PRICE.INPUT_CACHE_MISS + out * PRICE.OUTPUT) / 1e6;
}
function log(...a) { if (S()?.verbose) console.log('%c[DST]', 'color:#4fc3f7;font-weight:bold', ...a); }

/** URL 是否像一次聊天补全请求（放宽匹配，兼容代理） */
function isChatUrl(url) {
    if (!url) return false;
    const u = String(url).toLowerCase();
    const custom = (S()?.apiUrl || '').toLowerCase().replace(/\/+$/, '');
    return u.includes('chat/completions') || u.includes('/v1/') ||
           u.includes('completions') || (custom && u.includes(custom));
}

/** 给请求体注入 stream_options（让流式也返回 usage） */
function injectStreamOptions(bodyStr) {
    try {
        const body = JSON.parse(bodyStr);
        if (body && typeof body === 'object') {
            body.stream_options = { include_usage: true };
            // 顺便确保 stream 为 true 时不破坏其它字段
            return JSON.stringify(body);
        }
    } catch (_) { /* 非 JSON，原样返回 */ }
    return bodyStr;
}

// -------------------- 收到 usage --------------------
function onUsageReceived(usage) {
    if (!usage || usage.prompt_tokens === undefined) return;
    lastUsage = usage;
    const s = S();
    const cost = calcCost(usage);
    const hit  = usage.prompt_cache_hit_tokens  || 0;
    const miss = usage.prompt_cache_miss_tokens || 0;

    s.totalCost         += cost;
    s.totalInputTokens  += (usage.prompt_tokens || 0);
    s.totalOutputTokens += (usage.completion_tokens || 0);
    s.totalCacheHit     += hit;
    s.totalCacheMiss    += miss;
    s.requestCount      += 1;
    saveSettingsDebounced();

    log('✅ 抓到 usage →',
        `in=${usage.prompt_tokens} out=${usage.completion_tokens} ` +
        `hit=${hit} miss=${miss} 本次=${fmtCost(cost)} 累计=${fmtCost(s.totalCost)}`);

    if (s.showConsole) {
        console.log(
            `%c[DeepSeek Tracker]%c 输入:${usage.prompt_tokens} 输出:${usage.completion_tokens} ` +
            `缓存命中:${hit} 未命中:${miss} 本次:${fmtCost(cost)} 累计:${fmtCost(s.totalCost)}`,
            'color:#4fc3f7;font-weight:bold', 'color:inherit');
    }
    if (s.showNotification && window.toastr) {
        toastr.info(
            `输入 ${fmt(usage.prompt_tokens)} | 输出 ${fmt(usage.completion_tokens)}<br>` +
            `缓存命中 ${fmt(hit)} | 未命中 ${fmt(miss)}<br>` +
            `本次 <b>${fmtCost(cost)}</b> | 累计 <b>${fmtCost(s.totalCost)}</b>`,
            '🪙 Token 消费', { timeOut: 6000, positionClass: 'toast-bottom-right' });
    }
    if (s.showInChat) setTimeout(() => insertStatsIntoChat(usage, cost), 400);
    updateSettingsPanel();
}

/** 从一段 SSE/JSON 文本里尽力抠出 usage 对象 */
function tryExtractUsage(text) {
    if (!text) return null;
    // 1) 非流式：整段就是 JSON
    try {
        const j = JSON.parse(text);
        if (j?.usage && j.usage.prompt_tokens !== undefined) return j.usage;
    } catch (_) { /* 不是整段 JSON，继续 */ }
    // 2) 流式：从后往前找含 usage 的 data 行
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]' || !payload.includes('usage')) continue;
        try {
            const j = JSON.parse(payload);
            if (j?.usage && j.usage.prompt_tokens !== undefined) return j.usage;
        } catch (_) { /* 继续向前 */ }
    }
    return null;
}

/** 旁路读取一个 Response 的文本并提取 usage（不消费原 response） */
function sniffResponse(response) {
    try {
        response.clone().text().then(txt => {
            const u = tryExtractUsage(txt);
            if (u) onUsageReceived(u);
            else log('⚠️ 响应里没找到 usage（可能上游/代理未透传，见下方说明）');
        }).catch(e => log('clone 读取失败', e));
    } catch (e) { log('sniff 异常', e); }
}

// -------------------- 拦截 fetch --------------------
const _fetch = window.fetch;
window.fetch = async function (input, init) {
    const s = S();
    const url = typeof input === 'string' ? input : (input?.url || '');

    if (!s?.enabled || !isChatUrl(url)) {
        return _fetch.apply(this, arguments);
    }

    log('🔎 命中 fetch →', url);

    // 注入 stream_options
    let newInit = init;
    if (init?.body) {
        const nb = injectStreamOptions(init.body);
        if (nb !== init.body) { newInit = { ...init, body: nb }; log('   已注入 stream_options'); }
    } else if (input?.body && typeof input.clone === 'function') {
        // Request 对象带 body 的情况，较少见，尽量处理
        try { newInit = { ...(init || {}), body: injectStreamOptions(await input.text()) }; } catch (_) {}
    }

    const resp = await _fetch.call(this, input, newInit);
    log('   fetch 响应 status=', resp.status,
        'type=', resp.headers.get('content-type'));

    sniffResponse(resp);   // 旁路克隆读取，原 resp 原样返回
    return resp;
};

// -------------------- 拦截 XHR --------------------
const _xhrOpen = XMLHttpRequest.prototype.open;
const _xhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__dstUrl = url;
    this.__dstMethod = method;
    return _xhrOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function (body) {
    const s = S();
    const url = this.__dstUrl;

    if (s?.enabled && isChatUrl(url)) {
        log('🔎 命中 XHR →', url);
        let newBody = body;
        if (body) {
            const nb = injectStreamOptions(body);
            if (nb !== body) { newBody = nb; log('   已注入 stream_options (XHR)'); }
        }
        // 流式 XHR 也要逐块嗅探
        this.addEventListener('progress', () => {
            try {
                const u = tryExtractUsage(this.responseText || '');
                if (u && u !== this.__dstLastUsage) { this.__dstLastUsage = u; onUsageReceived(u); }
            } catch (_) {}
        });
        this.addEventListener('load', () => {
            try {
                const u = tryExtractUsage(this.responseText || '');
                if (u) onUsageReceived(u);
                else log('⚠️ XHR 响应里没找到 usage');
            } catch (_) {}
        });
        return _xhrSend.call(this, newBody);
    }
    return _xhrSend.call(this, body);
};

// -------------------- DOM 插入 --------------------
function buildStatsHTML(u, cost) {
    const hit = u.prompt_cache_hit_tokens || 0, miss = u.prompt_cache_miss_tokens || 0;
    const totalCache = hit + miss;
    return `
<div class="ds-token-stats">
  <span class="ds-stat-title">📊 Token 统计</span>
  <span>输入: <b>${fmt(u.prompt_tokens)}</b></span>
  <span>输出: <b>${fmt(u.completion_tokens)}</b></span>
  <span>缓存总计: <b>${fmt(totalCache)}</b></span>
  <span class="ds-hit">命中: <b>${fmt(hit)}</b></span>
  <span class="ds-miss">未命中: <b>${fmt(miss)}</b></span>
  <span class="ds-cost">本次消费: <b>${fmtCost(cost)}</b></span>
  <span class="ds-total">累计: <b>${fmtCost(S().totalCost)}</b> (${S().requestCount} 次)</span>
</div>`;
}
function insertStatsIntoChat(u, cost) {
    const $mes = $('#chat .mes').last();
    if (!$mes.length) return;
    $mes.find('.ds-token-stats').remove();
    const $block = $mes.find('.mes_block');
    ($block.length ? $block : $mes).append(buildStatsHTML(u, cost));
}

// -------------------- 设置面板 --------------------
function updateSettingsPanel() {
    const s = S(); if (!s) return;
    $('#ds_tracker_enabled').prop('checked', s.enabled);
    $('#ds_tracker_show_chat').prop('checked', s.showInChat);
    $('#ds_tracker_show_notif').prop('checked', s.showNotification);
    $('#ds_tracker_show_console').prop('checked', s.showConsole);
    $('#ds_tracker_api_url').val(s.apiUrl);
    $('#ds_stat_total_cost').text(fmtCost(s.totalCost));
    $('#ds_stat_requests').text(s.requestCount);
    $('#ds_stat_input').text(fmt(s.totalInputTokens));
    $('#ds_stat_output').text(fmt(s.totalOutputTokens));
    $('#ds_stat_cache_hit').text(fmt(s.totalCacheHit));
    $('#ds_stat_cache_miss').text(fmt(s.totalCacheMiss));
}

// -------------------- 斜杠命令 --------------------
function registerCommands() {
    const ctx = window.SillyTavern?.getContext?.();
    if (!ctx?.registerSlashCommand) return;
    ctx.registerSlashCommand('token', () => {
        if (!lastUsage) return '暂无 token 数据，请先发送一条消息。';
        const s = S();
        return [`📊 **最近一次 Token 统计**`,
            `输入: ${fmt(lastUsage.prompt_tokens)}`, `输出: ${fmt(lastUsage.completion_tokens)}`,
            `缓存命中: ${fmt(lastUsage.prompt_cache_hit_tokens || 0)}`,
            `缓存未命中: ${fmt(lastUsage.prompt_cache_miss_tokens || 0)}`,
            `本次消费: ${fmtCost(calcCost(lastUsage))}`, `---`,
            `累计消费: ${fmtCost(s.totalCost)}（${s.requestCount} 次请求）`].join('\n');
    }, [], '查看最近一次 DeepSeek token 用量与消费', true, true);
    ctx.registerSlashCommand('tokenreset', () => {
        const s = S();
        s.totalCost = s.totalInputTokens = s.totalOutputTokens =
        s.totalCacheHit = s.totalCacheMiss = s.requestCount = 0;
        saveSettingsDebounced(); updateSettingsPanel();
        return '✅ 累计统计已重置。';
    }, [], '重置 DeepSeek token 累计统计', true, true);
}

// -------------------- 初始化 --------------------
jQuery(async () => {
    if (!extension_settings[EXTENSION_NAME]) extension_settings[EXTENSION_NAME] = {};
    // 注意：用户已存值覆盖默认，但 verbose 默认开
    extension_settings[EXTENSION_NAME] = Object.assign(
        {}, DEFAULT_SETTINGS, extension_settings[EXTENSION_NAME]);

    const html = await (await fetch('/scripts/extensions/third-party/deepseek-token-tracker/index.html')).text();
    $('#extensions_settings2').append(html);

    const bind = (id, key, ev = 'change', parse = v => v) =>
        $(id).on(ev, function () { S()[key] = parse(this.type === 'checkbox' ? this.checked : this.value); saveSettingsDebounced(); });
    bind('#ds_tracker_enabled', 'enabled');
    bind('#ds_tracker_show_chat', 'showInChat');
    bind('#ds_tracker_show_notif', 'showNotification');
    bind('#ds_tracker_show_console', 'showConsole');
    bind('#ds_tracker_api_url', 'apiUrl', 'input', v => v.trim());

    $('#ds_tracker_reset_btn').on('click', function () {
        const s = S();
        s.totalCost = s.totalInputTokens = s.totalOutputTokens =
        s.totalCacheHit = s.totalCacheMiss = s.requestCount = 0;
        saveSettingsDebounced(); updateSettingsPanel();
        if (window.toastr) toastr.success('累计统计已重置');
    });

    updateSettingsPanel();
    setTimeout(registerCommands, 1000);
    log(' 扩展已加载，fetch + XHR 双拦截已就绪。发一条消息后看下面的日志。');
});
