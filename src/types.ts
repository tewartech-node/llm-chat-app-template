export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database; // warnetworkllm-db — users, messages, memories, shared_knowledge
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
