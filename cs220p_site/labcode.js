/* LabCode: Python exercises in the browser, no dependencies.
   Python is Pyodide, downloaded from the jsDelivr CDN the first time a student presses Run, and run in a Web Worker so an endless loop
   can be stopped without freezing the page. Loading this file only defines window.LabCode.

   LabCode.python()                      the shared Python runner (lazy): run(parts, {timeout, onOut, onStatus}) -> Promise<result>
        parts: [{name, code, user?}] executed in order in one fresh namespace; the part with user: true is the student's code (file
        "your_code.py": errors report its line). A later part sets RESULT (any JSON value). result: {ok, result, userError?} |
        {ok: false, error} | {timedOut} | {loadError} | {fatal}. Inside Python, raise TooManySteps(msg) to stop a run with a message.
   LabCode.editor({code, lines, onRun, label})   textarea editor with line numbers, highlighting, Tab = 4 spaces, auto-indent, Ctrl/Cmd+Enter
        -> {el, get(), set(code, undoable?), mark(line|null), focus(), onChange(fn)}
   LabCode.output()                      output console -> {el, clear(), print(text, kind: "out"|"err"|"info")}
   LabCode.exercise(spec)                editor + Run / Reset / Hint + tests + console (no solutions on the page: they are in the TA cheat sheet)
        spec: {id, title?, minutes?, intro?, starter, hints: [html], lines?, timeout?,
               parts(src) -> parts, check(RESULT, run) -> {tests: [{name, ok, detail}], passed, summary?}, explain?(err) -> html,
               onReport?(report, RESULT), after?: HTMLElement (shown below the tests, e.g. a visualization)}
        -> {el, editor, run()}
   LabCode.parsons({lines, distractors, alternatives, hints, onSolved, seed}) drag lines into order and indent them
        -> {el, code(), solved()}
   LabCode.highlight(src) -> html */
