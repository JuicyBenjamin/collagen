import { ticketName } from "@collagen/p2p";
import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { basename } from "node:path";
import { Focusable } from "../../../components/Focusable";
import { captureAtom, focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { useRouter, type Route } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { age } from "../../../lib/ticketSummary";
import { roomAtom } from "../../atoms";
import { attachFilesAtom } from "../atoms";
import { ticketsAtom } from "../overview/components/Tickets/atoms";
import { transcriptFilesAtom } from "../transcripts/atoms";

const PATH_HINT = "enter add the file · esc cancel";

/** Pick files you hold to attach to this ticket: the first row takes a path
 *  (a screenshot, a document, a log — anything on this machine); beneath it,
 *  every transcript you have collected. space marks, enter attaches the
 *  marked ones — the references go on the ticket for everyone at once, the
 *  files go to whoever fetches them while you are online, and the outbox
 *  records what went. ← / esc back to the ticket. */
/** `back` is the ticket page it was opened from, as it was reached. */
export function AttachPage({ ticketId, back }: { ticketId: string; back: Route }) {
  const { navigate } = useRouter();
  const roomId = AsyncResult.getOrElse(useAtomValue(roomAtom), () => ({ id: "", name: "" })).id;
  const tickets = AsyncResult.getOrElse(useAtomValue(ticketsAtom), () => [] as const);
  const ticket = tickets.find((candidate) => candidate.id === ticketId);
  const goal = ticket ? ticketName(ticket) : `ticket ${ticketId.slice(0, 8)}`;
  const setFocus = useAtomSet(focusAtom);
  const setCaptured = useAtomSet(captureAtom);
  const loadFiles = useAtomSet(transcriptFilesAtom);
  const filesResult = useAtomValue(transcriptFilesAtom);
  const attach = useAtomSet(attachFilesAtom);
  const [sel, setSel] = useState(0);
  const [marked, setMarked] = useState<ReadonlyArray<string>>([]);
  const [typing, setTyping] = useState<string | null>(null);

  const transcripts = AsyncResult.getOrElse(filesResult, () => [] as const);
  // row 0 is the path field; the rest are collected transcripts
  const rowCount = 1 + transcripts.length;
  const current = clamp(sel, 0, rowCount - 1);
  const extra = marked.filter((path) => !transcripts.some((transcript) => transcript.path === path));

  useEffect(() => {
    setFocus("attach-files");
    loadFiles({ subject: "" });
  }, [setFocus, loadFiles]);

  const stopTyping = () => {
    setTyping(null);
    setCaptured(null);
  };
  // while typing a path, the input owns the keys; esc is ours
  useKeyboard((key) => {
    if (typing !== null && key.name === "escape") stopTyping();
  });

  const toggle = (path: string) => setMarked((previous) => (previous.includes(path) ? previous.filter((markedPath) => markedPath !== path) : [...previous, path]));

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
        attach to <span fg={theme.fg}>{goal}</span> — a file on this machine, or a transcript you collected
      </text>
      <Focusable
        id="attach-files"
        hint="↑↓ pick · space mark · enter on the path row types a path, elsewhere attaches the marked ones · ← / esc back to the ticket"
        flexDirection="column"
        flexShrink={0}
        marginTop={1}
        onKey={(key) => {
          if (key.name === "up" && current > 0) return setSel(current - 1), true;
          if (key.name === "down" && current < rowCount - 1) return setSel(current + 1), true;
          if (key.name === "space" && current > 0) {
            const transcript = transcripts[current - 1];
            if (transcript) toggle(transcript.path);
            return true;
          }
          if (isEnter(key)) {
            if (current === 0) {
              setTyping("");
              setCaptured(PATH_HINT);
              return true;
            }
            const transcript = transcripts[current - 1];
            const chosen = marked.length > 0 ? marked : transcript ? [transcript.path] : [];
            if (chosen.length > 0) {
              attach({ roomId, ticketId, goal, paths: chosen });
              navigate(back);
              setFocus("ticket-diagnostics");
            }
            return true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>files</span>
              <span fg={theme.dim}>{marked.length > 0 ? ` · ${marked.length} marked` : ""}</span>
            </text>
            {/* the path row */}
            <box flexDirection="row" flexShrink={0}>
              <text fg={focused && current === 0 ? theme.accent : theme.fg} truncate wrapMode="none">
                {focused && current === 0 ? "› " : "  "}
                <span fg={theme.dim}>{typing !== null ? "path: " : "a path on this machine — enter to type it"}</span>
              </text>
              {typing !== null ? (
                <box flexGrow={1}>
                  <input
                    focused
                    value={typing}
                    onInput={(text: string) => setTyping(text)}
                    onSubmit={() => {
                      const path = typing.trim();
                      if (path.length > 0 && !marked.includes(path)) setMarked((previous) => [...previous, path]);
                      stopTyping();
                    }}
                    placeholder="/Users/you/Desktop/shot.png"
                  />
                </box>
              ) : null}
            </box>
            {extra.map((path) => (
              <text key={path} fg={theme.fg} truncate wrapMode="none" flexShrink={0}>
                {"    "}
                <span fg={theme.ok}>[x] </span>
                {basename(path)}
                <span fg={theme.dim}> · {path}</span>
              </text>
            ))}
            {/* collected transcripts */}
            <text truncate wrapMode="none" flexShrink={0} marginTop={1}>
              <span fg={theme.dim}>collected transcripts · {transcripts.length}</span>
            </text>
            {transcripts.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
                {"  "}none yet — collect transcripts on a ticket first
              </text>
            ) : (
              transcripts.map((transcript, index) => (
                <text key={transcript.path} fg={focused && index + 1 === current ? theme.accent : theme.fg} truncate wrapMode="none" flexShrink={0}>
                  {focused && index + 1 === current ? "› " : "  "}
                  <span fg={marked.includes(transcript.path) ? theme.ok : theme.dim}>{marked.includes(transcript.path) ? "[x] " : "[ ] "}</span>
                  {transcript.meta ? `from ${transcript.meta.from}` : transcript.name}
                  <span fg={theme.dim}>
                    {transcript.meta ? ` · ${transcript.meta.ai} · ${transcript.meta.entries} entries · received ${age(transcript.meta.receivedAt, Date.now())} ago` : ""} · {transcript.subject} · {transcript.kilobytes} kB
                  </span>
                </text>
              ))
            )}
          </>
        )}
      </Focusable>
    </box>
  );
}
