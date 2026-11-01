#!/usr/bin/env node
// A stand-in for the `claude` CLI, put first on PATH by a scenario: it plays
// a filing job (review-request.sh) or an answering job (review-question.sh).
// `claude auth status` says it is signed in; `claude -p <prompt> …` reads
// the conversation the prompt names, then files the review with ask-review
// {request}, or answers the question with review-question {questionId} —
// with a flaw when the question asks about negative numbers — over the MCP
// server its --mcp-config gives, and answers as `claude --output-format json`
// does. Every call's
// arguments go to $FAKE_CLAUDE_CALLS, one JSON line each. No model runs.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_CALLS) appendFileSync(process.env.FAKE_CLAUDE_CALLS, `${JSON.stringify(args)}\n`);
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true }));
  process.exit(0);
}

const after = (flag) => args[args.indexOf(flag) + 1];
const prompt = after("-p");
const config = JSON.parse(after("--mcp-config"));
const url = Object.values(config.mcpServers)[0].url;
const request = /request: "([^"]+)"/.exec(prompt)?.[1];
const conversation = /(\S+conversation-1\.md)/.exec(prompt)?.[1]?.replace(/[.,]$/, "");
// what the person said first in the conversation is the why
const said = readFileSync(conversation, "utf8").split("### user")[1]?.split("\n").slice(1).join(" ").split("###")[0].trim() ?? "";

const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" };
async function rpc(body, session) {
  const response = await fetch(url, { method: "POST", headers: session ? { ...headers, "mcp-session-id": session } : headers, body: JSON.stringify(body) });
  const text = await response.text();
  const data = text.split("\n").filter((line) => line.startsWith("data:")).pop();
  return { sid: response.headers.get("mcp-session-id"), json: data ? JSON.parse(data.slice(5)) : text.trim() ? JSON.parse(text) : undefined };
}
const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-claude", version: "0" } } });
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sid);
const questionId = /questionId: "([^"]+)"/.exec(prompt)?.[1];
if (questionId) {
  const negative = /negative/i.test(/The question: (.*)/.exec(prompt)?.[1] ?? "");
  const answered = await rpc(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "review-question", arguments: { questionId, reply: `The conversation says: ${said}`, ...(/assumed: "/.test(prompt) ? { verdict: "corrected" } : {}), ...(negative ? { flaw: "a negative count is doubled too, and the dashboard never shows negatives" } : {}) } },
    },
    init.sid,
  );
  const text = answered.json?.result?.content?.[0]?.text ?? JSON.stringify(answered.json);
  console.log(JSON.stringify({ result: text.slice(0, 200), session_id: `fake-job-${process.pid}` }));
  process.exit(0);
}
const filed = await rpc(
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "ask-review",
      arguments: {
        request,
        title: "Thing counts twice",
        summary: "The dashboard's count is right again.",
        decisions: [{ title: "Counts right again", what: "thing() doubles its count", userWhy: said, agentWhy: "doubling inside thing() reaches every caller", where: ["thing.js"] }],
        forks: [],
      },
    },
  },
  init.sid,
);
const answer = filed.json?.result?.content?.[0]?.text ?? JSON.stringify(filed.json);
console.log(JSON.stringify({ result: answer.slice(0, 200), session_id: `fake-job-${process.pid}` }));
