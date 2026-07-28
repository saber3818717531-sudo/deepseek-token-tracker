// ============================================================
//  DeepSeek Token Usage Tracker — SillyTavern Extension
//  功能：拦截 DeepSeek API 响应，统计 token 用量与消费
// ============================================================

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

// -------------------- 常量 --------------------
const EXTENSION_NAME = 'deepseek-token-tracker';

const PRICE = {
    INPUT_CACHE_HIT:  0.02,   // 元 / 百万 tokens（缓存命中）
    INPUT_CACHE_MISS: 1.00,   // 元 / 百万 tokens（缓存未命中）
    OUTPUT:           2.00,   // 元 / 百万 tokens（输出）
};

const DEFAULT_SETTINGS = {
    enabled:          true,
    showInChat:       true,   // 在消息气泡下方显示
    showNotification: false,  // toastr 弹窗通知
    showConsole:      true,   // 浏览器控制台输出
    apiUrl:           'https://api.deepseek.com',
    // 累计统计
    totalCost:        0,
    totalInputTokens: 0,
    totalOutputTokens:0,
    totalCacheHit:    0,
    totalCacheMiss:   0,
    requestCount:     0,
};

// -------------------- 状态 --------------------
let lastUsage = null;   // 最近一次 usage 数据

// -------------------- 工具函数 --------------------

/** 计算单次费用（元） */
function calcCost(usage) {
    const hit  = usage.prompt_cache_hit_tokens  || 0;
    const miss = usage.prompt_cache_miss_tokens || 0;
    const out  = usage.completion_tokens        || 0;
    return (hit * PRICE.INPUT_CACHE_HIT + miss * PRICE.INPUT_CACHE_MISS + out * PRICE.OUTPUT) / 1_000_000;
}

/** 格式化数字，千分位 */
function fmt(n) {
    return n.toLocaleString('zh-CN');
}

/** 格式化费用 */
function fmtCost(v) {
    if (v < 0.0001) return '¥' + v.toExponential(2);
    if (v < 1)      return '¥' + v.toFixed(4);
    return '¥' + v.toFixed(2);
}

/** 生成统计 HTML 片段 */
function buildStatsHTML(usage, cost) {
    const hit  = usage.prompt_cache_hit_tokens  || 0;
    const miss = usage.prompt_cache_miss_tokens || 0;
    const inp  = usage.prompt_tokens            || 0;
    const out  = usage.completion_tokens        || 0;
    const totalCache = hit + miss;

    return `
<div class="ds-token-stats">
  <span class="ds-stat-title">📊 Token 统计</span>
  <span>输入: <b>${fmt(inp)}</b></span>
  <span>输出: <b>${fmt(out)}</b></span>
  <span>缓存总计: <b>${fmt(totalCache)}</b></span>
  <span class="ds-hit">命中: <b>${fmt(hit)}</b></span>
  <span class="ds-miss">未命中: <b>${fmt(miss)}</b></span>
  <span class="ds-cost">本次消费: <b>${fmtCost(cost)}</b></span>
  <span class="ds-total">累计: <b>${fmtCost(extension_settings[EXTENSION_NAME].totalCost)}</b>
    (${extension_settings[EXTENSION_NAME].requestCount} 次)</span>
</div>`;
}

// -------------------- 核心：拦截 fetch --------------------

const originalFetch = window.fetch;

window.fetch = async function (...args) {
    const settings = extension_settings[EXTENSION_NAME];
    const [resource, config] = args;

    // 判断是否是目标 API
    const url = typeof resource === 'string' ? resource : resource?.url || '';
    const isTarget = settings.enabled && url.includes(settings.apiUrl);

    if (!isTarget) {
        return originalFetch.apply(this, args);
    }

    // ---------- 注入 stream_options（让流式响应也返回 usage） ----------
    let modifiedConfig = config;
    if (config?.body) {
        try {
            const body = JSON.parse(config.body);
            if (body.stream) {
                body.stream_options = { include_usage: true };
                modifiedConfig = { ...config, body: JSON.stringify(body) };
            }
        } catch (_) { /* 非 JSON body，跳过 */ }
    }

    const response = await originalFetch.call(this, resource, modifiedConfig);

    // ---------- 解析响应 ----------
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
        // ===== 流式响应 =====
        return handleStreamResponse(response);
    } else {
        // ===== 非流式响应 =====
        handleNonStreamResponse(response);
        return response;
    }
};

