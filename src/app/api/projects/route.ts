import { NextRequest } from "next/server";
import { withAuth, json } from "@/lib/http";
import { documentsByProject } from "@/lib/project-documents";
import { createProject, listProjects, openBugCountsByProject } from "@/lib/services";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const projects = listProjects(identity);
    const openCounts = openBugCountsByProject(identity);
    const documents = documentsByProject(projects.map((project) => project.id));
    return json({
      projects: projects.map((p) => ({
        ...p,
        openCount: openCounts[p.id]?.open || 0,
        pendingCount: openCounts[p.id]?.pending || 0,
        awaitingConfirmCount: openCounts[p.id]?.awaitingConfirm || 0,
        needsInfoCount: openCounts[p.id]?.needsInfo || 0,
        documents: documents[p.id] || [],
      })),
    });
  });
}

export async function POST(req: NextRequest) {
  return withAuth(req, async (identity) => {
    const body = await req.json();
    const project = createProject(identity, body);
    return json({ project }, 201);
  });
}
