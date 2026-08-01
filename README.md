v5.0.0-fusion (融合)
- 修复：抓取引擎改为 fetch+XHR 双拦截 + 放宽 URL 匹配，
  解决「自定义 OpenAI 兼容端点直连 / 手机 TauriTavern」场景下面板全 0 的问题
  （原版 window.fetch 正则只认 /backends/... 代理路径，且 CHANGELOG 声称的
   generateRawData 修复并未在代码中落地）。
- 新增：消息下方挂账单、人民币计价、verbose 抓取诊断日志、API 匹配串可配置。
- 默认模型改为 deepseek-v4-flash；关闭 auto_update 防被原版覆盖。
