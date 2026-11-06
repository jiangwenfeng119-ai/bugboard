import { handleMcpRequest } from "@/lib/mcp-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleMcpRequest(req);
}

export function POST(req: Request) {
  return handleMcpRequest(req);
}

export function DELETE(req: Request) {
  return handleMcpRequest(req);
}

export function OPTIONS(req: Request) {
  return handleMcpRequest(req);
}
