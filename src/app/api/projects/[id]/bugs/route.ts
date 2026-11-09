import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { parseBugEvidence, type BugEvidenceInput } from "@/lib/evidence";
import { createBug, listBugs } from "@/lib/services";
import type { BugStatus, Priority } from "@/lib/types";
import { assertUploadsReady, saveUploadedFile } from "@/lib/uploads";

function evidenceInput(source: Record<string, unknown>): BugEvidenceInput | undefined {
  const keys = [
    "quote",
    "steps",
    "evidenceSec",
    "strokes",
    "confidence",
    "openQuestion",
    "sourceUrl",
    "captureSessionId",
    "attachmentIds",
  ];
  if (!keys.some((key) => source[key] != null && source[key] !== "")) return undefined;
  return source;
}

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const bugs = listBugs(identity, Number(id), {
      status: (sp.get("status") as BugStatus) || undefined,
      priority: (sp.get("priority") as Priority) || undefined,
      q: sp.get("q") || undefined,
      reporter: sp.get("reporter") || undefined,
      sort: sp.get("sort"),
      dir: sp.get("dir"),
    });
    return json({ bugs });
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const contentType = req.headers.get("content-type") || "";
    let title: string;
    let bodyText: string | undefined;
    let priority: Priority | undefined;
    let evidence: BugEvidenceInput | undefined;
    let files: { filename: string; mime: string; buffer: Buffer }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      title = String(form.get("title") || "");
      bodyText = String(form.get("body") || "") || undefined;
      priority = (String(form.get("priority") || "p2") as Priority) || "p2";
      const record: Record<string, unknown> = {};
      for (const key of [
        "quote",
        "steps",
        "evidenceSec",
        "strokes",
        "confidence",
        "openQuestion",
        "sourceUrl",
        "captureSessionId",
        "attachmentIds",
      ]) {
        const value = form.get(key);
        if (typeof value === "string") record[key] = value;
      }
      evidence = evidenceInput(record);
      for (const item of form.getAll("files")) {
        if (!(item instanceof File)) continue;
        files.push({
          filename: item.name,
          mime: item.type,
          buffer: Buffer.from(await item.arrayBuffer()),
        });
      }
    } else {
      const body = await req.json();
      title = body.title;
      bodyText = body.body;
      priority = body.priority;
      evidence = evidenceInput(body);
    }

    const parsedEvidence = evidence ? parseBugEvidence(evidence) : undefined;
    assertUploadsReady(files, parsedEvidence?.attachmentIds.length || 0);
    const bug = createBug(identity, {
      projectId: Number(id),
      title,
      body: bodyText,
      priority,
      evidence,
    });
    for (const f of files) {
      saveUploadedFile({
        ownerType: "bug",
        ownerId: bug.id,
        filename: f.filename,
        mime: f.mime,
        buffer: f.buffer,
      });
    }
    return json({ bug }, 201);
  });
}
