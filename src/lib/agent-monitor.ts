/** 管理后台「分派给 Agent」状态监控的轮询间隔。30 秒能及时发现叫醒服务挂掉，又不会频繁打本机地址。 */
export const AGENT_MONITOR_POLL_MS = 30_000;
