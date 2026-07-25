export interface Env {
  AI: Ai;
  ASSETS: Fetcher;
  DB: D1Database; // warnetworkllm-db — users, messages, memories, shared_knowledge
  MEMORY_INDEX: VectorizeIndex; // warnetworkllm-memories — embeddings of memories.fact, metadata: { username, fact }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
