import { Env } from "../types";
import { handleTask } from "./core";
import { buildHealthReport } from "./health";

/**
 * Email control channel (plan §4) — the agent reports to and takes
 * instruction from its owner over Cloudflare Email Routing on
 * mail.warnetwork.cloud, with no third-party email service in the path.
 *
 * SECURITY: an inbox is a public attack surface. Two rules hold regardless
 * of message content:
 *
 *   1. Only allow-listed senders are treated as commands. Everything else is
 *      logged and dropped. Note that SMTP envelope senders are trivially
 *      forgeable — this allow-list raises the bar but is NOT authentication.
 *      It is deliberately paired with rule 2 rather than relied on alone.
 *   2. Message bodies are DATA, never instructions. A command email becomes
 *      a task proposal that runs the full guardrail chain like any other
 *      task. It cannot confirm its own destructive actions, touch the vault,
 *      or alter the kill switch — the guardrails don't know or care that the
 *      request arrived by email.
 */

const FROM_ADDRESS = "agent@mail.warnetwork.cloud";

/** Set via `wrangler secret put AGENT_EMAIL_OWNER`. Comma-separated. */
function allowedSenders(env: Env): string[] {
  return (env.AGENT_EMAIL_OWNER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedSender(env: Env, from: string): boolean {
  return allowedSenders(env).includes(from.trim().toLowerCase());
}

async function send(env: Env, to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!env.EMAIL) {
    console.error("send_email binding unavailable — is it configured in wrangler.jsonc?");
    return false;
  }
  try {
    await env.EMAIL.send({ from: FROM_ADDRESS, to, subject, text, html: html ?? `<pre>${text}</pre>` });
    return true;
  } catch (e) {
    console.error("Email send failed:", e);
    return false;
  }
}

/** Alerts: firewall breach, quota threshold, connector failure, self-modification. */
export async function sendAlert(env: Env, subject: string, body: string): Promise<void> {
  for (const owner of allowedSenders(env)) {
    await send(env, owner, `[WarNetech] ${subject}`, body);
  }
}

/** Scheduled digest: what the agent did, learned, and spent. */
export async function sendDigest(env: Env): Promise<void> {
  const health = await buildHealthReport(env);
  const quotaLines = health.quotas
    .map((q) => `  ${q.ceiling}: ${Math.round(q.fraction * 100)}% of ${q.limit.toLocaleString()}${q.degraded ? "  ** DEGRADED **" : ""}`)
    .join("\n");

  const body = [
    `Status: ${health.status}`,
    `Checked: ${health.checkedAt}`,
    "",
    "Stores:",
    ...Object.entries(health.stores).map(([n, s]) => `  ${n}: ${s.ok ? `ok (${s.ms}ms)` : `DOWN — ${s.error}`}`),
    "",
    `Firewall (24h): ${health.firewall.recentThreats} events, ${health.firewall.criticalThreats} critical, ${health.firewall.cachedSignatures} signatures cached`,
    "",
    "Free-tier headroom:",
    quotaLines,
    "",
    `Kill switch: ${health.killSwitch.engaged ? `ENGAGED — ${health.killSwitch.reason}` : "released"}`,
    `Scope-drift flags: ${health.scopeDrift.recentFlagged}`,
    "",
    "Dashboard: https://testllm.warnetwork.cloud/agent-dashboard.html",
  ].join("\n");

  await sendAlert(env, `Daily digest — ${health.status}`, body);
}

async function readBody(message: ForwardableEmailMessage): Promise<string> {
  if (!message.raw) return "";
  const raw = await new Response(message.raw).text();
  // Crude but adequate: everything after the first blank line is the body.
  // Avoids pulling in a MIME parser for what is a single-line command.
  const split = raw.indexOf("\r\n\r\n");
  return (split === -1 ? raw : raw.slice(split + 4)).trim().slice(0, 2000);
}

/**
 * Inbound handler, wired from the Worker's `email` export. Runs the message
 * through handleTask() so it is subject to exactly the same guardrails as an
 * API or cron task — there is no privileged email path.
 */
export async function handleInboundEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const from = message.from;

  if (!isAllowedSender(env, from)) {
    console.warn(`Dropped email from non-allow-listed sender: ${from}`);
    return;
  }

  const body = await readBody(message);
  if (!body) {
    await send(env, from, "[WarNetech] Empty command", "The message body was empty, so nothing was run.");
    return;
  }

  const outcome = await handleTask(env, body, {
    source: "email",
    actor: from,
    // Deliberately never true: an email cannot confirm its own destructive
    // action. Destructive work has to come through an authenticated path.
    confirmed: false,
  });

  const summary = outcome.success
    ? outcome.results.map((r) => `✓ ${r.step.connector}.${r.step.action}`).join("\n")
    : `Not completed: ${outcome.refusedReason ?? outcome.results.find((r) => !r.success)?.error ?? "unknown"}`;

  await send(
    env,
    from,
    `[WarNetech] Re: ${body.slice(0, 60)}`,
    `Task: ${body}\n\nResult: ${outcome.success ? "completed" : "not completed"}\n\n${summary}`,
  );
}
