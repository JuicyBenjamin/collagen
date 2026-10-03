// Call one of the review page's server functions as the page does, and print
// its answer as JSON: node sfn.mjs <url> [Host header] for a read (a GET),
// or node sfn.mjs post <url> <args as JSON> [Origin] for a write — POSTed
// as the page's own calls are, from its own origin unless another is named.
// The answer is in Solid's own encoding (seroval), decoded with Solid's own
// decodeResponse — the e2e checks read what the page would read.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../review-web/package.json", import.meta.url));
const { decodeResponse } = await import(pathToFileURL(require.resolve("@solidjs/web/server-functions")).href);
const argv = process.argv.slice(2);
let res;
if (argv[0] === "post") {
  const [, url, args, origin] = argv;
  res = await fetch(url, {
    method: "POST",
    body: args,
    headers: { "Content-Type": "application/json", "X-Server-Function-Format": "8", Origin: origin ?? new URL(url).origin },
  });
} else {
  const [url, host] = argv;
  res = await fetch(url, host ? { headers: { host } } : {});
}
if (!res.ok) {
  console.log(`HTTP ${res.status}`);
  process.exit(0);
}
console.log(JSON.stringify((await decodeResponse(res)) ?? null));
