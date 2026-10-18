// Where a machine's parts sit: the sources down the left, then one column per
// state, the gaps between columns holding the moves to the next state. Every
// place is a CSS length, so the stage follows the page's width.

/** The space between two columns, where a move to the next state is drawn. */
export const GAP = 44;
/** The row of labels above the states. */
export const TOP = 30;
/** A state's name and what it shows, above its first actor. */
export const HEAD = 64;
/** One actor's row in a state. */
export const ROW = 66;
/** One route below the states, for a move that skips a state or goes back. */
export const LANE = 36;

/** The columns: how many, and how far in from the left they start. */
export interface Stage {
  readonly columns: number;
  readonly start: number;
}

const share = (stage: Stage) => `(100% - ${stage.start + (stage.columns - 1) * GAP}px) / ${stage.columns}`;

export const columnWidth = (stage: Stage) => `calc(${share(stage)})`;
export const columnLeft = (stage: Stage, column: number) => `calc(${stage.start}px + ${column} * ${share(stage)} + ${column * GAP}px)`;
export const columnMiddle = (stage: Stage, column: number) => `calc(${stage.start}px + ${column + 0.5} * ${share(stage)} + ${column * GAP}px)`;
/** Where the gap after a column begins. */
export const gapLeft = (stage: Stage, column: number) => `calc(${stage.start}px + ${column + 1} * ${share(stage)} + ${column * GAP}px)`;
/** From one column's middle to another's, so many columns apart. */
export const across = (stage: Stage, columns: number) => `calc(${columns} * ${share(stage)} + ${columns * GAP}px)`;
