import { NextRequest } from "next/server";
import { json, withAuth } from "@/lib/http";
import { listPendingRelease, markReleased, requestRunRelease } from "@/lib/release";
import type { ReleaseResult, ReleaseTrigger } from "@/lib/types";

export const runtime = "nodejs";

function optionalBugIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => !Number.isInteger(id) || (id as number) <= 0)) {
    throw new Error("报障列表无效");
  }
  return value as number[];
}

function optionalText(value: unknown, label: string) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label}无效`);
  return value;
}

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求无效");
  return body as Record<string, unknown>;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    return json(listPendingRelease(identity, Number(id)));
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = bodyObject(await req.json());
    const projectId = Number(id);
    const trigger = body.trigger as ReleaseTrigger;
    const bugIds = optionalBugIds(body.bugIds);
    const headSha = optionalText(body.headSha, "提交 SHA");
    const detail = optionalText(body.detail, "说明");
    if (body.mode === "mark") {
      return json(
        markReleased(identity, projectId, {
          trigger,
          bugIds,
          headSha,
          detail,
          result: body.result as ReleaseResult | undefined,
        })
      );
    }
    if (body.mode === "run") {
      return json(requestRunRelease(identity, projectId, { trigger, bugIds, headSha, detail }));
    }
    throw new Error("发布方式无效");
  });
}
