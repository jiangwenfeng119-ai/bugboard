import { NextRequest } from "next/server";
import { json, withAuth } from "@/lib/http";
import { claimQueuedRelease, enqueueScheduledReleases, finishRunningRelease } from "@/lib/release";
import type { ReleaseResult } from "@/lib/types";

export const runtime = "nodejs";

function shanghaiHHMM(now = new Date()) {
  const clock = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return `${String(clock.getUTCHours()).padStart(2, "0")}:${String(clock.getUTCMinutes()).padStart(2, "0")}`;
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求无效");
  return body as Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const body = bodyObject(await req.json());
    if (body.op === "claim") {
      const project = typeof body.project === "string" ? body.project : undefined;
      return json({ job: claimQueuedRelease(identity, project) });
    }
    if (body.op === "schedule") {
      const at = typeof body.at === "string" && body.at.trim() ? body.at.trim() : shanghaiHHMM();
      return json({ queued: enqueueScheduledReleases(identity, at) });
    }
    if (body.op === "finish") {
      const dispatchId = body.dispatchId;
      if (!Number.isInteger(dispatchId) || (dispatchId as number) <= 0) throw new Error("发布任务无效");
      const result = body.result as ReleaseResult;
      const headSha = typeof body.headSha === "string" ? body.headSha : undefined;
      const detail = typeof body.detail === "string" ? body.detail : undefined;
      return json(finishRunningRelease(identity, { dispatchId: dispatchId as number, result, headSha, detail }));
    }
    throw new Error("发布任务操作无效");
  });
}
