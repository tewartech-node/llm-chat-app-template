/**
 * LLM Chat Application — now backed by warnetech-server-data (D1)
 */
import { Env, ChatMessage } from "./types";
import {
  authenticateConnector,
  deauthenticateConnector,
  executeConnectorAction,
  getConnectorStatus,
} from "./connectors/index";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses. " +
  "Use ordinary common sense: don't state something as fact unless you're actually confident it's true. " +
  "If a user asserts something false or misleading and asks you to agree, confirm, or build on it, " +
  "don't go along with it just because they're insistent — politely point out the issue instead. " +
  "It's fine to say you're not sure rather than guessing. Never present speculation as settled fact.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/identify" && request.method === "POST") {
      return handleIdentify(request, env);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatRequest(request, url, env);
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      return handleHistory(url, env);
    }

    if (url.pathname === "/api/memories") {
      if (request.method === "GET") return handleListMemories(url, env);
      if (request.method === "POST") return handleAddMemory(request, url, env);
    }

    if (url.pathname === "/api/connectors/auth" && request.method === "POST") {
      return handleConnectorAuth(request, env);
    }

    if (url.pathname === "/api/connectors/status" && request.method === "GET") {
      return handleConnectorStatus(env);
    }

    const executeMatch = url.pathname.match(/^\/api\/connectors\/([a-z0-9-]+)\/execute$/);
    if (executeMatch && request.method === "POST") {
      return handleConnectorExecute(request, env, executeMatch[1]);
    }

    const deauthMatch = url.pathname.match(/^\/api\/connectors\/([a-z0-9-]+)\/auth$/);
    if (deauthMatch && request.method === "DELETE") {
      await deauthenticateConnector(env, deauthMatch[1]);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function normalizeUsername(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().slice(0, 32);
  return /^[a-z0-9_\-]{2,32}$/.test(trimmed) ? trimmed : null;
}

function getUsername(request: Request, url: URL): string | null {
  return normalizeUsername(url.searchParams.get("u"));
}

async function ensureUser(env: Env, username: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO users (username) VALUES (?)").bind(username).run();
}

async function handleIdentify(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { username?: string };
  const username = normalizeUsername(body.username ?? null);
  if (!username) {
    return new Response(
      JSON.stringify({ error: "Pick a username: letters, numbers, _ or -, 2-32 chars." }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first();
  await ensureUser(env, username);
  return new Response(JSON.stringify({ username, isNew: !existing }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleChatRequest(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const username = getUsername(request, url);
    if (!username) {
      return new Response(JSON.stringify({ error: "username_required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    await ensureUser(env, username);

    const { messages = [] } = (await request.json()) as { messages: ChatMessage[] };

    const { results: memRows } = await env.DB.prepare(
      "SELECT fact FROM memories WHERE username = ? ORDER BY created_at DESC LIMIT 15",
    )
      .bind(username)
      .all<{ fact: string }>();

    const { results: sharedRows } = await env.DB.prepare(
      "SELECT insight FROM shared_knowledge ORDER BY hits DESC, created_at DESC LIMIT 5",
    ).all<{ insight: string }>();

    let systemPrompt = SYSTEM_PROMPT;
    if (memRows.length) {
      systemPrompt += `\n\nThings you know about ${username} from past conversations (keep private to them):\n- ${memRows
        .map((m) => m.fact)
        .join("\n- ")}`;
    }
    if (sharedRows.length) {
      systemPrompt += `\n\nGeneral things you've learned that may help anyone:\n- ${sharedRows
        .map((s) => s.insight)
        .join("\n- ")}`;
    }
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: systemPrompt });
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      await env.DB.prepare(
        "INSERT INTO messages (session_id, username, role, content) VALUES (?, ?, 'user', ?)",
      )
        .bind(username, username, lastUser.content)
        .run();
    }

    const inputs = { messages, max_tokens: 1024, stream: true };
    const aiStream = await env.AI.run(MODEL_ID, inputs, {});

    const [clientStream, saveStream] = (aiStream as unknown as ReadableStream).tee();
    saveAssistantReply(saveStream, env, username).catch((e) =>
      console.error("Failed to save assistant reply:", e),
    );

    return new Response(clientStream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

async function saveAssistantReply(stream: ReadableStream, env: Env, username: string) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        if (parsed.response) full += parsed.response;
      } catch {
        // ignore non-JSON keep-alive lines
      }
    }
  }
  if (full) {
    await env.DB.prepare(
      "INSERT INTO messages (session_id, username, role, content) VALUES (?, ?, 'assistant', ?)",
    )
      .bind(username, username, full)
      .run();
  }
}

async function handleHistory(url: URL, env: Env): Promise<Response> {
  const username = getUsername(new Request(url), url);
  if (!username) {
    return new Response(JSON.stringify({ error: "username_required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const { results } = await env.DB.prepare(
    "SELECT role, content, created_at FROM messages WHERE username = ? ORDER BY id ASC",
  )
    .bind(username)
    .all();
  return new Response(JSON.stringify({ username, messages: results }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleListMemories(url: URL, env: Env): Promise<Response> {
  const username = getUsername(new Request(url), url);
  if (!username) {
    return new Response(JSON.stringify({ error: "username_required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const { results } = await env.DB.prepare(
    "SELECT id, fact, created_at FROM memories WHERE username = ? ORDER BY created_at DESC",
  )
    .bind(username)
    .all();
  return new Response(JSON.stringify({ username, memories: results }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleAddMemory(request: Request, url: URL, env: Env): Promise<Response> {
  const username = getUsername(request, url);
  const body = (await request.json()) as { fact?: string };
  const fact = (body.fact || "").trim();
  if (!username || !fact) {
    return new Response(JSON.stringify({ error: "username and fact required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  await ensureUser(env, username);
  await env.DB.prepare("INSERT INTO memories (fact, username) VALUES (?, ?)")
    .bind(fact, username)
    .run();
  return new Response(JSON.stringify({ ok: true, fact }), {
    headers: { "content-type": "application/json" },
  });
}

const RATE_LIMIT_PER_MINUTE = 10;

/**
 * Fixed-window rate limit backed by RATELIMIT KV — one counter per connector
 * per UTC minute. KV writes aren't strongly consistent, so this is a soft
 * limit (occasional over-counts under concurrency), which is fine for a
 * guardrail whose job is "slow down a runaway loop," not hard billing enforcement.
 */
async function checkRateLimit(env: Env, bucket: string): Promise<boolean> {
  const minuteKey = `${bucket}:${Math.floor(Date.now() / 60000)}`;
  const current = parseInt((await env.RATELIMIT.get(minuteKey)) ?? "0", 10);
  if (current >= RATE_LIMIT_PER_MINUTE) return false;
  await env.RATELIMIT.put(minuteKey, String(current + 1), { expirationTtl: 70 });
  return true;
}

async function logConnectorCall(
  env: Env,
  connector: string,
  action: string,
  params: Record<string, unknown>,
  success: boolean,
  error?: string,
) {
  await env.DB.prepare(
    "INSERT INTO connector_audit_log (connector, action, params_json, success, error, source) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(connector, action, JSON.stringify(params), success ? 1 : 0, error ?? null, "api")
    .run()
    .catch((e) => console.error("Failed to write connector audit log:", e));
}

async function handleConnectorAuth(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    connector?: string;
    credentials?: Record<string, string>;
  };
  if (!body.connector || !body.credentials) {
    return new Response(JSON.stringify({ error: "connector and credentials are required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const result = await authenticateConnector(env, body.connector, body.credentials);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, connector: body.connector }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleConnectorStatus(env: Env): Promise<Response> {
  const status = await getConnectorStatus(env);
  return new Response(JSON.stringify(status), {
    headers: { "content-type": "application/json" },
  });
}

async function handleConnectorExecute(request: Request, env: Env, connectorName: string): Promise<Response> {
  const allowed = await checkRateLimit(env, `connectors:${connectorName}`);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "rate_limited", limit: RATE_LIMIT_PER_MINUTE }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    params?: Record<string, unknown>;
  };
  if (!body.action) {
    return new Response(JSON.stringify({ error: "action is required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const params = body.params ?? {};

  const result = await executeConnectorAction(env, connectorName, body.action, params);
  await logConnectorCall(env, connectorName, body.action, params, result.success, result.error);

  return new Response(JSON.stringify(result), {
    status: result.success ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
}
