import { describe, expect, it } from "vitest";
import {
  canImmediateRelease,
  releaseFinishedNotice,
  releaseStatusBanner,
  releaseSubmitNotice,
} from "../src/lib/release-ui";

describe("canImmediateRelease", () => {
  it("disables when there are no pending release bugs", () => {
    expect(canImmediateRelease(0)).toBe(false);
  });

  it("enables when there is at least one pending release bug", () => {
    expect(canImmediateRelease(1)).toBe(true);
    expect(canImmediateRelease(3)).toBe(true);
  });

  it("disables while a release job is already queued or running", () => {
    expect(canImmediateRelease(2, true)).toBe(false);
  });
});

describe("releaseSubmitNotice", () => {
  it("explains queueing and status change for immediate release", () => {
    const notice = releaseSubmitNotice("run", true);
    expect(notice).toContain("已加入发布队列");
    expect(notice).toContain("待确认");
    expect(notice).toContain("失败");
  });

  it("explains mark-as-released outcome", () => {
    const notice = releaseSubmitNotice("mark", true);
    expect(notice).toContain("已标记发布");
    expect(notice).toContain("待确认");
  });

  it("explains finished async release", () => {
    expect(releaseFinishedNotice(true)).toContain("发布已完成");
    expect(releaseFinishedNotice(true)).toContain("待确认");
  });
});

describe("releaseStatusBanner", () => {
  it("shows queued/running progress with status outcome", () => {
    const queued = releaseStatusBanner({
      activeStatus: "queued",
      latestFailureDetail: null,
      advancesBugs: true,
    });
    expect(queued?.tone).toBe("info");
    expect(queued?.title).toMatch(/排队/);
    expect(queued?.body).toContain("待确认");

    const running = releaseStatusBanner({
      activeStatus: "running",
      latestFailureDetail: null,
      advancesBugs: true,
    });
    expect(running?.tone).toBe("info");
    expect(running?.title).toMatch(/执行/);
  });

  it("shows failure reason and allows retry messaging", () => {
    const failed = releaseStatusBanner({
      activeStatus: null,
      latestFailureDetail: "工作区有未提交改动",
      advancesBugs: true,
    });
    expect(failed?.tone).toBe("danger");
    expect(failed?.body).toContain("工作区有未提交改动");
    expect(failed?.body).toContain("立即发布");
    expect(failed?.body).toContain("待发布");
  });

  it("returns null when idle with no recent failure", () => {
    expect(
      releaseStatusBanner({
        activeStatus: null,
        latestFailureDetail: null,
        advancesBugs: true,
      })
    ).toBeNull();
  });
});
