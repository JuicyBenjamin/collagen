/** The review page: one self-contained document (no bundle, no CDN — it
 *  ships inside the cli build as this string), served by the instance at
 *  /review/<ticketId>. It reads /review/<ticketId>/data and draws the diff
 *  decision by decision: what was decided, how the person steered it, what
 *  their agent reasoned, then the hunks at its lines and the forks in them;
 *  last, every hunk no decision claims — "not explained", itself a finding.
 *  Read-only: a take goes back through the person's agent. */
export const reviewPage = (ticketId: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review by intent</title>
<style>
:root {
  --bg: #f7f7fb; --panel: #ffffff; --fg: #1f2335; --dim: #6b7089; --line: #e3e5ee;
  --accent: #3d59a1; --ok: #33635c; --warn: #8f5e15;
  --add-bg: #e6f4ea; --add-fg: #1e5b2b; --del-bg: #fbe9eb; --del-fg: #8c1d2c; --gutter: #9aa0b8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1a1b26; --panel: #1f2335; --fg: #c0caf5; --dim: #737aa2; --line: #2f3549;
    --accent: #7aa2f7; --ok: #9ece6a; --warn: #e0af68;
    --add-bg: #1e3a2a; --add-fg: #b5e8a0; --del-bg: #3d1f29; --del-fg: #f7a1b0; --gutter: #565f89;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: var(--accent); }
.wrap { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 24px; max-width: 1400px; margin: 0 auto; padding: 24px 16px 64px; }
@media (max-width: 900px) { .wrap { grid-template-columns: minmax(0, 1fr); } nav { position: static !important; } }
nav { position: sticky; top: 16px; align-self: start; font-size: 14px; }
nav ol { list-style: none; margin: 8px 0 0; padding: 0; }
nav li { margin: 0 0 6px; }
nav a { text-decoration: none; display: block; padding: 4px 8px; border-radius: 6px; color: var(--fg); }
nav a:hover { background: var(--panel); }
nav .count { color: var(--dim); float: right; font-variant-numeric: tabular-nums; }
header h1 { font-size: 22px; margin: 0 0 4px; }
.meta { color: var(--dim); font-size: 14px; }
.meta code { color: var(--fg); }
.summary { margin: 12px 0 0; }
.source { margin-top: 12px; font-size: 13px; color: var(--dim); }
.source.none { color: var(--warn); }
section.decision { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-top: 20px; }
section.decision.unexplained { border-style: dashed; }
section h2 { font-size: 17px; margin: 0 0 8px; }
section h2 .id { color: var(--dim); font-weight: normal; margin-right: 6px; }
.why { margin: 0 0 8px; }
.why .who { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--dim); margin-right: 6px; }
.why.user { color: var(--accent); }
.where { font-size: 13px; color: var(--ok); margin: 6px 0 0; }
.unmatched { font-size: 13px; color: var(--warn); margin: 4px 0 0; }
.hunk { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.hunk .file { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 6px 10px; background: var(--bg); border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; gap: 8px; }
.hunk .file .head { color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font: 11px -apple-system, sans-serif; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--warn); color: var(--warn); white-space: nowrap; }
.code { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
td { padding: 0 10px; white-space: pre; vertical-align: top; }
td.n { color: var(--gutter); text-align: right; user-select: none; width: 1%; padding: 0 6px; }
tr.add td.t { background: var(--add-bg); color: var(--add-fg); }
tr.del td.t { background: var(--del-bg); color: var(--del-fg); }
tr.fork td { background: transparent; }
.forkbox { margin-top: 12px; border-left: 3px solid var(--warn); padding: 6px 12px; background: var(--bg); border-radius: 0 6px 6px 0; }
.forkbox .at { font: 12px ui-monospace, monospace; color: var(--ok); }
.forkbox .instead { color: var(--dim); }
.forkbox .by { color: var(--warn); font-size: 13px; }
.empty { color: var(--dim); font-style: italic; margin-top: 8px; }
.note { color: var(--dim); font-size: 13px; margin-top: 28px; }
</style>
</head>
<body>
<div class="wrap">
  <nav id="toc" aria-label="Decisions"></nav>
  <main id="main"><p class="meta">reading the review…</p></main>
</div>
<script>
const TICKET = ${JSON.stringify(ticketId).replace(/</g, "\\u003c")};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

function hunkHtml(h, shared) {
  const rows = h.lines.map((l) => {
    const cls = l.kind === "+" ? "add" : l.kind === "-" ? "del" : "";
    return '<tr class="' + cls + '"><td class="n">' + (l.old ?? "") + '</td><td class="n">' + (l.new ?? "") + '</td><td class="t">' + esc(l.kind === " " ? " " : l.kind) + esc(l.text) + '</td></tr>';
  }).join("");
  return '<div class="hunk"><div class="file"><span class="head">' + esc(h.file) + '  ' + esc(h.header.replace(/^@@[^@]*@@/, "").trim()) + '</span>' +
    (shared ? '<span class="badge" title="another decision claims this hunk too">shared</span>' : "") +
    '</div><div class="code"><table>' + rows + '</table></div></div>';
}

function forkHtml(f) {
  return '<div class="forkbox"><div class="at">' + esc(f.id) + ' · ' + esc(f.at) + '</div>' +
    '<div>chose ' + esc(f.chose) + '</div><div class="instead">instead of ' + esc(f.instead) + '</div>' +
    '<div class="by">' + esc(f.why) + (f.by ? ' · ' + (f.by === "user" ? "the person's call" : "the agent's call") : "") + '</div></div>';
}

function render(d) {
  document.title = d.ticket.goal + " — review by intent";
  const g = d.grouped;
  const byId = new Map((g ? g.hunks : []).map((h) => [h.id, h]));
  const where = d.review.branch ? '<code>' + esc(d.review.branch) + '</code> → <code>' + esc(d.review.base ?? "main") + '</code>' : "no branch";
  const links = d.links.map((l) => '<a href="' + esc(l.url) + '" target="_blank" rel="noreferrer">' + esc(l.label) + '</a>').join(" · ");
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.append(el('<header><h1>' + esc(d.ticket.goal) + '</h1>' +
    '<div class="meta">' + esc(d.ticket.kind) + ' · ' + esc(d.ticket.project) + ' · ' + where + ' · by ' + esc(d.review.authorName) +
    ' · revised ' + esc(new Date(d.review.ts).toLocaleString()) + (links ? ' · ' + links : "") + '</div>' +
    '<p class="summary">' + esc(d.review.summary) + '</p>' +
    '<div class="source ' + (g ? "" : "none") + '">' + (g ? "diff: " : "no diff: ") + esc(d.source.detail) + '</div></header>'));

  const sections = g ? g.sections : d.review.decisions.map((dec) => ({ decision: dec, hunks: [], shared: [], forks: [], unmatched: [] }));
  const toc = ['<strong>decisions</strong><ol>'];
  sections.forEach((s, i) => {
    const dec = s.decision;
    toc.push('<li><a href="#' + esc(dec.id) + '">' + esc(dec.id) + ' ' + esc(dec.what.slice(0, 60)) + (g ? '<span class="count">' + s.hunks.length + '</span>' : "") + '</a></li>');
    const shared = new Set(s.shared);
    const body = [
      '<section class="decision" id="' + esc(dec.id) + '"><h2><span class="id">' + esc(dec.id) + '</span>' + esc(dec.what) + '</h2>',
      dec.userWhy ? '<p class="why user"><span class="who">the person</span>' + esc(dec.userWhy) + '</p>' : "",
      dec.agentWhy ? '<p class="why"><span class="who">the agent</span>' + esc(dec.agentWhy) + '</p>' : "",
      dec.where.length ? '<div class="where">' + dec.where.map(esc).join(" · ") + '</div>' : "",
      s.unmatched.length ? '<div class="unmatched">no change at ' + s.unmatched.map(esc).join(", ") + ' — the code there did not move, or the why is older than the branch</div>' : "",
      ...s.hunks.map((id) => hunkHtml(byId.get(id), shared.has(id))),
      g && s.hunks.length === 0 ? '<p class="empty">no hunk of this diff is at its lines</p>' : "",
      ...s.forks.map(forkHtml),
      '</section>',
    ];
    main.append(el(body.join("")));
  });
  if (g) {
    toc.push('<li><a href="#unexplained">not explained<span class="count">' + g.unexplained.length + '</span></a></li>');
    const loose = g.looseForks.map(forkHtml).join("");
    main.append(el('<section class="decision unexplained" id="unexplained"><h2>not explained</h2>' +
      '<p class="why">' + (g.unexplained.length === 0 ? "every hunk is claimed by a decision." : g.unexplained.length + " hunk(s) no decision claims — the why does not cover them.") + '</p>' +
      g.unexplained.map((id) => hunkHtml(byId.get(id), false)).join("") +
      (loose ? '<p class="why" style="margin-top:14px">forks outside every decision\\'s lines</p>' + loose : "") + '</section>'));
  } else if (d.review.forks.length) {
    main.append(el('<section class="decision"><h2>forks in the road</h2>' + d.review.forks.map(forkHtml).join("") + '</section>'));
  }
  toc.push("</ol>");
  document.getElementById("toc").innerHTML = toc.join("");
  main.append(el('<p class="note">Read-only. Say what you think through your agent — it posts your review on the ticket.</p>'));
}

fetch("/review/" + encodeURIComponent(TICKET) + "/data")
  .then((r) => (r.ok ? r.json() : r.text().then((t) => Promise.reject(new Error(t)))))
  .then(render)
  .catch((e) => { document.getElementById("main").innerHTML = '<p class="source none">' + esc(e.message) + '</p>'; });
</script>
</body>
</html>
`;
