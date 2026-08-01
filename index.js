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
function saveCfg() { extensionSettings[EXT_NAME] = cfg; saveSetti
