import type { Priority } from "./types";

export const WAKE_ACTIONS = [
  "provide_info",
  "reject_fix",
  "release_return",
  "release_hold",
  "dispute_invalid",
  "reopen_invalid",
  "supplement",
  "accept_product",
] as const;

export type WakeAction = (typeof WAKE_ACTIONS)[number];
export type WakeSource = "web" | "widget" | "capture" | "api";

export const WAKE_ACTION_LABELS: Record<WakeAction, string> = {
  provide_info: "补充说明后仍是待处理",
  reject_fix: "打回修复，回到待处理",
  release_return: "发布退回，回到待处理",
  release_hold: "发布拦住，回到修复中",
  dispute_invalid: "对不属实提出异议，回到待处理",
  reopen_invalid: "重新打开不属实，回到待处理",
  supplement: "待处理时补充说明",
  accept_product: "产品点「可以做」，进入修复中",
};

export type BehaviorSettings = {
  wakeOnWebCreate: boolean;
  wakeOnWidgetCreate: boolean;
  wakeOnCaptureCreate: boolean;
  wakeOnApiCreate: boolean;
  wakeActions: WakeAction[];
  wakeDrainQueue: boolean;
  intakePriority: Priority;
  inboxShowPending: boolean;
  inboxShowNeedsProduct: boolean;
  inboxShowReady: boolean;
  inboxShowOwnFixing: boolean;
  inboxPendingCap: number;
  releaseAdvancesBugs: boolean;
  releaseTimeoutMin: number;
  captureGapMs: number;
  captureShortChars: number;
  organizeTimeoutMin: number;
  askEnabled: boolean;
  askPerHour: number;
};

/** 已保存的叫醒列表里还有 reject_fix 时补上发布退回。空列表保持为空。 */
export function storedWakeActionsWithReleaseReturn(raw: string) {
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.includes("reject_fix") || items.includes("release_return")) return raw;
  return `${items.join(",")},release_return`;
}

/** 已经会因发布退回叫醒的列表，补上发布拦住。没有发布退回的保持原样，空列表保持为空。 */
export function storedWakeActionsWithReleaseHold(raw: string) {
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.includes("release_return") || items.includes("release_hold")) return raw;
  return `${items.join(",")},release_hold`;
}

export function behaviorDefaults(): BehaviorSettings {
  return {
    wakeOnWebCreate: true,
    wakeOnWidgetCreate: true,
    wakeOnCaptureCreate: true,
    wakeOnApiCreate: false,
    wakeActions: [...WAKE_ACTIONS],
    wakeDrainQueue: true,
    intakePriority: "p2",
    inboxShowPending: true,
    inboxShowNeedsProduct: true,
    inboxShowReady: true,
    inboxShowOwnFixing: true,
    inboxPendingCap: 8,
    releaseAdvancesBugs: true,
    releaseTimeoutMin: 45,
    captureGapMs: 1200,
    captureShortChars: 8,
    organizeTimeoutMin: 8,
    askEnabled: true,
    askPerHour: 20,
  };
}

export type BehaviorHighlight = {
  label: string;
  value: string;
  on?: boolean;
};

