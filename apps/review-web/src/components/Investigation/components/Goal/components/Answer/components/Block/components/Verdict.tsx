const TONE = {
  yes: { word: "Yes", badge: "badge-success" },
  no: { word: "No", badge: "badge-error" },
  partly: { word: "Partly", badge: "badge-warning" },
} as const;

/** The answer in a line, its yes, no or partly in the colour that means it. */
export function Verdict(props: { verdict: keyof typeof TONE; text: string }) {
  return (
    <p class="inv-verdict">
      <span class={["badge badge-sm badge-soft inv-mark", TONE[props.verdict].badge]}>{TONE[props.verdict].word}</span>
      <strong>{props.text}</strong>
    </p>
  );
}
