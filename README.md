# Token & Cache Monitor — SillyTavern Extension

实时显示对话 token 用量和 DeepSeek 缓存命中情况的 SillyTavern 前端扩展。

## 功能

- **实时 Token 监控** — 每次请求的 Prompt / Completion / Total tokens
- **DeepSeek Cache 命中率** — 显示 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 及命中百分比
- **会话统计** — 累计 token 总量、请求次数
- **费用估算** — 内置 DeepSeek V3 / V4 Pro / V4 Flash 定价，支持自定义
- **流式感知** — 生成过程中实时更新 completion token 计数
- **可拖拽面板** — 深色浮动面板，可折叠、拖拽、重置

## 安装方式

### 方式一：GitHub URL 安装（推荐）

1. 将此文件夹推送到一个公开的 GitHub 仓库
2. 打开 SillyTavern → 扩展面板 → 安装扩展
3. 粘贴仓库 URL，确认安装

### 方式二：手动复制

将整个文件夹复制到 SillyTavern 的扩展目录：

```
SillyTavern/public/scripts/extensions/token-cache-monitor/
```

然后重启 SillyTavern。

## 文件结构

```
├── manifest.json      # ST 扩展清单
├── index.js           # 前端核心：fetch 拦截 + ST 事件 + UI 面板
├── style.css          # 浮动面板样式
├── server-patch.js    # 可选：服务端 DeepSeek cache 字段透传
└── README.md
```

## 服务端补丁（可选）

如果 SillyTavern 服务端在代理 DeepSeek API 时去掉了 `prompt_cache_*` 字段，Cache 区域会始终显示 `-`。此时需要安装服务端补丁：

1. 将 `server-patch.js` 复制到 SillyTavern 根目录（`server.js` 旁边）
2. 在 `server.js` 中 `const app = express();` 之后添加：
   ```js
   require('./server-patch.js');
   ```
3. 重启 SillyTavern

## 使用

- 面板默认出现在右下角，标题栏可拖拽
- **⚙ 设置** — 切换显示内容、选择计费模型
- **↺ 重置** — 清空会话统计
- **➖ / ✕** — 折叠 / 关闭面板
- 控制台调试入口：`window.TokenCacheMonitor`

## 兼容性

| API              | Token 计数 | Cache 信息 |
|------------------|-----------|------------|
| DeepSeek (V3/V4) | ✅         | ✅          |
| OpenAI           | ✅         | —          |
| Anthropic        | ✅         | —          |
| Gemini           | ✅         | —          |

## 定价参考

| 模型               | Input ($/M) | Cache Hit ($/M) | Output ($/M) |
|--------------------|-------------|------------------|--------------|
| DeepSeek V4 Pro    | 0.55        | 0.14             | 2.19         |
| DeepSeek V4 Flash  | 0.14        | 0.0028           | 0.28         |
| DeepSeek V3        | 0.27        | 0.07             | 1.10         |

数据来源：DeepSeek API 官方定价，截至 2025 年 6 月。
