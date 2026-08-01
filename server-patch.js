/**
 * server-patch.js — DeepSeek Cache Info Passthrough for SillyTavern
 *
 * SillyTavern's Node.js server proxies chat completion requests to the
 * DeepSeek API. Some ST versions parse and re-serialize the upstream response,
 * which can strip `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` from
 * the `usage` object before forwarding to the browser.
 *
 * This patch monkey-patches `http.request` / `https.request` to capture the
 * raw DeepSeek API response and attach its full `usage` object to the request,
 * so the ST handler can forward it to the browser-side Token & Cache Monitor.
 *
 * INSTALL
 * ───────
 * 1. Copy this file into your SillyTavern root folder
 *    (next to server.js).
 *
 * 2. Open server.js and add the following line right after `const app = express();`
 *    (or anywhere before the first `app.listen` call):
 *
 *        require('./server-patch.js');
 *
 * 3. Restart SillyTavern.
 *
 * HOW IT WORKS
 * ────────────
 * The patch intercepts all outbound HTTP(S) requests from the ST server.
 * When a request matches a known AI API endpoint (DeepSeek, OpenAI, etc.),
 * it attaches a `__ds_usage` property to the request object containing
 * the full `usage` from the upstream response.
 *
 * If your ST handler already preserves `usage`, the Token & Cache Monitor
 * extension (frontend) will pick up the data automatically via its fetch()
 * interception — no server patch needed. This file is a safety net.
 */

'use strict';

const http  = require('http');
const https = require('https');

// ── Config ─────────────────────────────────────────────────────────────────
const AI_HOSTS = [
    'api.deepseek.com',
    'api.openai.com',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
];

const USAGE_FIELDS = [
    'prompt_tokens',
    'completion_tokens',
    'total_tokens',
    'prompt_cache_hit_tokens',
    'prompt_cache_miss_tokens',
    'prompt_cache_write_tokens',
    'completion_tokens_details',
    'prompt_tokens_details',
];

// ── Helpers ────────────────────────────────────────────────────────────────

function hostMatches(url) {
    if (!url) return false;
    const s = typeof url === 'string' ? url : (url.href || url.host || url.hostname || '');
    return AI_HOSTS.some(h => s.includes(h));
}

function stripUsage(apiResponseBody) {
    // Extract usage object from the raw response, keeping only known fields
    try {
        const data = typeof apiResponseBody === 'string'
            ? JSON.parse(apiResponseBody)
            : apiResponseBody;
        if (!data?.usage) return null;

        const usage = {};
        for (const key of USAGE_FIELDS) {
            if (data.usage[key] !== undefined) {
                usage[key] = data.usage[key];
            }
        }
        return Object.keys(usage).length > 0 ? usage : null;
    } catch {
        return null;
    }
}

// ── Patch one request function ─────────────────────────────────────────────

function patch(mod) {
    const original = mod.request;

    mod.request = function (...args) {
        const url = typeof args[0] === 'string'
            ? args[0]
            : (args[0]?.href || args[0]?.host || args[0]?.hostname || '');

        const req = original.apply(this, args);

        if (!hostMatches(url)) return req;

        // Collect response body from this outgoing AI API request
        const chunks = [];
        const origEmit = req.constructor.prototype.emit;

        // Intercept the 'response' event on the ClientRequest
        req.on('response', function (res) {
            const origResOn = res.on.bind(res);
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    const usage = stripUsage(body);
                    if (usage) {
                        req.__ds_usage = usage;
                        // Also try to forward to a global store
                        if (!global.__ds_pending_usage) global.__ds_pending_usage = [];
                        global.__ds_pending_usage.push({
                            time: Date.now(),
                            usage,
                            url,
                        });
                        // Keep only last 10
                        if (global.__ds_pending_usage.length > 10) {
                            global.__ds_pending_usage.shift();
                        }
                    }
                } catch { /* ignore */ }
            });
        });

        return req;
    };
}

// ── Apply ──────────────────────────────────────────────────────────────────

patch(http);
patch(https);

console.log('[server-patch] DeepSeek cache passthrough enabled. Monitoring:', AI_HOSTS.join(', '));

// ── Export a helper middleware ──────────────────────────────────────────────
// The ST server can use this to merge cached usage into its response.
// Usage in ST's handler:  res.json(mergeUsage(body, req));

module.exports.mergeUsage = function (body, req) {
    if (!body) return body;

    // If body already has full usage with cache fields, return as-is
    if (body.usage?.prompt_cache_hit_tokens !== undefined) return body;

    // Try to get usage from the request object
    if (req?.__ds_usage) {
        body.usage = { ...body.usage, ...req.__ds_usage };
        return body;
    }

    // Try global pending store (match by recency — within last 5s)
    const pending = global.__ds_pending_usage || [];
    const now = Date.now();
    const recent = pending.find(p => (now - p.time) < 5000);
    if (recent) {
        body.usage = { ...body.usage, ...recent.usage };
    }

    return body;
};

// ── Express middleware (alternative install method) ─────────────────────────
// Instead of require() at the top, you can use this as Express middleware:
//   app.use(require('./server-patch.js').middleware);

module.exports.middleware = function (req, res, next) {
    // Override res.json to inject usage into chat completion responses
    if (!req.path?.includes('chat-completions') && !req.path?.includes('completions')) {
        return next();
    }

    const origJson = res.json.bind(res);
    res.json = function (body) {
        const enriched = module.exports.mergeUsage(body, req);
        return origJson(enriched);
    };

    next();
};