(function () {
  "use strict";
  const PYODIDE_VERSION = "0.29.5";
  const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
  const USER_FILE = "your_code.py";

  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* no storage: work in memory */ } return null; };
  let uid = 0;

  /* ---------- styles, injected on first use ---------- */
  const CSS = `
.lc-ed{--lc-k:#4a59c8;--lc-s:#2a7f5f;--lc-c:#6f7c90;--lc-n:#a85a00;--lc-f:#a3367f;--lc-b:#0b7285;--lc-err:#c23b33;
  display:grid;grid-template-columns:auto minmax(0,1fr);border:1px solid var(--line);border-radius:10px;background:var(--panel);overflow:hidden;
  font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;font-size:14px;line-height:21px}
:root[data-theme="dark"] .lc-ed,:root[data-theme="dark"] .lc-ex,:root[data-theme="dark"] .lc-pz{--lc-k:#aebfff;--lc-s:#7fd1b9;--lc-c:#93a0b8;--lc-n:#f3b366;--lc-f:#f0a6dc;--lc-b:#7dd3e0;--lc-err:#ff9a94}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .lc-ed,:root:not([data-theme="light"]) .lc-ex,:root:not([data-theme="light"]) .lc-pz{--lc-k:#aebfff;--lc-s:#7fd1b9;--lc-c:#93a0b8;--lc-n:#f3b366;--lc-f:#f0a6dc;--lc-b:#7dd3e0;--lc-err:#ff9a94}}
.lc-ed:focus-within{border-color:var(--lagoon);box-shadow:0 0 0 3px color-mix(in srgb,var(--lagoon) 22%,transparent)}
.lc-gut{padding:10px 8px 10px 10px;text-align:right;color:var(--muted);user-select:none;background:var(--paper);border-right:1px solid var(--line);min-width:2.6em;font-variant-numeric:tabular-nums}
.lc-gut div{height:21px}
.lc-gut div.err{color:#fff;background:var(--lc-err);border-radius:4px;padding:0 3px;margin-right:-3px}
.lc-area{position:relative;min-width:0}
.lc-area .lc-pre,.lc-area .lc-ta{margin:0;padding:10px 12px;font:inherit;line-height:21px;white-space:pre;tab-size:4;border:0;border-radius:0;letter-spacing:normal;word-spacing:normal;font-variant-ligatures:none;box-sizing:border-box}
.lc-area .lc-pre{position:absolute;inset:0;pointer-events:none;overflow:hidden;background:transparent;color:var(--ink);max-width:none}
.lc-area .lc-ta{position:relative;display:block;width:100%;max-width:100%;resize:none;background:transparent;color:transparent;caret-color:var(--ink);overflow-x:auto;overflow-y:hidden;outline:none;min-height:0;box-shadow:none}
.lc-area .lc-ta::selection{background:color-mix(in srgb,var(--lagoon) 32%,transparent);color:transparent}
.lc-hl{position:absolute;left:0;right:0;height:21px;background:color-mix(in srgb,var(--lc-err) 16%,transparent);display:none;pointer-events:none}
.lc-pre .k{color:var(--lc-k);font-weight:600}.lc-pre .s{color:var(--lc-s)}.lc-pre .c{color:var(--lc-c);font-style:italic}.lc-pre .n{color:var(--lc-n)}.lc-pre .f{color:var(--lc-f)}.lc-pre .b{color:var(--lc-b)}
.lc-pre .c.t{color:var(--ink);font-style:normal;background:color-mix(in srgb,var(--focus) 30%,transparent);border-radius:3px}
pre.lc-code{font-size:13.5px;line-height:1.5;margin:.4rem 0}
pre.lc-code .k{color:var(--lc-k);font-weight:600}pre.lc-code .s{color:var(--lc-s)}pre.lc-code .c{color:var(--lc-c);font-style:italic}pre.lc-code .n{color:var(--lc-n)}pre.lc-code .f{color:var(--lc-f)}pre.lc-code .b{color:var(--lc-b)}
.lc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.lc-ex{display:flex;flex-direction:column;gap:.6rem;margin:1rem 0;--lc-err:#c23b33}
.lc-head{display:flex;gap:.7rem;align-items:baseline;flex-wrap:wrap}
.lc-head b{font-size:1.05rem}
.lc-intro p{margin:.2em 0 .5em}
.lc-bar{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
.lc-bar .note{margin-left:.2rem}
.lc-status{font-size:.92rem;color:var(--ink-2);display:flex;gap:.5rem;align-items:center}
.lc-status:empty{display:none}
.lc-status .spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--lagoon);animation:lcspin .8s linear infinite;flex:none}
@keyframes lcspin{to{transform:rotate(360deg)}}
.lc-tests:empty{display:none}
.lc-tests .sum{font-weight:600;margin:.2rem 0}
.lc-test{padding:.45rem .75rem;border:1px solid var(--line);border-left:4px solid var(--lc-err);border-radius:8px;margin:.35rem 0;background:var(--panel)}
.lc-test.ok{border-left-color:var(--mint-2)}
.lc-test .t{font-weight:600}
.lc-test .t i{font-style:normal;margin-right:.35rem;color:var(--lc-err)}
.lc-test.ok .t i{color:var(--mint-2)}
.lc-test .d{font-size:.9rem;color:var(--ink-2);margin-top:.15rem}
.lc-test code,.lc-tests code{font-size:.88em;background:var(--paper);border-radius:4px;padding:0 .25em}
.lc-out{max-height:240px;overflow:auto;margin:0;font-size:13px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.lc-out:empty{display:none}
.lc-out .err{color:var(--lc-err)}
.lc-out .info{color:var(--muted);font-style:italic}
.lc-out-title{font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:.2rem 0 -.3rem}
.lc-box:empty{display:none}
.lc-pz{display:flex;flex-direction:column;gap:.6rem;margin:1rem 0;--lc-err:#c23b33}
.lc-pz-cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:1rem}
@media (max-width:760px){.lc-pz-cols{grid-template-columns:1fr}}
.lc-pz-col{border:1.5px dashed var(--line);border-radius:10px;padding:.5rem;min-height:9rem;background:var(--paper)}
.lc-pz-col.ans{background-image:repeating-linear-gradient(90deg,transparent 0,transparent 27px,color-mix(in srgb,var(--line) 85%,transparent) 27px,color-mix(in srgb,var(--line) 85%,transparent) 28px);background-position:.5rem 0;background-size:calc(28px*6) 100%;background-repeat:no-repeat}
.lc-pz-col.hot{border-color:var(--lagoon)}
.lc-pz-cap{font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:0 0 .3rem}
.lc-pz-line{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;font-size:13.5px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:.3rem .55rem;margin:.3rem 0;cursor:grab;touch-action:none;white-space:pre;user-select:none;overflow:hidden;text-overflow:ellipsis}
.lc-pz-line:hover{border-color:var(--lagoon)}
.lc-pz-line.drag{cursor:grabbing;box-shadow:0 8px 24px rgba(0,0,0,.22);z-index:50;opacity:.95}
.lc-pz-line.ok{border-color:var(--mint-2);background:color-mix(in srgb,var(--mint-2) 12%,var(--panel))}
.lc-pz-line.bad{border-color:var(--lc-err);background:color-mix(in srgb,var(--lc-err) 12%,var(--panel))}
.lc-pz-ph{border:1.5px dashed var(--lagoon);border-radius:6px;margin:.3rem 0;background:color-mix(in srgb,var(--lagoon) 10%,transparent)}
.lc-pz-empty{color:var(--muted);font-size:.88rem;padding:.6rem .3rem}
`;
  function injectCss() {
    if (document.getElementById("labcode-css")) return;
    document.head.append(h("style", { id: "labcode-css" }, CSS));
  }

  /* ---------- Python in a Web Worker ---------- */
  const RUNNER_PY = `
import json, traceback

class TooManySteps(BaseException):
    """Raised by the lab's step guard to stop a run (BaseException, so an 'except Exception' in the student's code cannot swallow it)."""

def _lab_error(e):
    err = {"type": type(e).__name__, "message": str(e), "line": None}
    if isinstance(e, SyntaxError) and e.filename == "${USER_FILE}":
        err["line"] = e.lineno
        err["message"] = e.msg
    tb = e.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == "${USER_FILE}":
            err["line"] = tb.tb_lineno
        tb = tb.tb_next
    return err

def _lab_run(parts_json):
    parts = json.loads(parts_json)
    ns = {"__name__": "__main__", "TooManySteps": TooManySteps, "_lab_error": _lab_error}
    user_error = None
    for p in parts:
        try:
            code = compile(p["code"], p["name"], "exec")
        except SyntaxError as e:
            return json.dumps({"ok": False, "error": _lab_error(e)})
        try:
            exec(code, ns)
        except BaseException as e:
            err = _lab_error(e)
            if p.get("user"):
                user_error = err
                continue
            err["internal"] = "".join(traceback.format_exception(e))[-2000:]
            return json.dumps({"ok": False, "error": err})
    try:
        return json.dumps({"ok": True, "result": ns.get("RESULT"), "userError": user_error}, default=repr)
    except BaseException as e:
        return json.dumps({"ok": False, "error": {"type": type(e).__name__, "message": str(e), "line": None}})
`;
  const WORKER_SRC = `
let py = null, lines = 0, cut = false;
const MAX_LINES = 400;
function out(text, stream) {
  if (cut) return;
  if (++lines > MAX_LINES) { cut = true; postMessage({ type: "out", stream: "info", text: "… more output not shown (over " + MAX_LINES + " lines)" }); return; }
  postMessage({ type: "out", stream, text });
}
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === "boot") {
    try { importScripts(m.url + "pyodide.js"); }
    catch (err) { postMessage({ type: "loaderror", reason: "download", message: String((err && err.message) || err) }); return; }
    try {
      py = await loadPyodide({ indexURL: m.url, stdout: (s) => out(s, "out"), stderr: (s) => out(s, "err") });
      py.runPython(m.runner);
      postMessage({ type: "ready", version: py.version });
    } catch (err) { postMessage({ type: "loaderror", reason: "init", message: String((err && err.message) || err) }); }
  } else if (m.type === "run") {
    lines = 0; cut = false;
    const t0 = performance.now();
    let json;
    try { const f = py.globals.get("_lab_run"); json = f(m.parts); f.destroy(); }
    catch (err) { json = JSON.stringify({ fatal: String((err && err.message) || err) }); }
    postMessage({ type: "done", id: m.id, json, ms: performance.now() - t0 });
  }
};`;
  const LOAD_MSG = {
    download: "Python could not be downloaded. The first run needs an internet connection (about 10 MB from cdn.jsdelivr.net). Check the connection, then press Run again.",
    timeout: "Python took more than two minutes to load. Check the internet connection, then press Run again.",
    worker: "This browser cannot start Python in the background (Web Workers are blocked). Try another browser.",
  };

  let shared = null;
  function python() { return shared || (shared = makePython()); }
  function makePython() {
    let worker = null, ready = null, seq = 0, pending = null, queue = Promise.resolve();
    const info = { version: PYODIDE_VERSION, url: PYODIDE_URL, state: "idle", loadMs: null, loads: 0 };
    function kill() { if (worker) worker.terminate(); worker = null; ready = null; info.state = "idle"; }
    function start() {
      if (ready) return ready;
      info.state = "loading";
      const t0 = performance.now();
      ready = new Promise((resolve, reject) => {
        let url = null;
        try { url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })); worker = new Worker(url); }
        catch (e) { kill(); reject(new Error("worker")); return; }
        const fail = (reason, detail) => { clearTimeout(guard); if (url) URL.revokeObjectURL(url); kill(); const err = new Error(reason); err.detail = detail; reject(err); };
        const guard = setTimeout(() => fail("timeout"), 120000);
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.type === "ready") { clearTimeout(guard); URL.revokeObjectURL(url); info.loadMs = Math.round(performance.now() - t0); info.loads++; info.state = "ready"; info.python = m.version; resolve(); }
          else if (m.type === "loaderror") fail(m.reason, m.message);
          else if (m.type === "out") { if (pending && pending.onOut) pending.onOut(m.text, m.stream); }
          else if (m.type === "done") { if (pending && pending.id === m.id) pending.finish(m); }
        };
        worker.onerror = (e) => { if (e.preventDefault) e.preventDefault(); if (info.state === "loading") fail("download", e.message); };
        worker.postMessage({ type: "boot", url: PYODIDE_URL, runner: RUNNER_PY });
      });
      ready.catch(() => {});
      return ready;
    }
    async function runNow(parts, { timeout = 10000, onOut = null, onStatus = null } = {}) {
      const say = (s) => onStatus && onStatus(s);
      if (info.state !== "ready") {
        const again = info.loads > 0, t0 = performance.now();
        const tick = () => { const s = Math.round((performance.now() - t0) / 1000); say(again ? `Restarting Python… ${s} s` : `Loading Python (about 10 MB, first run only)… ${s} s`); };
        tick();
        const iv = setInterval(tick, 500);
        try { await start(); }
        catch (e) { clearInterval(iv); say(""); return { ok: false, loadError: (LOAD_MSG[e.message] || "Python failed to start.") + (e.message === "init" && e.detail ? ` (${e.detail})` : "") }; }
        clearInterval(iv);
      }
      say("Running…");
      return new Promise((resolve) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending = null; kill(); say(""); resolve({ ok: false, timedOut: true, ms: timeout }); }, timeout);
        pending = {
          id, onOut,
          finish(m) {
            clearTimeout(timer); pending = null; say("");
            let r;
            try { r = JSON.parse(m.json); } catch (e) { r = { ok: false, fatal: "the result could not be read" }; }
            r.ms = m.ms;
            resolve(r);
          },
        };
        worker.postMessage({ type: "run", id, parts: JSON.stringify(parts) });
      });
    }
    /* runs are queued: one at a time on the one worker */
    function run(parts, opts) { const job = queue.then(() => runNow(parts, opts)); queue = job.catch(() => {}); return job; }
    return { run, load: start, info };
  }

  /* ---------- syntax highlighting ---------- */
  const KW = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
  const BI = new Set("print len range list dict set tuple str int float bool abs min max sum sorted enumerate zip reversed isinstance any all divmod deque type repr round map filter".split(" "));
  const TOKEN = /(#[^\n]*)|("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  function highlight(src) {
    let out = "", last = 0, prev = "", m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[0];
      let cls = "";
      if (m[1]) cls = /\bTODO\b/.test(t) ? "c t" : "c";
      else if (m[2] || m[3]) cls = "s";
      else if (m[4]) cls = "n";
      else cls = KW.has(t) ? "k" : prev === "def" || prev === "class" ? "f" : BI.has(t) ? "b" : "";
      prev = m[5] ? t : "";
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
      last = TOKEN.lastIndex;
    }
    return out + esc(src.slice(last));
  }
  const codeBlock = (src) => h("pre", { class: "lc-code", html: highlight(src) });

  /* ---------- editor ---------- */
  const LH = 21, PAD = 10, IND = "    ";
  function editor({ code = "", lines = 8, onRun = null, label = "Python code" } = {}) {
    injectCss();
    const helpId = "lc-help-" + ++uid;
    const gutter = h("div", { class: "lc-gut", "aria-hidden": "true" });
    const band = h("div", { class: "lc-hl" });
    const pre = h("pre", { class: "lc-pre", "aria-hidden": "true" });
    const ta = h("textarea", { class: "lc-ta", spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off", wrap: "off", "aria-label": label, "aria-describedby": helpId });
    ta.value = code;
    const help = h("span", { id: helpId, class: "lc-sr" }, "Python editor. Tab inserts 4 spaces; press Escape, then Tab, to leave the editor. Control+Enter or Command+Enter runs the code.");
    const el = h("div", { class: "lc-ed" }, gutter, h("div", { class: "lc-area" }, band, pre, ta), help);
    let errLine = null, escaped = false, shownLines = -1, shownErr = null;
    const listeners = [];
    function render() {
      const v = ta.value, n = v.split("\n").length;
      pre.innerHTML = highlight(v) + "\n";
      const rowsShown = Math.max(lines, n);
      if (rowsShown !== shownLines || errLine !== shownErr) {
        let html = "";
        for (let i = 1; i <= rowsShown; i++) html += i <= n ? `<div${i === errLine ? ' class="err"' : ""}>${i}</div>` : "<div></div>";
        gutter.innerHTML = html; shownLines = rowsShown; shownErr = errLine;
      }
      const sb = ta.offsetHeight - ta.clientHeight;   // a horizontal scrollbar, if any
      ta.style.height = rowsShown * LH + 2 * PAD + Math.max(0, sb) + "px";
      band.style.display = errLine && errLine <= n ? "block" : "none";
      if (errLine) band.style.top = PAD + (errLine - 1) * LH + "px";
      pre.scrollLeft = ta.scrollLeft;
    }
    function changed() { if (errLine) { errLine = null; } render(); for (const f of listeners) f(ta.value); }
    function insert(text) {
      ta.focus();
      let ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
      if (!ok) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end"); changed(); }
    }
    const lineStart = (v, i) => v.lastIndexOf("\n", i - 1) + 1;
    function shift(dir) {
      const v = ta.value, s = ta.selectionStart, t0 = ta.selectionEnd;
      const a = lineStart(v, s), t = t0 > s && v[t0 - 1] === "\n" ? t0 - 1 : t0;
      let b = v.indexOf("\n", t); if (b < 0) b = v.length;
      const old = v.slice(a, b).split("\n");
      const next = old.map((l) => (dir > 0 ? (l.trim() ? IND + l : l) : l.replace(/^ {1,4}/, "")));
      const block = next.join("\n");
      if (block === v.slice(a, b)) return;
      ta.setSelectionRange(a, b); insert(block);
      if (s === t0) { const d = next[0].length - old[0].length; const p = Math.max(a, s + d); ta.setSelectionRange(p, p); }
      else ta.setSelectionRange(a, a + block.length);
    }
    ta.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); if (onRun) onRun(); return; }
      if (e.key === "Escape") { escaped = true; return; }
      if (e.key === "Tab") {
        if (escaped || e.ctrlKey || e.metaKey || e.altKey) { escaped = false; return; }
        e.preventDefault();
        const v = ta.value, s = ta.selectionStart, t = ta.selectionEnd;
        if (e.shiftKey || v.slice(s, t).includes("\n")) shift(e.shiftKey ? -1 : 1);
        else { const col = s - lineStart(v, s); insert(" ".repeat(4 - (col % 4))); }
        return;
      }
      escaped = false;
      if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const v = ta.value, s = ta.selectionStart, before = v.slice(lineStart(v, s), s);
        let ind = /^ */.exec(before)[0].length;
        const codePart = before.replace(/#.*$/, "").trimEnd();
        if (codePart.endsWith(":")) ind += 4;
        else if (/^\s*(return|pass|break|continue|raise)\b/.test(before)) ind = Math.max(0, ind - 4);
        insert("\n" + " ".repeat(ind));
      } else if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const v = ta.value, s = ta.selectionStart;
        if (s !== ta.selectionEnd || !s) return;
        const before = v.slice(lineStart(v, s), s);
        if (before.length && /^ +$/.test(before)) {
          e.preventDefault();
          const n = before.length % 4 || 4;
          ta.setSelectionRange(s - n, s); insert("");
          if (ta.selectionStart !== s - n) { ta.setRangeText("", s - n, s, "end"); changed(); }
        }
      }
    });
    ta.addEventListener("input", changed);
    ta.addEventListener("scroll", () => { pre.scrollLeft = ta.scrollLeft; });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => render()).observe(ta);
    render();
    return {
      el,
      get: () => ta.value,
      set(v, undoable = true) {
        if (undoable) { ta.focus(); ta.select(); insert(v); if (ta.value !== v) { ta.value = v; changed(); } }
        else { ta.value = v; changed(); }
      },
      mark(line) { errLine = line || null; render(); },
      focus() { ta.focus(); },
      onChange(fn) { listeners.push(fn); },
      textarea: ta,
    };
  }

  /* ---------- output console ---------- */
  function output() {
    injectCss();
    const el = h("pre", { class: "lc-out", "aria-live": "polite" });
    return {
      el,
      clear() { el.textContent = ""; },
      print(text, kind = "out") {
        const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        el.append(kind === "out" ? document.createTextNode(text + "\n") : h("span", { class: kind }, text + "\n"));
        if (atEnd) el.scrollTop = el.scrollHeight;
      },
    };
  }

  /* ---------- errors, in words ---------- */
  function describe(err) {
    const where = err.line ? `Line ${err.line}: ` : "";
    if (err.type === "TooManySteps") return { head: `${where}Stopped. ${err.message}`, help: "" };
    const generic = {
      IndentationError: "Python groups lines by indentation: every line inside a block needs the same number of spaces, 4 more than the line ending in ':'.",
      TabError: "Mixing tabs and spaces: use spaces only (the Tab key inserts 4 spaces here).",
      SyntaxError: "Python cannot read this line: look for a missing ':', bracket or quote, here or on the line above.",
      NameError: "This name is not defined: is it misspelled, or used before it gets a value?",
      UnboundLocalError: "A variable is used before it gets a value in this function.",
      RecursionError: "The function keeps calling itself and never stops: check the base cases.",
      IndexError: "An index is outside the list or string. Python counts from 0 to len - 1.",
      KeyError: "This key is not in the dictionary.",
      AttributeError: "This object has no such method or attribute (for example, a list has no popleft(); a deque has).",
      ZeroDivisionError: "Division by zero.",
    }[err.type] || "";
    return { head: `${where}${err.type}: ${err.message}`, help: generic };
  }

  /* ---------- the exercise shell ---------- */
  function exercise(spec) {
    injectCss();
    const KEY = `cs220p:code:${spec.id}`, timeout = spec.timeout || 10000;
    const saved = store(KEY);
    const ed = editor({ code: saved !== null && saved !== undefined ? saved : spec.starter, lines: spec.lines || 10, onRun: () => run(), label: (spec.title || "Exercise") + ": Python code" });
    let saveT = 0;
    ed.onChange((v) => { clearTimeout(saveT); saveT = setTimeout(() => store(KEY, v === spec.starter ? null : v), 300); });
    let hintN = 0, running = false;
    const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "") ? "⌘" : "Ctrl";
    const runBtn = h("button", { onclick: () => run(), title: `Run (${mod}+Enter)` }, "Run ▶");
    const resetBtn = h("button", { class: "ghost", onclick: () => { ed.set(spec.starter); ed.mark(null); say(`Back to the starting code. ${mod}+Z brings your code back.`); } }, "Reset");
    const hints = spec.hints || [];
    const hintBtn = hints.length ? h("button", { class: "ghost", onclick: () => showHint() }, "Hint") : null;
    const status = h("div", { class: "lc-status", role: "status" });
    const hintBox = h("div", { class: "lc-box" }), tests = h("div", { class: "lc-tests", "aria-live": "polite" });
    const out = output();
    const outTitle = h("div", { class: "lc-out-title hidden" }, "Output");
    const el = h("div", { class: "lc-ex" },
      spec.title ? h("div", { class: "lc-head" }, h("b", {}, spec.title), spec.minutes ? h("span", { class: "badge" }, `about ${spec.minutes} min`) : null) : null,
      spec.intro ? h("div", { class: "lc-intro", html: spec.intro }) : null,
      ed.el,
      h("div", { class: "lc-bar" }, runBtn, resetBtn, hintBtn),
      status, hintBox, tests, outTitle, out.el, spec.after || null);
    function say(text, busy = false) { status.replaceChildren(); if (text) status.append(...(busy ? [h("span", { class: "spin" })] : []), h("span", {}, text)); }
    function showHint() {
      if (hintN < hints.length) hintN++;
      hintBox.replaceChildren(...hints.slice(0, hintN).map((x, i) => h("div", { class: "callout", html: `<b>Hint ${i + 1}${hints.length > 1 ? ` of ${hints.length}` : ""}.</b> ${x}` })));
      hintBtn.textContent = hintN < hints.length ? `Hint ${hintN + 1}` : "Hint";
      hintBtn.disabled = hintN >= hints.length;
    }
    function renderReport(report) {
      const n = report.tests.length, k = report.tests.filter((t) => t.ok).length;
      tests.replaceChildren(
        h("div", { class: "sum" }, report.passed ? `All ${n} tests pass.` : `${k} of ${n} tests pass.`),
        ...report.tests.map((t) => h("div", { class: "lc-test" + (t.ok ? " ok" : "") }, h("div", { class: "t" }, h("i", { "aria-hidden": "true" }, t.ok ? "✔" : "✘"), h("span", { class: "lc-sr" }, t.ok ? "Passed: " : "Failed: "), t.name), t.detail ? h("div", { class: "d", html: t.detail }) : null)),
        ...(report.summary ? [h("div", { class: report.passed ? "callout example" : "callout", html: report.summary })] : []));   // replaceChildren would print a null as text
    }
    function printError(err) {
      const d = describe(err), extra = spec.explain ? spec.explain(err) : "";
      out.print(d.head, "err");
      const help = extra || d.help;
      if (help) out.print(help.replace(/<[^>]+>/g, ""), "info");
      if (err.internal) out.print(err.internal, "info");
    }
    async function run() {
      if (running) return;
      running = true; runBtn.disabled = true; runBtn.textContent = "Running…";
      out.clear(); ed.mark(null);
      let passed = false;
      try {
        const res = await python().run(spec.parts(ed.get()), { timeout, onOut: (t, s) => { outTitle.classList.remove("hidden"); out.print(t, s === "err" ? "err" : s === "info" ? "info" : "out"); }, onStatus: (s) => say(s, !!s) });
        if (res.loadError) { say(""); status.append(h("div", { class: "callout edge" }, res.loadError)); }
        else if (res.timedOut) {
          tests.replaceChildren(h("div", { class: "callout edge", html: `<b>Stopped after ${timeout / 1000} seconds.</b> Your code did not finish: an endless loop? (A <code>while</code> loop whose condition never becomes false, for example.) Python restarts on the next run.` }));
          out.print(`Stopped: the code ran for more than ${timeout / 1000} seconds.`, "err");
        } else if (res.fatal) { out.print("Python stopped unexpectedly: " + res.fatal, "err"); tests.replaceChildren(); }
        else {
          const err = res.ok ? res.userError : res.error;
          if (err) { printError(err); if (err.line) ed.mark(err.line); }
          if (res.ok) {
            const report = spec.check(res.result, res);
            renderReport(report);
            passed = report.passed;
            if (spec.onReport) spec.onReport(report, res.result);
          } else tests.replaceChildren(h("div", { class: "callout edge", html: `<b>The tests did not run.</b> ${err && err.line ? `Fix line ${err.line}` : "Fix the error"} (see the output below), then run again.` }));
        }
      } finally {
        running = false; runBtn.disabled = false; runBtn.textContent = "Run ▶";
      }
      outTitle.classList.toggle("hidden", !out.el.textContent);
      return passed;
    }
    return { el, editor: ed, run };
  }

  /* ---------- Parsons problem: put the lines in order and indent them ---------- */
  function shuffle(a, seed) {
    let s = seed >>> 0 || 1;
    const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function parsons(o) {
    injectCss();
    const STEP = 28, MAXI = 5;
    const parse = (s) => ({ text: s.trim(), indent: Math.round(/^ */.exec(s)[0].length / 4) });
    const answers = [o.lines, ...(o.alternatives || [])].map((ls) => ls.map(parse));
    const items = [...o.lines, ...(o.distractors || [])].map((s, i) => ({ id: i, text: parse(s).text, indent: 0 }));
    shuffle(items, o.seed ?? 220);
    const byEl = new Map();
    const pool = h("div", { class: "lc-pz-col pool", role: "listbox", "aria-label": "Lines to use" });
    const ans = h("div", { class: "lc-pz-col ans", role: "listbox", "aria-label": "Your program" });
    const poolEmpty = h("div", { class: "lc-pz-empty" }, "All lines used.");
    const ansEmpty = h("div", { class: "lc-pz-empty" }, "Drag lines here (or click them). Drag sideways, or press ← →, to indent.");
    const fb = h("div", { "aria-live": "polite" });
    const hintBox = h("div", { class: "lc-box" });
    let hintN = 0, isSolved = false;
    const hints = o.hints || [];
    const checkBtn = h("button", { onclick: () => check() }, "Check");
    const resetBtn = h("button", { class: "ghost", onclick: () => reset() }, "Start over");
    const hintBtn = hints.length ? h("button", { class: "ghost", onclick: () => { hintN = Math.min(hints.length, hintN + 1); hintBox.replaceChildren(...hints.slice(0, hintN).map((x, i) => h("div", { class: "callout", html: `<b>Hint ${i + 1}.</b> ${x}` }))); hintBtn.disabled = hintN >= hints.length; } }, "Hint") : null;
    const el = h("div", { class: "lc-pz" },
      h("div", { class: "lc-pz-cols" }, h("div", {}, h("div", { class: "lc-pz-cap" }, "Lines"), pool), h("div", {}, h("div", { class: "lc-pz-cap" }, "Your program (indent with ← →)"), ans)),
      h("div", { class: "lc-bar" }, checkBtn, resetBtn, hintBtn),
      h("div", { class: "note" }, "Keyboard: Tab to a line; Enter moves it between the two lists; Alt+↑/↓ moves it up or down; ← → change its indentation."),
      fb, hintBox);
    function lineEl(it) {
      const d = h("div", { class: "lc-pz-line", tabindex: "0", role: "option" }, it.text);
      byEl.set(d, it);
      d.addEventListener("pointerdown", (e) => grab(e, d));
      d.addEventListener("keydown", (e) => key(e, d));
      return d;
    }
    function paint() {
      for (const [d, it] of byEl) {
        const inAns = d.parentNode === ans;
        if (!inAns) it.indent = 0;
        d.style.marginLeft = inAns ? it.indent * STEP + "px" : "0";
        d.setAttribute("aria-label", it.text + (inAns ? `, indent ${it.indent}` : ""));
      }
      const used = [...ans.children].some((c) => byEl.has(c)), left = [...pool.children].some((c) => byEl.has(c));
      if (used) ansEmpty.remove(); else if (!ansEmpty.parentNode) ans.append(ansEmpty);
      if (left) poolEmpty.remove(); else if (!poolEmpty.parentNode) pool.append(poolEmpty);
    }
    function changed() { for (const d of byEl.keys()) d.classList.remove("ok", "bad"); fb.replaceChildren(); isSolved = false; paint(); }
    function reset() { pool.replaceChildren(); ans.replaceChildren(); byEl.clear(); items.forEach((it) => { it.indent = 0; pool.append(lineEl(it)); }); changed(); }
    const lines = () => [...ans.children].filter((c) => byEl.has(c));
    function guessIndent(prev) { if (!prev) return 0; const p = byEl.get(prev); return Math.min(MAXI, p.indent + (/:\s*$/.test(p.text) ? 1 : 0)); }
    function toAnswer(d, before = null) { const ls = lines(), i = before ? ls.indexOf(before) : ls.length; byEl.get(d).indent = guessIndent(ls[i - 1]); ans.insertBefore(d, before); }
    function key(e, d) {
      const inAns = d.parentNode === ans, it = byEl.get(d);
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (inAns) pool.append(d); else toAnswer(d); changed(); d.focus(); }
      else if (inAns && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); it.indent = Math.max(0, Math.min(MAXI, it.indent + (e.key === "ArrowRight" ? 1 : -1))); changed(); }
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const sib = [...d.parentNode.children].filter((c) => byEl.has(c)), i = sib.indexOf(d), j = i + (e.key === "ArrowUp" ? -1 : 1);
        if (j < 0 || j >= sib.length) return;
        if (e.altKey) { d.parentNode.insertBefore(d, e.key === "ArrowUp" ? sib[j] : sib[j].nextSibling); changed(); d.focus(); }
        else sib[j].focus();
      } else if (inAns && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); pool.append(d); changed(); }
    }
    function grab(e, d) {
      if (e.button !== 0) return;
      const x0 = e.clientX, y0 = e.clientY, r0 = d.getBoundingClientRect(), offX = x0 - r0.left, offY = y0 - r0.top;
      let dragging = false, ph = null, target = null, indent = 0;
      d.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
          dragging = true;
          ph = h("div", { class: "lc-pz-ph" }); ph.style.height = r0.height + "px";
          d.parentNode.insertBefore(ph, d);
          Object.assign(d.style, { position: "fixed", width: r0.width + "px", left: r0.left + "px", top: r0.top + "px", pointerEvents: "none", margin: "0" });
          d.classList.add("drag");
        }
        d.style.left = ev.clientX - offX + "px"; d.style.top = ev.clientY - offY + "px";
        const ra = ans.getBoundingClientRect(), rp = pool.getBoundingClientRect();
        const da = ev.clientX < ra.left ? ra.left - ev.clientX : ev.clientX > ra.right ? ev.clientX - ra.right : 0;
        const dp = ev.clientX < rp.left ? rp.left - ev.clientX : ev.clientX > rp.right ? ev.clientX - rp.right : 0;
        const vert = (r) => (ev.clientY < r.top ? r.top - ev.clientY : ev.clientY > r.bottom ? ev.clientY - r.bottom : 0);
        target = da + vert(ra) <= dp + vert(rp) ? ans : pool;
        ans.classList.toggle("hot", target === ans); pool.classList.toggle("hot", target === pool);
        const sib = [...target.children].filter((c) => byEl.has(c) && c !== d);
        const before = sib.find((c) => { const b = c.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
        target.insertBefore(ph, before);
        if (target === ans) {
          const prev = sib[before ? sib.indexOf(before) - 1 : sib.length - 1];
          const cap = prev ? Math.min(MAXI, byEl.get(prev).indent + 1) : 0;
          indent = Math.max(0, Math.min(cap, Math.round((ev.clientX - offX - ra.left - 8) / STEP)));
          ph.style.marginLeft = indent * STEP + "px";
        } else { indent = 0; ph.style.marginLeft = "0"; }
      };
      const up = () => {
        d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); d.removeEventListener("pointercancel", up);
        ans.classList.remove("hot"); pool.classList.remove("hot");
        if (!dragging) { if (d.parentNode === pool) toAnswer(d); changed(); return; }
        d.classList.remove("drag");
        Object.assign(d.style, { position: "", width: "", left: "", top: "", pointerEvents: "", margin: "" });
        ph.replaceWith(d);
        byEl.get(d).indent = target === ans ? indent : 0;
        changed();
      };
      d.addEventListener("pointermove", move); d.addEventListener("pointerup", up); d.addEventListener("pointercancel", up);
    }
    function check() {
      const got = lines().map((d) => byEl.get(d));
      let best = null;
      for (const sol of answers) {
        let k = 0;
        while (k < got.length && k < sol.length && got[k].text === sol[k].text && got[k].indent === sol[k].indent) k++;
        if (!best || k > best.k) best = { k, sol };
      }
      const { k, sol } = best, ds = lines();
      ds.forEach((d, i) => { d.classList.toggle("ok", i < k); d.classList.toggle("bad", i === k); });
      isSolved = k === sol.length && got.length === sol.length;
      let msg;
      if (isSolved) msg = h("div", { class: "callout example", html: "<b>Correct.</b> Every line in place, every line indented right." });
      else {
        if (k < got.length) {
          const g = got[k], right = sol[k] && sol[k].text === g.text;
          const distractor = !answers.some((s) => s.some((x) => x.text === g.text));
          msg = h("div", { class: "callout edge", html: `The first ${k} line${k === 1 ? " is" : "s are"} right. <b>Line ${k + 1}</b> ${right ? "is the right line, but its indentation is wrong." : distractor ? "does not belong in this program." : "is not the line that comes next."}` });
        } else msg = h("div", { class: "callout", html: `So far so good: ${k} of ${sol.length} lines. Add the next line.` });
      }
      fb.replaceChildren(msg);
      if (isSolved && o.onSolved) o.onSolved(code());
      return isSolved;
    }
    const code = () => lines().map((d) => { const it = byEl.get(d); return IND.repeat(it.indent) + it.text; }).join("\n");
    reset();
    return { el, code, solved: () => isSolved, check };
  }

  window.LabCode = { python, editor, output, exercise, parsons, highlight, codeBlock, describe, PYODIDE_VERSION, PYODIDE_URL, USER_FILE };
})();
