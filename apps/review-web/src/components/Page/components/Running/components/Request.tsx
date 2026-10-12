import { createSignal, Show } from "solid-js";
import type { SendResult, Show as ShowData } from "~/data";
import { sendShow, signInShow } from "~/api";
import { ticketId } from "~/ticket";
import { where } from "../where";

type Answer = Extract<SendResult, { status: number }>;

/** A body as the page shows it back: JSON indented, the rest as it came. */
const pretty = (answer: Answer): string => {
  if (!answer.type?.includes("json")) return answer.body;
  try {
    return JSON.stringify(JSON.parse(answer.body), null, 2);
  } catch {
    return answer.body;
  }
};

/** A request the change makes, sent again from the reader's own collagen on
 *  their click: its body theirs to edit, signed in with their own token. */
export function Request(props: { show: ShowData; author: string; signedIn: { readonly now: () => boolean; readonly set: (value: boolean) => void } }) {
  const hasBody = () => props.show.method !== "GET" && props.show.method !== "HEAD";
  const [body, setBody] = createSignal(props.show.body ?? "");
  const [sending, setSending] = createSignal(false);
  const [result, setResult] = createSignal<SendResult | null>(null);
  const [token, setToken] = createSignal("");
  const [signError, setSignError] = createSignal<string | null>(null);
  const send = async () => {
    setSending(true);
    try {
      setResult(await sendShow(ticketId, props.show.id, hasBody() ? body() : null));
    } catch (error) {
      setResult({ error: String(error) });
    } finally {
      setSending(false);
    }
  };
  const keep = async (given: string | null) => {
    setSignError(null);
    const kept = await signInShow(ticketId, props.show.id, given).catch((error: unknown) => ({ error: String(error) }));
    if ("error" in kept) return setSignError(kept.error);
    props.signedIn.set(given !== null);
    setToken("");
  };
  return (
    <details class="running-request">
      <summary class="running-row">
        <span>{props.show.title}</span>
        <code>
          {props.show.method} {props.show.url}
        </code>
        <Show when={props.show.local}>
          <span class="running-where local">{where(props.show, props.author)}</span>
        </Show>
      </summary>
      <div class="running-panel">
        <Show when={hasBody()}>
          <textarea class="running-body" value={body()} onInput={(event) => setBody(event.currentTarget.value)} rows={Math.min(14, Math.max(3, body().split("\n").length))} spellcheck={false} />
        </Show>
        <div class="running-actions">
          <Show
            when={!props.signedIn.now()}
            fallback={
              <span class="running-signed">
                Signed in{" "}
                <button type="button" class="quiet small" onClick={() => void keep(null)}>
                  Sign out
                </button>
              </span>
            }
          >
            <form
              class="running-sign"
              onSubmit={(event) => {
                event.preventDefault();
                if (token().trim()) void keep(token());
              }}
            >
              <input type="password" placeholder="Token" autocomplete="off" value={token()} onInput={(event) => setToken(event.currentTarget.value)} />
              <button type="submit" class="quiet small" disabled={!token().trim()}>
                Save
              </button>
              <Show when={props.show.signIn}>
                {(at) => (
                  <a href={at()} target="_blank" rel="noreferrer">
                    Get one ↗
                  </a>
                )}
              </Show>
            </form>
          </Show>
          <button type="button" class="banner-go" disabled={sending()} onClick={() => void send()}>
            {sending() ? "Sending…" : "Send"}
          </button>
        </div>
        <Show when={signError()}>{(why) => <p class="host-error">{why()}</p>}</Show>
        <Show when={result()}>
          {(sent) => (
            <Show when={"status" in sent() ? (sent() as Answer) : null} fallback={<p class="host-error">{(sent() as { error: string }).error}</p>}>
              {(answer) => (
                <div class="running-result">
                  <p class={["running-status", { failed: answer().status >= 400 }]}>
                    {answer().status} {answer().statusText} · {answer().elapsed} ms
                    {answer().location ? ` → ${answer().location}` : ""}
                    {answer().cut ? " · cut short" : ""}
                  </p>
                  <Show when={answer().body}>
                    <pre class="running-response">{pretty(answer())}</pre>
                  </Show>
                </div>
              )}
            </Show>
          )}
        </Show>
      </div>
    </details>
  );
}
