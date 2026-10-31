import { describe, expect, it } from "vitest";
import { isLocalUrl, showGap, shownShows } from "./shows";

// A show rides the room's log to every peer: nothing on it may be a credential.
describe("where a change runs, as filed", () => {
  it("takes a page", () => {
    expect(showGap({ title: "Ticket list", url: "http://localhost:5173/tickets" })).toBeNull();
    expect(showGap({ title: "Export", url: "https://staging.example.com/export?rows=10" })).toBeNull();
  });

  it("refuses a credential in its url", () => {
    expect(showGap({ title: "x", url: "https://u:p@example.com/" })).toMatch(/sign-in/);
    expect(showGap({ title: "x", url: "https://example.com/?access_token=abc" })).toMatch(/access_token/);
    expect(showGap({ title: "x", url: "https://example.com/?apiKey=abc" })).toMatch(/apiKey/);
    // a field that only names a session is not one
    expect(showGap({ title: "x", url: "https://example.com/?sessionId=4" })).toBeNull();
  });

  it("refuses what is not a page", () => {
    expect(showGap({ title: "x", url: "file:///etc/passwd" })).toMatch(/http/);
    expect(showGap({ title: " ", url: "https://example.com/" })).toMatch(/title/);
  });
});

describe("where a change runs, as read", () => {
  it("says a loopback address is its author's", () => {
    expect(isLocalUrl("http://localhost:3000/a")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLocalUrl("http://app.localhost/")).toBe(true);
    expect(isLocalUrl("https://preview-42.example.com")).toBe(false);
  });

  it("never hands the page a link that is not http, whatever build wrote the record", () => {
    const shown = shownShows([
      { id: "s1", title: "Page", url: "javascript:alert(1)" },
      { id: "s2", title: "Preview", url: "https://preview-42.example.com/x" },
    ], true);
    expect(shown).toEqual([{ id: "s2", title: "Preview", url: "https://preview-42.example.com/x", local: false }]);
    expect(shownShows([{ id: "s1", title: "Page", url: "data:text/html,x" }], true)).toBeUndefined();
  });

  it("a page on its author's machine is there for its author, and not at all for anyone else", () => {
    const shows = [
      { id: "s1", title: "Settings", url: "http://localhost:5173/settings" },
      { id: "s2", title: "Preview", url: "https://preview-42.example.com/x" },
    ];
    expect(shownShows(shows, true)?.map((show) => show.id)).toEqual(["s1", "s2"]);
    expect(shownShows(shows, false)?.map((show) => show.id)).toEqual(["s2"]);
    expect(shownShows([shows[0]!], false)).toBeUndefined();
  });
});
