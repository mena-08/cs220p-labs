#!/usr/bin/env node
/* Build the CS220P sites.

   Sources (cs220p_site/): index.html, leaderboard.html, activity.html (live class-activity results), lab.js, lab.css and the lab pages labN.html.
   server/official.json: the hidden official tournament seeds (never copied into a page).

   Outputs:
   dist/                          public project cs220p-labs: one shared version of every lab (teaching notes removed),
                                  the landing page and the live leaderboard. Deployed together with functions/ (the tournament API).
   functions/_generated/labs.js   each lab's tournament spec, built from the page's own code with a stubbed DOM, plus its
                                  official seeds; labs with precompute: true get a score table for every parameter combination.
   dist_ta/                       project cs220p-ta (behind Cloudflare Access): the run sheet with the teaching notes.

   Every rewrite and parse asserts it matched, so a changed source layout fails the build instead of publishing
   teaching notes, leaking official seeds or producing a run sheet with missing steps. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enumerate, normalize, tableKey } from "./functions/_lib/params.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "cs220p_site"), DIST = path.join(ROOT, "dist"), DIST_TA = path.join(ROOT, "dist_ta"), GEN = path.join(ROOT, "functions", "_generated");
const PUBLIC_SITE = "https://cs220p-labs.pages.dev";
const CPU_BUDGET_MS = 60;
const read = (f) => fs.readFileSync(f, "utf8");
const fail = (msg) => { console.error("build failed: " + msg); process.exit(1); };

const ASK_BLOCK = /\n *ask: `[^`]*`,/g;
const DEEPER_BLOCK = /^window\.LAB_DEEPER = \{\n[\s\S]*?^\};\n/m;   // graduate notes: run sheet only
const STEP_HEAD = /\n *id: "([^"]+)", title: "([^"]+)"(, tour: true)?, time: (\d+),/g;
const LAB_INIT = /Lab\.init\(\{\s*title: "([^"]+)", steps, footer: "([^"]*)"/;   // further options (e.g. welcome) may follow
const LABCARD = /<div class="labcard[^"]*"><div class="day">([^<]*)<\/div><h2>([^<]*)<\/h2>[\s\S]*?<a href="(lab\d+)\.html">/g;
const TOURNAMENT_OL = /<div class="how">[\s\S]*?(<ol>[\s\S]*?<\/ol>)/;
const LAB_SCRIPT = /<script src="lab\.js"><\/script>\n(?:<script src="[\w.-]+"><\/script>\n)*<script>\n([\s\S]*?)<\/script>/;   // helper scripts (labcode.js, ...) may follow lab.js

/* ---- the lab code as a function body that returns the tournament spec, runnable without a browser ---- */
function specBody(frameworkJs, labJs) {
  return `"use strict";
const __P = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : __P), apply: () => __P, construct: () => __P, set: () => true });
const window = {}, document = __P, matchMedia = () => ({ matches: false }), getComputedStyle = () => ({ getPropertyValue: () => "" });
const localStorage = { getItem: () => null, setItem() {}, removeItem() {} }, location = { hash: "" }, addEventListener = () => {}, requestAnimationFrame = () => 0, alert = () => {}, confirm = () => false;
let __spec = null;
${frameworkJs}
const Lab = window.Lab;
Lab.init = () => {};
Lab.tournamentSpec = (s) => (__spec = s);
${labJs}
return __spec;`;
}