/** 处理非流式响应 */
async function handleNonStreamResponse(response) {
    try {
        const clone = response.clone();
        const data  = await clone.json();
        if (data?.usage) {
            onUsageReceived(data.usage);
        }
    } catch (_) { /* 忽略解析错误 */ }
}

/** 处理流式（SSE）响应：用 TransformStream 透传并提取 usage */
function handleStreamResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const stream = new ReadableStream({
        async start(controller) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    // 流结束，尝试从 buffer 中提取最后的 usage
                    extractUsageFromSSE(buffer);
                    controller.close();
                    break;
                }
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                controller.enqueue(value);   // 原样透传给 SillyTavern
            }
        }
    });

    return new Response(stream, {
        status:  response.status,
        headers: response.headers,
    });
}

/** 从 SSE 文本块中提取 usage */
function extractUsageFromSSE(text) {
    // 逐行扫描，找最后一个包含 "usage" 的 data 行
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line.startsWith('data:') && line.includes('"usage"')) {
            try {
                const json = JSON.parse(line.slice(5).trim());
                if (json?.usage && json.usage.prompt_tokens !== undefined) {
                    onUsageReceived(json.usage);
                    return;
                }
            } catch (_) { /* 继续向前搜索 */ }
        }
    }
}

// -------------------- 收到 usage 后的处理 --------------------

function onUsageReceived(usage) {
    lastUsage = usage;
    const settings = extension_settings[EXTENSION_NAME];
    const cost = calcCost(usage);

    // 更新累计统计
    settings.totalCost         += cost;
    settings.totalInputTokens  += (usage.prompt_tokens || 0);
    settings.totalOutputTokens += (usage.completion_tokens || 0);
    settings.totalCacheHit     += (usage.prompt_cache_hit_tokens || 0);
    settings.totalCacheMiss    += (usage.prompt_cache_miss_tokens || 0);
    settings.requestCount      += 1;
    saveSettingsDebounced();

    // 控制台输出
    if (settings.showConsole) {
        const hit  = usage.prompt_cache_hit_tokens  || 0;
        const miss = usage.prompt_cache_miss_tokens || 0;
        console.log(
            `%c[DeepSeek Tracker]%c 输入:${usage.prompt_tokens} 输出:${usage.completion_tokens} ` +
            `缓存命中:${hit} 未命中:${miss} 本次:${fmtCost(cost)} 累计:${fmtCost(settings.totalCost)}`,
            'color:#4fc3f7;font-weight:bold', 'color:inherit'
        );
    }

    // toastr 通知
    if (settings.showNotification && window.toastr) {
        toastr.info(
            `输入 ${fmt(usage.prompt_tokens)} | 输出 ${fmt(usage.completion_tokens)}<br>` +
            `缓存命中 ${fmt(usage.prompt_cache_hit_tokens || 0)} | 未命中 ${fmt(usage.prompt_cache_miss_tokens || 0)}<br>` +
            `本次 <b>${fmtCost(cost)}</b> | 累计 <b>${fmtCost(settings.totalCost)}</b>`,
            '🪙 Token 消费',
            { timeOut: 6000, positionClass: 'toast-bottom-right' }
        );
    }

    // 在聊天消息下方插入统计
    if (settings.showInChat) {
        // 延迟一点，等 SillyTavern 把消息渲染到 DOM
        setTimeout(() => insertStatsIntoChat(usage, cost), 300);
    }

    // 刷新设置面板
    updateSettingsPanel();
}

/** 在最后一条 AI 消息气泡下方插入统计标签 */
function insertStatsIntoChat(usage, cost) {
    const $mesBlock = $('#chat .mes').last();
    if (!$mesBlock.length) return;

    // 避免重复插入
    $mesBlock.find('.ds-token-stats').remove();

    const html = buildStatsHTML(usage, cost);
    $mesBlock.find('.mes_block').append(html);
}

