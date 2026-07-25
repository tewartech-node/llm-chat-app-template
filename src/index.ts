/**
 * LLM Chat Application — now backed by warnetworkllm-db (D1)
 */
import { Env, ChatMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const EMBEDDING_MODEL_ID = "@cf/baai/bge-base-en-v1.5";
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

async function embed(env: Env, text: string): Promise<number[]> {
  const output = await env.AI.run(EMBEDDING_MODEL_ID, { text: [text] });
  const values = "data" in output ? output.data?.[0] : undefined;
  if (!values) throw new Error("Embedding model returned no vector");
  return values;
}

// Embeds a fact and upserts it into Vectorize so it can be recalled by meaning later.
// Best-effort: a failure here leaves the fact in D1 but unsearchable until re-indexed.
async function indexMemory(env: Env, id: number, username: string, fact: string) {
  try {
    const values = await embed(env, fact);
    await env.MEMORY_INDEX.upsert([{ id: `memory:${id}`, values, metadata: { username, fact } }]);
  } catch (error) {
    console.error("Failed to index memory embedding:", error);
  }
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
    const lastUser = [...messages].reverse().find((m) => m.role === "user");

    // Recall memories by semantic similarity to the current message, scoped to this
    // user via the Vectorize metadata filter (never surface one user's facts to another).
    let memFacts: string[] = [];
    if (lastUser) {
      try {
        const queryVector = await embed(env, lastUser.content);
        const { matches } = await env.MEMORY_INDEX.query(queryVector, {
          topK: 8,
          filter: { username },
          returnMetadata: "all",
        });
        memFacts = matches
          .map((m) => (m.metadata as { fact?: string } | undefined)?.fact)
          .filter((fact): fact is string => Boolean(fact));
      } catch (error) {
        console.error("Memory recall failed, continuing without it:", error);
      }
    }

    const { results: sharedRows } = await env.DB.prepare(
      "SELECT insight FROM shared_knowledge ORDER BY hits DESC, created_at DESC LIMIT 5",
    ).all<{ insight: string }>();

    let systemPrompt = SYSTEM_PROMPT;
    if (memFacts.length) {
      systemPrompt += `\n\nThings you know about ${username} from past conversations (keep private to them):\n- ${memFacts.join("\n- ")}`;
    }
    if (sharedRows.length) {
      systemPrompt += `\n\nGeneral things you've learned that may help anyone:\n- ${sharedRows
        .map((s) => s.insight)
        .join("\n- ")}`;
    }
    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: systemPrompt });
    }

    if (lastUser) {
      await env.DB.prepare(
        "INSERT INTO messages (session_id, username, role, content) VALUES (?, ?, 'user', ?)",
      )
        .bind(username, username, lastUser.content)
        .run();
    }

    const inputs = { messages, max_tokens: 1024, stream: true };
    const aiStream = await env.AI.run(MODEL_ID, inputs, {});

    const [clientStream, saveStream] = (aiStream as ReadableStream).tee();
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
  const { meta } = await env.DB.prepare("INSERT INTO memories (fact, username) VALUES (?, ?)")
    .bind(fact, username)
    .run();
  await indexMemory(env, meta.last_row_id, username, fact);
  return new Response(JSON.stringify({ ok: true, fact }), {
    headers: { "content-type": "application/json" },
  });
}
