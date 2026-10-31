import { describe, expect, it } from "vitest";
import { storiesIn } from "./stories";
import { isStory, isTest } from "./tests";

const FILE = [
  'import type { Meta, StoryObj } from "@storybook/react";',
  'import { Button } from "./Button";',
  "",
  "export default { component: Button } satisfies Meta<typeof Button>;",
  "type Story = StoryObj<typeof Button>;",
  "",
  "export const Primary: Story = { args: { primary: true } };",
  "",
  "export const WithLongLabel: Story = {",
  '  args: { label: "A label that goes on" },',
  "};",
  "",
  "export const Odd: Story = {",
  '  name: "Disabled, but clickable",',
  "  args: { disabled: true },",
  "};",
];

describe("a story file read by its stories' names", () => {
  it("lists each named export as a story, spelled as Storybook shows it, its own name first", () => {
    expect(storiesIn(FILE).tests.map((story) => [story.title, story.start, story.end])).toEqual([
      ["Primary", 7, 7],
      ["With Long Label", 9, 11],
      ["Disabled, but clickable", 13, 16],
    ]);
  });

  it("is a kind of its own: never a test, even named as one", () => {
    expect(isStory("src/Button.stories.tsx")).toBe(true);
    expect(isStory("src/Button.test.stories.tsx")).toBe(true);
    expect(isTest("src/Button.test.stories.tsx")).toBe(false);
    expect(isTest("src/Button.test.tsx")).toBe(true);
  });
});