// -------------------- 设置面板 --------------------

function updateSettingsPanel() {
    const s = extension_settings[EXTENSION_NAME];
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
    // /token — 查看最近一次统计
    window.SillyTavern?.getContext?.()?.registerSlashCommand?.('token', () => {
        if (!lastUsage) {
            return '暂无 token 数据，请先发送一条消息。';
        }
        const cost = calcCost(lastUsage);
        const s = extension_settings[EXTENSION_NAME];
        return [
            `📊 **最近一次 Token 统计**`,
            `输入: ${fmt(lastUsage.prompt_tokens)}`,
            `输出: ${fmt(lastUsage.completion_tokens)}`,
            `缓存命中: ${fmt(lastUsage.prompt_cache_hit_tokens || 0)}`,
            `缓存未命中: ${fmt(lastUsage.prompt_cache_miss_tokens || 0)}`,
            `本次消费: ${fmtCost(cost)}`,
            `---`,
            `累计消费: ${fmtCost(s.totalCost)}（${s.requestCount} 次请求）`,
        ].join('\n');
    }, [], '查看最近一次 DeepSeek token 用量与消费', true, true);

    // /tokenreset — 重置累计统计
    window.SillyTavern?.getContext?.()?.registerSlashCommand?.('tokenreset', () => {
        const s = extension_settings[EXTENSION_NAME];
        s.totalCost = 0;
        s.totalInputTokens = 0;
        s.totalOutputTokens = 0;
        s.totalCacheHit = 0;
        s.totalCacheMiss = 0;
        s.requestCount = 0;
        saveSettingsDebounced();
        updateSettingsPanel();
        return '✅ 累计统计已重置。';
    }, [], '重置 DeepSeek token 累计统计', true, true);
}

// -------------------- 初始化 --------------------

jQuery(async () => {
    // 1. 合并默认设置
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    Object.assign(
        extension_settings[EXTENSION_NAME],
        DEFAULT_SETTINGS,
        extension_settings[EXTENSION_NAME]   // 用户已保存的覆盖默认
    );

    // 2. 加载设置面板 HTML
    const settingsHtml = await (await fetch(
        '/scripts/extensions/third-party/deepseek-token-tracker/index.html'
    )).text();
    $('#extensions_settings2').append(settingsHtml);

    // 3. 绑定设置面板事件
    $('#ds_tracker_enabled').on('change', function () {
        extension_settings[EXTENSION_NAME].enabled = !!this.checked;
        saveSettingsDebounced();
    });
    $('#ds_tracker_show_chat').on('change', function () {
        extension_settings[EXTENSION_NAME].showInChat = !!this.checked;
        saveSettingsDebounced();
    });
    $('#ds_tracker_show_notif').on('change', function () {
        extension_settings[EXTENSION_NAME].showNotification = !!this.checked;
        saveSettingsDebounced();
    });
    $('#ds_tracker_show_console').on('change', function () {
        extension_settings[EXTENSION_NAME].showConsole = !!this.checked;
        saveSettingsDebounced();
    });
    $('#ds_tracker_api_url').on('input', function () {
        extension_settings[EXTENSION_NAME].apiUrl = this.value.trim();
        saveSettingsDebounced();
    });
    $('#ds_tracker_reset_btn').on('click', function () {
        const s = extension_settings[EXTENSION_NAME];
        s.totalCost = 0;
        s.totalInputTokens = 0;
        s.totalOutputTokens = 0;
        s.totalCacheHit = 0;
        s.totalCacheMiss = 0;
        s.requestCount = 0;
        saveSettingsDebounced();
        updateSettingsPanel();
        if (window.toastr) toastr.success('累计统计已重置');
    });

    // 4. 刷新面板
    updateSettingsPanel();

    // 5. 注册斜杠命令（延迟，确保 ST 核心已就绪）
    setTimeout(registerCommands, 1000);

    console.log('%c[DeepSeek Token Tracker] 已加载 ✅', 'color:#4fc3f7;font-weight:bold');
});