/** 清单用短条目，避免一整段散文。编辑页仍用 describeBehavior。 */
export function behaviorListHighlights(settings: BehaviorSettings): BehaviorHighlight[] {
  const wakeOn = [
    settings.wakeOnWebCreate ? "网页" : "",
    settings.wakeOnWidgetCreate ? "小组件" : "",
    settings.wakeOnCaptureCreate ? "走查" : "",
    settings.wakeOnApiCreate ? "API Key" : "",
  ].filter(Boolean);
  const queues = [
    settings.inboxShowPending ? "待处理" : "",
    settings.inboxShowNeedsProduct ? "待产品确认" : "",
    settings.inboxShowReady ? "待发布" : "",
    settings.inboxShowOwnFixing ? "自己接手的修复中" : "",
  ].filter(Boolean);
  const gapSec = settings.captureGapMs / 1000;
  const gapLabel = Number.isInteger(gapSec) ? `${gapSec}` : gapSec.toFixed(1);
  return [
    {
      label: "建单叫醒",
      value: wakeOn.length ? wakeOn.join("、") : "都不叫醒",
      on: wakeOn.length > 0,
    },
    {
      label: "状态再叫",
      value: settings.wakeActions.length ? `${settings.wakeActions.length} 项动作` : "不叫醒",
      on: settings.wakeActions.length > 0,
    },
    {
      label: "处理范围",
      value: settings.wakeDrainQueue ? "继续其余待处理" : "只处理点名的一张",
      on: settings.wakeDrainQueue,
    },
    {
      label: "默认优先级",
      value: settings.intakePriority.toUpperCase(),
      on: true,
    },
    {
      label: "收件箱",
      value: queues.length
        ? `${queues.join("、")} · 待处理最多 ${settings.inboxPendingCap}`
        : "不列处理队列",
      on: queues.length > 0,
    },
    {
      label: "发布之后",
      value: settings.releaseAdvancesBugs
        ? `推进到待确认 · ${settings.releaseTimeoutMin} 分钟超时`
        : `留在待发布 · ${settings.releaseTimeoutMin} 分钟超时`,
      on: settings.releaseAdvancesBugs,
    },
    {
      label: "走查草稿",
      value: `停顿 ${gapLabel} 秒 · 短句 ${settings.captureShortChars} 字 · 整理 ${settings.organizeTimeoutMin} 分钟`,
      on: true,
    },
    {
      label: "项目问答",
      value: settings.askEnabled ? `打开 · 每小时 ${settings.askPerHour} 次` : "关闭",
      on: settings.askEnabled,
    },
  ];
}

export function describeBehavior(settings: BehaviorSettings) {
  const wakes = [
    settings.wakeOnWebCreate ? "网页建单会叫醒" : "网页建单不叫醒",
    settings.wakeOnWidgetCreate ? "小组件上报会叫醒" : "小组件上报不叫醒",
    settings.wakeOnCaptureCreate ? "走查提交会叫醒" : "走查提交不叫醒",
    settings.wakeOnApiCreate ? "API Key 建单会叫醒" : "API Key 建单不叫醒",
  ];
  const actionLine = settings.wakeActions.length
    ? `这些动作会再叫一次：${settings.wakeActions.map((action) => WAKE_ACTION_LABELS[action]).join("、")}。`
    : "回到待处理或点「可以做」都不再自动叫醒。";
  const queues = [
    settings.inboxShowPending ? "待处理" : "",
    settings.inboxShowNeedsProduct ? "待产品确认" : "",
    settings.inboxShowReady ? "待发布" : "",
    settings.inboxShowOwnFixing ? "自己接手的修复中" : "",
  ].filter(Boolean);
  const gapSec = settings.captureGapMs / 1000;
  return [
    `${wakes.join("，")}。`,
    actionLine,
    settings.wakeDrainQueue
      ? "叫醒后会继续处理该项目其余待处理。"
      : "叫醒后只处理被点名的那一张。",
    `小组件和走查的新单优先级是 ${settings.intakePriority.toUpperCase()}。`,
    queues.length
      ? `管理员收件箱包含${queues.join("、")}，待处理最多列 ${settings.inboxPendingCap} 条。`
      : "管理员收件箱不放这个项目的处理队列。报障人自己的待确认、待补充和不属实仍在。",
    settings.releaseAdvancesBugs
      ? `发布成功后，待发布的单进入待确认。发布任务超过 ${settings.releaseTimeoutMin} 分钟算超时。`
      : `发布成功后，待发布的单留在待发布。发布任务超过 ${settings.releaseTimeoutMin} 分钟算超时。`,
    `走查停顿超过 ${gapSec} 秒新开一条，不足 ${settings.captureShortChars} 个字标成待确认，整理超过 ${settings.organizeTimeoutMin} 分钟改用规则草稿。`,
  ];
}
