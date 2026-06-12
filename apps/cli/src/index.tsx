import { render } from "ink";
import { loadIdentity } from "./identity";
import { loadDevBootstrap } from "./peers";
import { App } from "./ui/App";

const identity = loadIdentity(process.argv);
const bootstrap = loadDevBootstrap();

// Use the terminal's alternate screen so Ink owns a bounded viewport — frames
// redraw in place instead of stacking into scrollback. Restore on exit.
const ALT_ENTER = "\x1b[?1049h";
const ALT_EXIT = "\x1b[?1049l";
const isTty = Boolean(process.stdout.isTTY);
if (isTty) process.stdout.write(ALT_ENTER);
const restore = () => {
  if (isTty) process.stdout.write(ALT_EXIT);
};

const { waitUntilExit } = render(<App identity={identity} bootstrap={bootstrap} />);
process.on("exit", restore);
waitUntilExit().then(restore, restore);
