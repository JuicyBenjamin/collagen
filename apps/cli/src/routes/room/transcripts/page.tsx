import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Focusable } from "../../../components/Focusable";
import { focusAtom } from "../../../components/focus";
import { isEnter } from "../../../components/keys";
import { theme } from "../../../app/theme";
import { to, useRouter } from "../../../app/router";
import { clamp } from "../../../lib/math";
import { age } from "../../../lib/ticketSummary";
import { transcriptFilesAtom } from "./atoms";

/** The transcripts collected for a subject (a ticket), as a list: who handed
 *  it over, which agent, size. ↑↓ picks, enter opens one (its turns are the
 *  next page); ← / esc go back to the ticket. */
export function TranscriptsPage({ subject }: { subject: string }) {
  const { route, navigate } = useRouter();
  const setFocus = useAtomSet(focusAtom);
  const loadFiles = useAtomSet(transcriptFilesAtom);
  const filesResult = useAtomValue(transcriptFilesAtom);
  const [fileSel, setFileSel] = useState(0);

  const files = AsyncResult.getOrElse(filesResult, () => [] as const);
  const fSel = clamp(fileSel, 0, Math.max(0, files.length - 1));

  useEffect(() => {
    setFocus("transcript-files");
    loadFiles({ subject });
  }, [setFocus, loadFiles, subject]);

  return (
    <box flexDirection="column" marginTop={1} flexGrow={1} flexShrink={1} overflow="hidden">
      <Focusable
        id="transcript-files"
        hint="↑↓ pick · enter open · ← / esc back to the ticket"
        flexDirection="column"
        flexShrink={0}
        onKey={(key) => {
          if (key.name === "up" && fSel > 0) return setFileSel(fSel - 1), true;
          if (key.name === "down" && fSel < files.length - 1) return setFileSel(fSel + 1), true;
          if (isEnter(key)) {
            const f = files[fSel];
            if (f) navigate(to.transcript(f.path, f.name, route));
            return true;
          }
          return false;
        }}
      >
        {(focused) => (
          <>
            <text truncate wrapMode="none" flexShrink={0}>
              <span fg={focused ? theme.accent : theme.fg}>collected</span>
              <span fg={theme.dim}> · {files.length}</span>
            </text>
            {AsyncResult.isWaiting(filesResult) ? (
              <text fg={theme.dim} flexShrink={0}>
                {"  "}looking…
              </text>
            ) : files.length === 0 ? (
              <text fg={theme.dim} truncate wrapMode="none" flexShrink={0}>
                {"  "}nothing collected yet — run collect transcripts on the ticket; peers hand theirs over from their outbox
              </text>
            ) : (
              files.map((f, i) => (
                <text key={f.path} fg={focused && i === fSel ? theme.accent : theme.fg} truncate wrapMode="none" flexShrink={0}>
                  {focused && i === fSel ? "› " : "  "}
                  {f.meta ? (
                    <>
                      from {f.meta.from}
                      <span fg={theme.dim}>
                        {" "}· {f.meta.ai} · {f.meta.entries} entries · since {new Date(f.meta.since).toISOString().slice(0, 16).replace("T", " ")} · received{" "}
                        {age(f.meta.receivedAt, Date.now()) === "now" ? "just now" : `${age(f.meta.receivedAt, Date.now())} ago`}
                      </span>
                    </>
                  ) : (
                    <>
                      {f.name}
                      <span fg={theme.dim}> · no provenance</span>
                    </>
                  )}
                  <span fg={theme.dim}>
                    {subject ? "" : ` · ${f.subject}`} · {f.kb} kB
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
