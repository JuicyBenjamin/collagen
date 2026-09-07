import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("takes the first letters of the first two words", () => {
    expect(initials("dev room")).toBe("DR");
    expect(initials("my-side project")).toBe("MS");
  });
  it("takes two characters of a single word", () => {
    expect(initials("work")).toBe("WO");
    expect(initials("6f056449")).toBe("6F");
  });
  it("always yields two cells", () => {
    expect(initials("x")).toBe("X ");
    expect(initials("")).toBe("? ");
  });
});
