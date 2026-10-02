import { execFile } from "node:child_process";

// Bring a browser tab that is already open to the front, by the start of
// its url. Browsers give no other program a way to do this except their
// AppleScript dictionaries, so it is macOS only, and only for browsers that
// have one: the Chromium family and Safari (Arc with its own verb). The
// first use makes macOS ask the person whether collagen may control the
// browser; a "no", a browser not running or not on the list, or any other
// platform simply answers false, and the caller opens a tab instead.

const chromium = (app: string) => `
on run argv
  set u to item 1 of argv
  tell application "${app}"
    repeat with w in windows
      set i to 0
      repeat with t in tabs of w
        set i to i + 1
        if (URL of t) starts with u then
          set active tab index of w to i
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`;

const SCRIPTS: Record<string, string> = {
  "Google Chrome": chromium("Google Chrome"),
  "Brave Browser": chromium("Brave Browser"),
  "Microsoft Edge": chromium("Microsoft Edge"),
  Chromium: chromium("Chromium"),
  Vivaldi: chromium("Vivaldi"),
  Safari: `
on run argv
  set u to item 1 of argv
  tell application "Safari"
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) starts with u then
          set current tab of w to t
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`,
  Arc: `
on run argv
  set u to item 1 of argv
  tell application "Arc"
    repeat with w in windows
      repeat with t in tabs of w
        if (URL of t) starts with u then
          tell t to select
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`,
};

const osa = (args: ReadonlyArray<string>): Promise<string | null> =>
  new Promise((resolve) => execFile("osascript", [...args], { timeout: 8_000 }, (err, out) => resolve(err ? null : String(out).trim())));

/** Focus a tab whose url starts with `url` in a running browser; true when
 *  one was brought forward. */
export async function focusTab(url: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  for (const [app, script] of Object.entries(SCRIPTS)) {
    // asking whether an app runs needs no permission and launches nothing
    if ((await osa(["-e", `application "${app}" is running`])) !== "true") continue;
    if ((await osa(["-e", script, url])) === "ok") return true;
  }
  return false;
}
