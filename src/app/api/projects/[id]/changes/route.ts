import { NextRequest } from "next/server";
import { json, withAuth } from "@/lib/http";
import { listChanges, recordChange } from "@/lib/project-changes";
import type { ProjectChangeKind } from "@/lib/types";

export const runtime = "nodejs";

function optionalQueryInt(value: string | null) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error("分页参数无效");
  return n;
}

function optionalBugIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => !Number.isInteger(id) || (id as number) <= 0)) {
    throw new Error("报障列表无效");
  }
  return value as number[];
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
    const sp = req.nextUrl.searchParams;
    const kind = sp.get("kind") || undefined;
    return json(
      listChanges(identity, Number(id), {
        kind: kind as ProjectChangeKind | "code" | undefined,
        limit: optionalQueryInt(sp.get("limit")),
        offset: optionalQueryInt(sp.get("offset")),
      })
    );
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = bodyObject(await req.json());
    const recorded = recordChange(identity, Number(id), {
      kind: body.kind as Exclude<ProjectChangeKind, "release">,
      title: typeof body.title === "string" ? body.title : "",
      summary: typeof body.summary === "string" ? body.summary : undefined,
      commitShas: body.commitShas as string[],
      branch: typeof body.branch === "string" ? body.branch : undefined,
      bugIds: optionalBugIds(body.bugIds),
    });
    return json(recorded, 201);
  });
}