function templateMap(html, name, variable) {
  const m = html.match(new RegExp(`^window\\.${variable} = \\{\\n([\\s\\S]*?)^\\};`, "m"));
  if (!m) fail(`${name}: window.${variable} not found`);
  return Object.fromEntries([...m[1].matchAll(/^(\w+): `([^`]*)`,/gm)].map((x) => [x[1], x[2]]));
}

function labData(file, html, card) {
  const init = html.match(LAB_INIT);
  if (!init) fail(`${file}: Lab.init call not found`);
  const tasks = templateMap(html, file, "LAB_TASKS"), deeper = templateMap(html, file, "LAB_DEEPER");
  const heads = [...html.matchAll(STEP_HEAD)];
  if (!heads.length || heads.length !== html.split('", title: "').length - 1) fail(`${file}: step headers not parsed; source layout changed`);
  const steps = heads.map((m, k) => {
    const block = html.slice(m.index + m[0].length, k + 1 < heads.length ? heads[k + 1].index : init.index);
    const field = (f) => (block.match(new RegExp(`^ *${f}: \`([^\`]*)\`,`, "m")) || [null, ""])[1];
    const step = { id: m[1], title: m[2], tour: !!m[3], time: +m[4], theory: field("theory"), ask: field("ask"), task: tasks[m[1]] || "", deeper: deeper[m[1]] || "" };
    if (step.tour && !step.theory) step.theory = (html.match(/intro: `([^`]*)`/) || [null, ""])[1];
    if (!step.theory || (step.theory + step.ask).includes("${")) fail(`${file}: step ${m[1]} theory missing or interpolated`);
    return step;
  });
  const ids = new Set(steps.map((s) => s.id));
  if (!Object.keys(tasks).every((t) => ids.has(t))) fail(`${file}: LAB_TASKS has ids with no step`);
  const id = file.replace(".html", "");
  return { id, file, short: "Lab " + id.slice(3), title: init[1], footer: init[2], day: card[0], hook: card[1], steps };
}

/* ---- build ---- */
for (const d of [DIST, DIST_TA, GEN]) fs.rmSync(d, { recursive: true, force: true });
for (const d of [DIST, DIST_TA, GEN]) fs.mkdirSync(d, { recursive: true });

const official = JSON.parse(read(path.join(ROOT, "server", "official.json")));
const frameworkJs = read(path.join(SRC, "lab.js"));
const indexHtml = read(path.join(SRC, "index.html"));
const labFiles = fs.readdirSync(SRC).filter((f) => /^lab\d+\.html$/.test(f)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
if (!labFiles.length) fail("no lab pages in cs220p_site");

const cards = Object.fromEntries([...indexHtml.matchAll(LABCARD)].map((m) => [m[3], [m[1], m[2]]]));
if (Object.keys(cards).sort().join() !== labFiles.map((f) => f.replace(".html", "")).sort().join()) fail("index.html: lab cards do not match the lab pages");

const generated = [], runsheetLabs = [];
for (const file of labFiles) {
  const html = read(path.join(SRC, file));
  if (/LAB_MODE|Lab\.mode/.test(html)) fail(`${file}: still uses LAB_MODE / Lab.mode`);
  if (/officialSeeds|OFFICIAL\s*=/.test(html)) fail(`${file}: official seeds must not be in the page (they live in server/official.json)`);

  /* public page: teaching notes and graduate notes removed */
  const pub = html.replace(ASK_BLOCK, "").replace(DEEPER_BLOCK, "");
  if (pub.includes("ask: `") || pub.includes("LAB_DEEPER")) fail(`${file}: teaching notes survived stripping`);
  fs.writeFileSync(path.join(DIST, file), pub);

  /* tournament spec, run outside the browser exactly as the server will */
  const labJs = (html.match(LAB_SCRIPT) || fail(`${file}: lab script after lab.js not found`))[1];
  const body = specBody(frameworkJs, labJs);
  const spec = new Function(body)();
  if (!spec) fail(`${file}: no Lab.tournamentSpec(...) at top level`);
  const seeds = official[spec.labId] || fail(`${file}: no official seeds for ${spec.labId} in server/official.json`);
  const defaults = normalize(spec, Object.fromEntries(spec.params.map((p) => [p.key, p.default])));
  let table = null, note;
  if (spec.precompute) {
    const combos = enumerate(spec);
    if (combos.length > 2000) fail(`${file}: ${combos.length} parameter combinations is too many to precompute`);
    const t0 = performance.now();
    table = Object.fromEntries(combos.map((c) => { const r = spec.run({ ...c }, seeds); return [tableKey(c), { points: r.points, details: r.details, summary: r.summary }]; }));
    note = `${combos.length} combinations precomputed in ${Math.round(performance.now() - t0)} ms`;
  } else {
    const t0 = performance.now(); spec.run({ ...defaults }, seeds); const ms = performance.now() - t0;
    if (ms > CPU_BUDGET_MS) fail(`${file}: official run takes ${Math.round(ms)} ms with default parameters; the server budget is ${CPU_BUDGET_MS} ms (use precompute: true or make run() cheaper)`);
    note = `official run ${Math.round(ms)} ms`;
  }
  generated.push(`  ${JSON.stringify(spec.labId)}: {\n    official: ${JSON.stringify(seeds)},\n    table: ${JSON.stringify(table)},\n    load() {\n${body}\n    },\n  },`);
  runsheetLabs.push(labData(file, html, cards[file.replace(".html", "")]));
  console.log(`${file}: ${spec.labId}, ${runsheetLabs.at(-1).steps.length} steps, ${note}`);
}
fs.writeFileSync(path.join(GEN, "labs.js"), `/* generated by build.mjs from cs220p_site/ and server/official.json; do not edit */\nexport const LABS = {\n${generated.join("\n")}\n};\n`);

/* pages plus every shared script and stylesheet (lab.js, lab.css, lab3d.js, ...) */
for (const f of ["index.html", "leaderboard.html", "activity.html", "_redirects", ...fs.readdirSync(SRC).filter((x) => /\.(js|css)$/.test(x))]) fs.copyFileSync(path.join(SRC, f), path.join(DIST, f));

/* TA site: run sheet + a small index */
const ol = indexHtml.match(TOURNAMENT_OL);
const data = { site: PUBLIC_SITE, labs: runsheetLabs, tournament: ol ? ol[1] : "" };
const template = read(path.join(ROOT, "runsheet_template.html"));
if (template.split("/*__DATA__*/").length !== 2) fail("runsheet_template.html: data placeholder missing");
fs.writeFileSync(path.join(DIST_TA, "runsheet.html"), template.replace("/*__DATA__*/", JSON.stringify(data).replace(/<\//g, "<\\/")));
fs.writeFileSync(path.join(DIST_TA, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>CS220P TA</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}a{color:#4a67d6}</style></head><body>
<h1>CS220P TA</h1>
<ul><li><a href="runsheet.html"><b>Run sheet</b></a>: topics, timeline, teaching notes and a pace timer for each lab</li>
<li><a href="${PUBLIC_SITE}/leaderboard.html">Live leaderboard</a> (open the Admin box at the bottom to delete a run or reset a lab; after unlocking, <b>Class activities</b> lists every submitted quiz and challenge with scores and time taken, including the private ones)</li>
<li><a href="${PUBLIC_SITE}/activity.html#L1/properties">Class results: lab 1 step 2 quiz</a> · <a href="${PUBLIC_SITE}/activity.html#L2/reportcard">lab 2 report card</a> · <a href="${PUBLIC_SITE}/activity.html#L2/byhand">lab 2 hand-run challenge</a> (private ones need the admin token in the Admin box)</li>
${runsheetLabs.map((l) => `<li><a href="${PUBLIC_SITE}/${l.file}">${l.title}</a></li>`).join("\n")}</ul></body></html>`);
console.log(`built ${path.relative(ROOT, DIST)}/ (${labFiles.length} labs), ${path.relative(ROOT, GEN)}/labs.js, ${path.relative(ROOT, DIST_TA)}/`);
