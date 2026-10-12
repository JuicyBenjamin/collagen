import { describe, expect, it } from "vitest";
import { authorization, isLocalUrl, originOf, showGap, shownShows } from "./shows";

// A show rides the room's log to every peer: nothing on it may be a credential.
describe("where a change runs, as filed", () => {
  it("takes a page and a request", () => {
    expect(showGap({ title: "Ticket list", url: "http://localhost:5173/tickets" })).toBeNull();
    expect(showGap({ title: "Export", url: "https://staging.example.com/api/export?rows=10", method: "post", body: '{"rows": 10}', headers: [{ name: "Content-Type", value: "application/json" }], signIn: "https://staging.example.com/login" })).toBeNull();
  });

  it("refuses a credential anywhere in it", () => {
    expect(showGap({ title: "x", url: "https://u:p@example.com/" })).toMatch(/sign-in/);
    expect(showGap({ title: "x", url: "https://example.com/?access_token=abc" })).toMatch(/access_token/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "GET", headers: [{ name: "Authorization", value: "Bearer abc" }] })).toMatch(/credential/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "GET", headers: [{ name: "X-Trace", value: "Bearer abc" }] })).toMatch(/credential/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "POST", body: '{"email":"a@b.c","password":"hunter2"}' })).toMatch(/password/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "POST", body: "user=a&apiKey=xyz" })).toMatch(/apiKey/);
    // a field that only names a session is not one
    expect(showGap({ title: "x", url: "https://example.com/?sessionId=4", method: "POST", body: '{"tokenCount":"3"}' })).toBeNull();
  });

  it("refuses what is not a request or a page", () => {
    expect(showGap({ title: "x", url: "file:///etc/passwd" })).toMatch(/http/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "FETCH" })).toMatch(/method/);
    expect(showGap({ title: "x", url: "https://example.com/", method: "GET", body: "{}" })).toMatch(/no body/);
    expect(showGap({ title: "x", url: "https://example.com/", body: "{}" })).toMatch(/method/);
    expect(showGap({ title: " ", url: "https://example.com/" })).toMatch(/title/);
  });
});

describe("where a change runs, as read", () => {
  it("says a loopback address is its author's, and keeps tokens by origin", () => {
    expect(isLocalUrl("http://localhost:3000/a")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isLocalUrl("http://app.localhost/")).toBe(true);
    expect(isLocalUrl("https://preview-42.example.com")).toBe(false);
    expect(originOf("https://api.example.com:8443/v1/x?y=1")).toBe("https://api.example.com:8443");
  });

  it("tells the page whether the reader is signed in, never the token", () => {
    const shown = shownShows(
      [
        { id: "s1", title: "Page", url: "http://localhost:5173/" },
        { id: "s2", title: "Call", url: "https://api.example.com/v1/x", method: "GET" },
      ],
      { "https://api.example.com": "secret" },
    );
    expect(shown).toEqual([
      { id: "s1", title: "Page", url: "http://localhost:5173/", local: true },
      { id: "s2", title: "Call", url: "https://api.example.com/v1/x", method: "GET", local: false, signedIn: true },
    ]);
    expect(JSON.stringify(shown)).not.toContain("secret");
  });

  it("never hands the page a link that is not http, whatever build wrote the record", () => {
    const shown = shownShows(
      [
        { id: "s1", title: "Page", url: "javascript:alert(1)" },
        { id: "s2", title: "Call", url: "https://api.example.com/v1/x", method: "GET", signIn: "javascript:alert(1)" },
      ],
      undefined,
    );
    expect(shown).toEqual([{ id: "s2", title: "Call", url: "https://api.example.com/v1/x", method: "GET", local: false, signedIn: false }]);
    expect(shownShows([{ id: "s1", title: "Page", url: "data:text/html,x" }], undefined)).toBeUndefined();
  });

  it("sends a bare token as a bearer one, and one with a scheme as it is", () => {
    expect(authorization(" abc.def ")).toBe("Bearer abc.def");
    expect(authorization("Basic dXNlcjpwYXNz")).toBe("Basic dXNlcjpwYXNz");
  });
});
