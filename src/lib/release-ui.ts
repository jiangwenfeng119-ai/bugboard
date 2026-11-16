/** Immediate release only when there is at least one ready-to-release bug and no job in flight. */
export function canImmediateRelease(pendingCount: number, jobInFlight = false): boolean {
  return pendingCount > 0 && !jobInFlight;
}

export function releaseSubmitNotice(mode: "run" | "mark", advancesBugs: boolean): string {
  if (mode === "run") {
    return advancesBugs
      ? "已加入发布队列。本机发布任务会接着做；成功后对应报障进入待确认，失败则留在待发布并在本页显示原因，可再次点「立即发布」。"
      : "已加入发布队列。本机发布任务会接着做；完成后会在变更列表里记一条发布结果。失败原因会显示在本页，可再次点「立即发布」。";
  }
  return advancesBugs
    ? "已标记发布。对应的待发布报障已进入待确认。"
    : "已标记发布。变更列表里已记一条发布记录。";
}

export function releaseFinishedNotice(advancesBugs: boolean): string {
  return advancesBugs
    ? "发布已完成。成功时对应报障已进入待确认；若失败，原因会显示在本页，报障仍停在待发布，可再次点「立即发布」。"
    : "发布已完成。结果已记入变更列表；若失败，原因会显示在本页，可再次点「立即发布」。";
}

export function releaseStatusBanner(input: {
  activeStatus: "queued" | "running" | null;
  latestFailureDetail: string | null;
  advancesBugs: boolean;
}): { tone: "info" | "danger"; title: string; body: string } | null {
  if (input.activeStatus === "queued" || input.activeStatus === "running") {
    const title = input.activeStatus === "queued" ? "发布任务排队中" : "发布任务执行中";
    const body = input.advancesBugs
      ? "完成后，成功会把对应报障改为待确认；失败会留在待发布，并在本页显示原因。可稍后自动刷新，或手动刷新本页。"
      : "完成后会在变更列表里记一条发布结果。失败会在本页显示原因，可再次发布。可稍后自动刷新，或手动刷新本页。";
    return { tone: "info", title, body };
  }
  const detail = input.latestFailureDetail?.trim() || "";
  if (!detail) return null;
  return {
    tone: "danger",
    title: "最近一次发布失败",
    body: `原因：${detail}。对应报障仍在待发布，处理完后可再次点「立即发布」。`,
  };
}
