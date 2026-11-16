import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import {
  bugActions,
  canAddSupplement,
  deleteBug,
  getAttachments,
  getBug,
  getBugEvents,
  getBugHandlerLabel,
  getProject,
  resolveActorLabel,
  updateBugPriority,
} from "@/lib/services";
import { matchesProductManager } from "@/lib/product-manager-match";
import { STATUS_LABEL } from "@/lib/types";
import type { Priority } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const bug = getBug(identity, Number(id));
    const project = getProject(identity, bug.project_id);
    const reporterLabel = resolveActorLabel(bug.reporter_type, bug.reporter_id);
    const events = getBugEvents(identity, bug.id).map((e) => ({
      ...e,
      actorLabel: resolveActorLabel(e.actor_type, e.actor_id),
      attachments: getAttachments("status_event", e.id),
    }));
    const attachments = getAttachments("bug", bug.id);
    const actions = bugActions(identity, bug);
    const canSupplement = canAddSupplement(identity, bug);
    return json({
      bug: {
        ...bug,
        statusLabel: STATUS_LABEL[bug.status],
        reporterLabel,
        handlerLabel: getBugHandlerLabel(bug),
        reporterIsProductManager: matchesProductManager(
          reporterLabel,
          project.product_manager || ""
        ),
      },
      events,
      attachments,
      actions: canSupplement ? [...actions, "add_supplement"] : actions,
      canSupplement,
    });
  });
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    const body = await req.json();
    if (body.priority) {
      const bug = updateBugPriority(identity, Number(id), body.priority as Priority);
      return json({ bug });
    }
    return json({ error: "无有效字段" }, 400);
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(req, async (identity) => {
    const { id } = await ctx.params;
    deleteBug(identity, Number(id));
    return json({ ok: true });
  });
}
