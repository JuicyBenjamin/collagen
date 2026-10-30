import { closedAs, goalsOf, QUESTION_GOAL, type AnswerBlock, type GoalAnswer, type InvestigationBrief, type Ticket } from "@collagen/p2p";
import type { AnswerView, FollowUpView, GoalView, InvestigationPage } from "@collagen/review-web/data";
import { modelOfLabel } from "./agents";

// An investigation as its page reads it (review-web, /investigation/<id>):
// the goals in their groups, each person's answer as the blocks their run
// chose, the full findings only where they say more, and who answered with
// which model — everything the page shows, from the ticket and its brief.

/** The words a block puts on the page. */
const wordsOf = (block: AnswerBlock): string => {
  switch (block.kind) {
    case "verdict":
      return block.text;
    case "points":
      return block.items.join(" ");
    case "facts":
      return block.rows.map((row) => `${row.label} ${row.value}`).join(" ");
    case "compare":
      return block.rows.map((row) => row.what).join(" ");
    case "ranking":
    case "choices":
      return block.options.map((option) => `${option.name} ${option.why ?? ""}`).join(" ");
  }
};

/** The full findings, when they say clearly more than the blocks above them:
 *  with no blocks they are the answer itself. */
const moreThan = (blocks: ReadonlyArray<AnswerBlock>, findings: string | undefined): string | undefined => {
  const full = findings?.trim();
  if (!full) return undefined;
  if (blocks.length === 0) return full;
  return full.length > blocks.map(wordsOf).join(" ").length * 1.5 ? full : undefined;
};

/** Build the page's view of an investigation. `nameOf` names a person by key. */
export const investigationPage = (ticket: Ticket, brief: InvestigationBrief | undefined, nameOf: (key: string) => string, me: string): InvestigationPage => {
  const question = brief?.question ?? ticket.goal;
  const goals = goalsOf(brief ?? { question });
  const answered = ticket.steps.flatMap((step) => (step.owner === undefined ? [] : (step.answers ?? []).map((answer) => ({ answer, owner: step.owner! }))));
  const followTitle = (goalId: string, ask: string): string => goals.find((goal) => goal.id === goalId)?.then?.find((follow) => follow.ask === ask)?.title ?? ask;
  const answerView = (answer: GoalAnswer, owner: string): AnswerView => {
    const blocks = answer.blocks ?? [];
    const more = moreThan(blocks, answer.findings);
    const followUps: ReadonlyArray<FollowUpView> = (answer.followUps ?? [])
      .filter((follow) => follow.held)
      .map((follow) => {
        const followMore = moreThan(follow.blocks ?? [], follow.findings);
        return { if: follow.if, title: followTitle(answer.goal, follow.ask), outcome: follow.outcome ?? "answered", blocks: follow.blocks ?? [], ...(followMore ? { more: followMore } : {}) };
      });
    return { by: nameOf(owner), outcome: answer.outcome, blocks, ...(more ? { more } : {}), sources: answer.evidence ?? [], followUps };
  };
  const goalView = (goal: (typeof goals)[number]): GoalView => {
    // with no goals of its own, its one goal is the question the header already shows
    const title = goal.id === QUESTION_GOAL ? "Findings" : (goal.title ?? goal.ask);
    return {
      id: goal.id,
      title,
      ...(goal.id !== QUESTION_GOAL && goal.title && goal.title !== goal.ask ? { ask: goal.ask } : {}),
      answers: answered.filter(({ answer }) => answer.goal === goal.id).map(({ answer, owner }) => answerView(answer, owner)),
    };
  };
  // groups in the order their first goal comes, each goal once
  const groups: Array<{ name: string | null; goals: Array<GoalView> }> = [];
  for (const goal of goals) {
    const name = goal.group ?? null;
    const last = groups.at(-1);
    const same = groups.find((group) => group.name === name && name !== null);
    if (same) same.goals.push(goalView(goal));
    else if (last && last.name === null && name === null) last.goals.push(goalView(goal));
    else groups.push({ name, goals: [goalView(goal)] });
  }
  // a run is one conversation; an answer that says none counts once for its model
  const runs = new Map<string, Set<string>>();
  for (const { answer } of answered) {
    const model = answer.agent ? modelOfLabel(answer.agent) : undefined;
    if (!model) continue;
    runs.set(model, (runs.get(model) ?? new Set()).add(answer.conversation ? `${answer.conversation.ai}:${answer.conversation.id}` : "one"));
  }
  return {
    id: ticket.id,
    title: ticket.title ?? ticket.goal,
    question,
    open: closedAs(ticket) === null,
    openedBy: nameOf(ticket.createdBy),
    done: goals.filter((goal) => answered.some(({ answer }) => answer.goal === goal.id)).length,
    total: goals.length,
    people: [...new Set(answered.map(({ owner }) => owner))].map(nameOf),
    models: [...runs].map(([name, conversations]) => ({ name, runs: conversations.size })),
    groups,
    questions: answered.flatMap(({ answer, owner }) =>
      (answer.questions ?? []).map((asked) => {
        // a question from before ids is its words alone, and cannot be answered here
        const question = typeof asked === "string" ? { id: "", text: asked } : asked;
        const decided = question.id ? brief?.decided?.find((had) => had.question === question.id) : undefined;
        return {
          id: question.id,
          by: nameOf(owner),
          text: question.text,
          ...(question.then ? { then: question.then.title ?? question.then.ask } : {}),
          ...(decided ? { answer: decided.answer } : {}),
          canAnswer: question.id !== "" && ticket.createdBy === me && closedAs(ticket) === null && decided === undefined,
        };
      }),
    ),
  };
};
