import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createBugboardMcpServer } from "../../mcp/create-server";
import { resolveApiKeyIdentity } from "./auth";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

function withCors(response: Response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function methodNotAllowed() {
  return withCors(
    Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      },
      {
        status: 405,
        headers: { Allow: "POST, DELETE, OPTIONS" },
      }
    )
  );
}

export async function handleMcpRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  // Stateless JSON responses. A long-lived GET SSE stream does not fit a
  // request handler, and clients treat 405 as "no server-initiated stream".
  if (req.method === "GET" || (req.method !== "POST" && req.method !== "DELETE")) {
    return methodNotAllowed();
  }

  const authorization = req.headers.get("authorization");
  if (!resolveApiKeyIdentity(authorization)) {
    return withCors(
      Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "需要有效的 API Key" },
          id: null,
        },
        { status: 401 }
      )
    );
  }

  const apiKey = authorization!.slice("Bearer ".length).trim();
  const mcp = createBugboardMcpServer({
    baseUrl: new URL(req.url).origin,
    apiKey,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await mcp.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } finally {
    await mcp.close();
  }
}
