import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { createBug, listBugs } from "@/lib/services";
import type { BugStatus, Priority } from "@/lib/types";
import { assertUploadsReady, saveUploadedFile } from "@/lib/uploads";

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
    let files: { filename: string; mime: string; buffer: Buffer }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      title = String(form.get("title") || "");
      bodyText = String(form.get("body") || "") || undefined;
      priority = (String(form.get("priority") || "p2") as Priority) || "p2";
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
    }

    assertUploadsReady(files, 0);
    const bug = createBug(identity, {
      projectId: Number(id),
      title,
      body: bodyText,
      priority,
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
