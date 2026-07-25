export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database; // warnetworkllm-db — users, messages, memories, shared_knowledge, sessions
  MEMORY_INDEX: VectorizeIndex; // warnetworkllm-memories — embeddings of memories.fact, metadata: { username, fact }
  GOOGLE_CLIENT_ID: string; // OAuth 2.0 Web Client ID, checked against the `aud` claim of Google ID tokens
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
