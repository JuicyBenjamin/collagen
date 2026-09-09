import { theme } from "../../../../app/theme";

/** `sender → receiver`: only the sender carries colour — orange for a peer,
 *  blue for you — so who spoke reads at a glance and the rest stays quiet. */
export function Arrow({ from, to, mine }: { from: string; to: string; mine: boolean }) {
  return (
    <>
      <span fg={mine ? theme.accent : theme.warn}>{from}</span>
      <span fg={theme.dim}> → {to}</span>
    </>
  );
}
