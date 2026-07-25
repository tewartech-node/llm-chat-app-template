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

const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/auth/google" && request.method === "POST") {
      return handleGoogleAuth(request, env);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }

    if (url.pathname === "/api/me" && request.method === "GET") {
      return handleMe(request, env);
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChatRequest(request, env);
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      return handleHistory(request, env);
    }

    if (url.pathname === "/api/memories") {
      if (request.method === "GET") return handleListMemories(request, env);
      if (request.method === "POST") return handleAddMemory(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function sessionCookie(id: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// The session cookie is the sole source of identity for every API call below —
// nothing here trusts a client-supplied username again.
async function getSessionUsername(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    "SELECT username FROM sessions WHERE id = ? AND expires_at > datetime('now')",
  )
    .bind(sessionId)
    .first<{ username: string }>();
  return row?.username ?? null;
}

function usernameFromEmail(email: string): string {
  const local = email.split("@")[0].toLowerCase();
  const slug = local.replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
  return slug.length >= 2 ? slug : `user_${slug}`.slice(0, 32);
}

async function findOrCreateUserByGoogle(env: Env, googleId: string, email: string): Promise<string> {
  const byGoogle = await env.DB.prepare("SELECT username FROM users WHERE google_id = ?")
    .bind(googleId)
    .first<{ username: string }>();
  if (byGoogle) return byGoogle.username;

  // Link a pre-existing (legacy, unauthenticated) username to this Google account by email.
  const byEmail = await env.DB.prepare(
    "SELECT username FROM users WHERE email = ? AND google_id IS NULL",
  )
    .bind(email)
    .first<{ username: string }>();
  if (byEmail) {
    await env.DB.prepare("UPDATE users SET google_id = ? WHERE username = ?")
      .bind(googleId, byEmail.username)
      .run();
    return byEmail.username;
  }

  const base = usernameFromEmail(email);
  let candidate = base;
  let suffix = 0;
  while (
    await env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(candidate).first()
  ) {
    suffix += 1;
    candidate = `${base}${suffix}`.slice(0, 32);
  }

  await env.DB.prepare("INSERT INTO users (username, google_id, email) VALUES (?, ?, ?)")
    .bind(candidate, googleId, email)
    .run();
  return candidate;
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

// Verifies the Google ID token via Google's tokeninfo endpoint (Google checks the
// signature and expiry; we only need to additionally confirm it was issued for our app).
async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { credential?: string };
  const credential = body.credential;
  if (!credential) {
    return jsonError("credential_required", 400);
  }

  const verifyRes = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  );
  if (!verifyRes.ok) {
    return jsonError("invalid_google_token", 401);
  }
  const payload = (await verifyRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: string;
    aud: string;
  };
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    return jsonError("invalid_google_token", 401);
  }
  if (!payload.email || payload.email_verified !== "true") {
    return jsonError("email_not_verified", 401);
  }

  const username = await findOrCreateUserByGoogle(env, payload.sub, payload.email);

  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO sessions (id, username, expires_at) VALUES (?, ?, datetime('now', '+30 days'))",
  )
    .bind(sessionId, username)
    .run();

  return new Response(JSON.stringify({ username }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookie(sessionId, SESSION_TTL_SECONDS),
    },
  });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json",
      "set-cookie": sessionCookie("", 0),
    },
  });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const username = await getSessionUsername(request, env);
  if (!username) return jsonError("not_authenticated", 401);
  return new Response(JSON.stringify({ username }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const username = await getSessionUsername(request, env);
    if (!username) return jsonError("not_authenticated", 401);

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

async function handleHistory(request: Request, env: Env): Promise<Response> {
  const username = await getSessionUsername(request, env);
  if (!username) return jsonError("not_authenticated", 401);
  const { results } = await env.DB.prepare(
    "SELECT role, content, created_at FROM messages WHERE username = ? ORDER BY id ASC",
  )
    .bind(username)
    .all();
  return new Response(JSON.stringify({ username, messages: results }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleListMemories(request: Request, env: Env): Promise<Response> {
  const username = await getSessionUsername(request, env);
  if (!username) return jsonError("not_authenticated", 401);
  const { results } = await env.DB.prepare(
    "SELECT id, fact, created_at FROM memories WHERE username = ? ORDER BY created_at DESC",
  )
    .bind(username)
    .all();
  return new Response(JSON.stringify({ username, memories: results }), {
    headers: { "content-type": "application/json" },
  });
}

async function handleAddMemory(request: Request, env: Env): Promise<Response> {
  const username = await getSessionUsername(request, env);
  if (!username) return jsonError("not_authenticated", 401);
  const body = (await request.json()) as { fact?: string };
  const fact = (body.fact || "").trim();
  if (!fact) return jsonError("fact_required", 400);

  const { meta } = await env.DB.prepare("INSERT INTO memories (fact, username) VALUES (?, ?)")
    .bind(fact, username)
    .run();
  await indexMemory(env, meta.last_row_id, username, fact);
  return new Response(JSON.stringify({ ok: true, fact }), {
    headers: { "content-type": "application/json" },
  });
}
