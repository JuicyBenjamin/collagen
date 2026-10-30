import type { AnswerBlockView } from "~/data";
import { Choices } from "./components/Choices";
import { Compare } from "./components/Compare";
import { Facts } from "./components/Facts";
import { Points } from "./components/Points";
import { Ranking } from "./components/Ranking";
import { Verdict } from "./components/Verdict";

/** A finding drawn the way its run chose: one component per kind. */
export function Block(props: { block: AnswerBlockView }) {
  const block = props.block;
  switch (block.kind) {
    case "verdict":
      return <Verdict verdict={block.verdict} text={block.text} />;
    case "points":
      return <Points items={block.items} />;
    case "facts":
      return <Facts rows={block.rows} />;
    case "compare":
      return <Compare left={block.left} right={block.right} rows={block.rows} />;
    case "ranking":
      return <Ranking options={block.options} />;
    case "choices":
      return <Choices options={block.options} />;
  }
}
