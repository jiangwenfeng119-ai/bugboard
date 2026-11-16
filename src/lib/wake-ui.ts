import type { DispatchStatus } from "./dispatch";

/** 分派尚未落到结果：发送中 / 排队 / 执行。 */
export function isWakeInFlight(status: DispatchStatus): boolean {
  return status === "pending" || status === "queued" || status === "running";
}

export function wakeButtonView(
  latest: { status: DispatchStatus } | null,
  loading: boolean
): { disabled: boolean; label: string; inFlight: boolean } {
  if (loading) {
    return { disabled: true, label: "分配中…", inFlight: true };
  }
  if (latest && isWakeInFlight(latest.status)) {
    const label =
      latest.status === "running" ? "处理中…" : latest.status === "queued" ? "排队中…" : "分配中…";
    return { disabled: true, label, inFlight: true };
  }
  return {
    disabled: false,
    label: latest ? "再次分派去修理" : "分派去修理",
    inFlight: false,
  };
}
