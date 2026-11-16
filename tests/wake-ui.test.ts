import { describe, expect, it } from "vitest";
import { isWakeInFlight, wakeButtonView } from "../src/lib/wake-ui";

describe("isWakeInFlight", () => {
  it("treats pending queued running as in flight", () => {
    expect(isWakeInFlight("pending")).toBe(true);
    expect(isWakeInFlight("queued")).toBe(true);
    expect(isWakeInFlight("running")).toBe(true);
  });

  it("treats terminal dispatch results as finished", () => {
    expect(isWakeInFlight("sent")).toBe(false);
    expect(isWakeInFlight("failed")).toBe(false);
    expect(isWakeInFlight("skipped")).toBe(false);
  });
});

describe("wakeButtonView", () => {
  it("shows allocate-in-progress while the local request is open", () => {
    const view = wakeButtonView(null, true);
    expect(view.disabled).toBe(true);
    expect(view.label).toBe("分配中…");
    expect(view.inFlight).toBe(true);
  });

  it("shows allocate or processing labels while server dispatch is unfinished", () => {
    expect(wakeButtonView({ status: "pending" }, false)).toEqual({
      disabled: true,
      label: "分配中…",
      inFlight: true,
    });
    expect(wakeButtonView({ status: "queued" }, false).label).toBe("排队中…");
    expect(wakeButtonView({ status: "running" }, false).label).toBe("处理中…");
  });

  it("only shows redispatch after a finished result", () => {
    expect(wakeButtonView({ status: "sent" }, false)).toEqual({
      disabled: false,
      label: "再次分派去修理",
      inFlight: false,
    });
    expect(wakeButtonView({ status: "failed" }, false).label).toBe("再次分派去修理");
    expect(wakeButtonView({ status: "skipped" }, false).label).toBe("再次分派去修理");
  });

  it("shows first-time dispatch when there is no prior result", () => {
    expect(wakeButtonView(null, false)).toEqual({
      disabled: false,
      label: "分派去修理",
      inFlight: false,
    });
  });
});
