/* CS220P lab framework (no dependencies) */
(function () {
  "use strict";
  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  };

  /* seeded RNG (mulberry32) */
  function RNG(seed) {
    let a = (seed >>> 0) || 1;
    const f = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.int = (n) => Math.floor(f() * n);
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.normal = (mu = 0, sd = 1) => { const u = 1 - f(), v = f(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    f.shuffle = (arr) => { const b = arr.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    return f;
  }

  const fmt = (x, d = 1) => (typeof x === "number" ? (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d }) : x);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  const median = (a) => { const b = a.slice().sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : NaN; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  /* tween(ms, fn): calls fn(t) with eased t from 0 to 1 on every animation frame; resolves when done */
  function tween(ms, fn) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const frame = (now) => { const t = clamp((now - t0) / ms, 0, 1); fn(ease(t)); if (t < 1) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
  }
  function pulse(el) { if (!el) return; el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse"); }

  /* controls. Every control has get(), set(v) (silent), apply(v) (set and fire onchange); range also animateTo(v, ms) (glides, firing onchange on the way) */
  function range(opts) {
    const { label, min, max, step = 1, value, onchange, fmt: f = (v) => v } = opts;
    const val = h("span", { class: "val" }, f(value));
    const inp = h("input", { type: "range", min, max, step, value });
    inp.addEventListener("input", () => { val.textContent = f(+inp.value); onchange(+inp.value); });
    const el = h("div", { class: "ctl" }, h("label", {}, h("span", {}, label), val), inp);
    const snap = (v) => { const s = +step || 1; return clamp(Math.round((v - min) / s) * s + +min, +min, +max); };
    el.get = () => +inp.value; el.set = (v) => { inp.value = v; val.textContent = f(+inp.value); };
    el.apply = (v) => { el.set(snap(v)); onchange(+inp.value); };
    el.animateTo = async (v, ms = 900) => {
      const from = +inp.value, to = snap(v); el.classList.add("moving"); let last = null;
      await tween(ms, (t) => { const x = snap(from + (to - from) * t); if (x !== last) { last = x; el.set(x); onchange(x); } });
      el.classList.remove("moving"); return to;
    };
    return el;
  }
  function select(opts) {
    const { label, options, value, onchange } = opts;
    const sel = h("select", {}, ...options.map((o) => h("option", { value: o.value ?? o, selected: (o.value ?? o) == value ? "" : null }, o.label ?? o)));
    sel.addEventListener("change", () => onchange(sel.value));
    const el = h("div", { class: "ctl" }, h("label", {}, h("span", {}, label)), sel);
    el.get = () => sel.value; el.set = (v) => { sel.value = v; };
    el.apply = (v) => { el.set(v); pulse(el); onchange(sel.value); };
    return el;
  }
  function check(opts) {
    const { label, value, onchange } = opts;
    const inp = h("input", { type: "checkbox" }); inp.checked = !!value;
    inp.addEventListener("change", () => onchange(inp.checked));
    const el = h("div", { class: "ctl" }, h("label", { style: "justify-content:flex-start;gap:.5rem" }, inp, h("span", {}, label)));
    el.get = () => inp.checked; el.set = (v) => { inp.checked = !!v; };
    el.apply = (v) => { el.set(v); pulse(el); onchange(inp.checked); };
    return el;
  }
  /* callout(html, kind): a highlighted explanation box. kind: "example" | "edge" | "info" */
  function callout(html, kind = "info") { return h("div", { class: "callout " + kind, html }); }
  /* examples(items): a row of "show me" buttons. item: {label, kind: "example"|"edge", note: html shown while it runs, run: async () => {}}.
     Clicking runs the item (usually animating controls), shows its note, and blocks the other buttons until it finishes. */
  function examples(items, title = "Try it") {
    const note = h("div", { class: "ex-note" });
    const btns = items.map((it) => h("button", { class: "ex " + (it.kind || "example"), onclick: async () => {
      btns.forEach((b) => (b.disabled = true)); btns.forEach((b) => b.classList.remove("on")); btn(it).classList.add("on");
      note.innerHTML = ""; note.append(callout((it.kind === "edge" ? "<b>Edge case.</b> " : "<b>Watch.</b> ") + (it.note || ""), it.kind || "example"));
      try { await it.run(); } finally { btns.forEach((b) => (b.disabled = false)); }
    } }, (it.kind === "edge" ? "⚠ " : "▶ ") + it.label));
    const btn = (it) => btns[items.indexOf(it)];
    return h("div", { class: "examples" }, h("div", { class: "ex-title" }, title), h("div", { class: "ex-row" }, ...btns), note);
  }
  function metric(k, v, cls = "") { return h("div", { class: "metric " + cls }, h("div", { class: "k" }, k), h("div", { class: "v" }, v)); }
  function canvas(w, hgt) { const c = h("canvas", { width: w, height: hgt }); c.style.aspectRatio = `${w}/${hgt}`; return c; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* quiz: cards with dropdowns. items: [{q, options, answer (string or list of accepted strings), why, key?}].
     Default: instant feedback (a wrong choice shows the correct answer and the reason); "Show all answers" fills in every card
     (omit it with { reveal: false }).
     With { submit: {lab, id} }: name and team on top, no feedback until the student presses Submit; then every card shows its
     verdict and the score, the quiz locks, and the answers go once to /api/answers (exercise id; key or "Q1".. per card).
     The state survives a reload. The time taken (first answer → submit) is sent as answers._seconds and answers._started.
     onChange({answered, correct, submitted}) reports progress (correct counts only after submitting). */
  function quiz(items, { reveal: withReveal = true, submit = null, onChange = null } = {}) {
    const wrap = h("div", { class: "quiz" });
    const score = h("div", { class: "note" });
    const accepted = (it) => (Array.isArray(it.answer) ? it.answer : [it.answer]);
    const isOk = (it, v) => accepted(it).includes(v);
    const sels = [], fbs = [], cards = [];
    const skey = submit && `cs220p:${submit.lab}:quiz:${submit.id}`;
    const st = (skey && store(skey)) || { values: [], submitted: null };   // startedAt: first answer (time taken = submit − startedAt)
    const took = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s` : `${s} s`);
    const live = () => !submit || !!st.submitted;   // feedback is shown
    const counts = () => ({ answered: sels.filter((s) => s.value).length, correct: sels.filter((s, i) => s.value && isOk(items[i], s.value)).length, submitted: !!st.submitted });
    function feedback(i) {
      const it = items[i], v = sels[i].value, card = cards[i];
      card.classList.remove("ok", "wrong");
      if (!v || !live()) { fbs[i].innerHTML = ""; return; }
      const ok = isOk(it, v); card.classList.add(ok ? "ok" : "wrong");
      const right = accepted(it).map((a) => `<b>${esc(a)}</b>`).join(" or ");
      fbs[i].innerHTML = (ok ? "✅ Correct" + (accepted(it).length > 1 ? ` (${right} both accepted)` : "") + ". " : `❌ The answer is ${right}. `) + (it.why || "");
    }
    function rescore() {
      const { answered, correct } = counts(), n = items.length;
      if (submit && st.submitted) score.innerHTML = `<b>Your score: ${correct} of ${n}</b> · submitted as ${esc(st.submitted.name)} (team ${esc(st.submitted.team)})` + (st.submitted.seconds != null ? ` · took ${took(st.submitted.seconds)}` : "");
      else if (submit) score.textContent = `${answered} of ${n} answered` + (answered < n ? "" : ": ready to submit");
      else score.textContent = answered ? `Score ${correct}/${n}` + (answered < n ? ` (${n - answered} not answered yet)` : "") : "";
      if (onChange) onChange(counts());
    }
    items.forEach((it, i) => {
      const fb = h("div", { class: "fb" });
      const sel = h("select", {}, h("option", { value: "" }, "choose"), ...it.options.map((o) => h("option", { value: o }, o)));
      if (st.values[i]) sel.value = st.values[i];
      sel.addEventListener("change", () => { if (skey) { st.values = sels.map((s) => s.value); st.startedAt ??= Date.now(); store(skey, st); } feedback(i); rescore(); });
      const card = h("div", { class: "card" }, h("div", { class: "q" }, it.q), sel, fb);
      sels.push(sel); fbs.push(fb); cards.push(card); wrap.append(card);
    });
    const reveal = h("button", { class: "ghost", onclick: async () => {
      for (let i = 0; i < items.length; i++) { if (!sels[i].value) { sels[i].value = accepted(items[i])[0]; feedback(i); pulse(cards[i]); await sleep(60); } else feedback(i); }
      rescore();
    } }, "Show all answers");
    const clear = h("button", { class: "ghost", onclick: () => { sels.forEach((s, i) => { s.value = ""; feedback(i); }); if (skey) { st.values = []; store(skey, st); } rescore(); } }, "Clear");
    if (!submit) { queueMicrotask(rescore); return h("div", {}, wrap, h("div", { class: "btns", style: "margin-top:.6rem;align-items:center" }, withReveal ? reveal : null, clear, score)); }

    /* submit mode */
    const player = store("cs220p:player") || {};
    const name = h("input", { type: "text", placeholder: "your name", maxlength: 24, value: player.name || "" });
    const team = h("input", { type: "text", placeholder: "team", maxlength: 12, value: player.team || "", style: "text-transform:uppercase;width:6rem" });
    const msg = h("div");
    const send = h("button", { onclick: () => doSubmit() }, "Submit my answers");
    function lock() { sels.forEach((s) => (s.disabled = true)); [name, team].forEach((x) => (x.disabled = true)); send.classList.add("hidden"); clear.classList.add("hidden"); sels.forEach((_, i) => feedback(i)); rescore(); }
    async function doSubmit() {
      const nm = name.value.trim(), tm = team.value.trim().toUpperCase(), { answered, correct } = counts(), n = items.length;
      if (!nm || !tm) { msg.innerHTML = ""; msg.append(callout("Write your name and your team at the top first.", "edge")); name.focus(); return; }
      if (!confirm(answered < n ? `${n - answered} cards are still empty. Submit anyway? You can submit only once.` : "Submit your answers? You can submit only once.")) return;
      store("cs220p:player", { name: nm, team: tm });
      const seconds = Math.max(0, Math.round((Date.now() - (st.startedAt || Date.now())) / 1000));
      const answers = { ...Object.fromEntries(items.map((it, i) => [it.key || `Q${i + 1}`, sels[i].value || "no answer"])), _seconds: seconds, _started: st.startedAt ? new Date(st.startedAt).toISOString() : null };
      send.disabled = true; send.textContent = "Sending…"; msg.innerHTML = "";
      try {
        const res = await fetch(`${API}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lab: submit.lab, exercise: submit.id, name: nm, team: tm, device: deviceId(), score: correct, max: n, answers }) });
        const body = await res.json().catch(() => ({ error: `Server error ${res.status}.` }));
        if (!res.ok && !body.prior) { msg.append(callout(esc(body.error || `Server error ${res.status}.`), "edge")); return; }
        st.submitted = body.prior ? { name: body.prior.name, team: body.prior.team } : { name: nm, team: tm, seconds };
        store(skey, st); lock();
        if (body.prior) msg.append(callout("This device had already submitted these answers.", "edge"));
      } catch (e) {
        msg.append(callout("Could not reach the server. Check the connection and press Submit again; your answers are kept.", "edge"));
      } finally { send.disabled = false; send.textContent = "Submit my answers"; }
    }
    if (st.submitted) queueMicrotask(lock); else queueMicrotask(rescore);
    return h("div", {},
      h("div", { class: "btns", style: "margin:.2rem 0 .6rem;align-items:center" }, h("b", {}, "Your name"), name, team),
      wrap,
      h("div", { class: "btns", style: "margin-top:.6rem;align-items:center" }, send, clear, score), msg);
  }

  /* mission({goal, how: [html...], targets: [{text, test(state) -> bool}]}): what to achieve in this step and how.
     el.update(state) re-checks every target and ticks the ones reached (they stay ticked). */
  function mission({ goal, how = [], targets = [] }) {
    const done = targets.map(() => false);
    const items = targets.map((t) => h("li", {}, t.text));
    const progress = h("span", { class: "progress" });
    const setProgress = () => { const n = done.filter(Boolean).length; progress.textContent = targets.length ? `${n} of ${targets.length} reached` : ""; progress.classList.toggle("all", n === targets.length); };
    const el = h("div", { class: "mission" },
      h("div", { class: "m-head" }, h("h3", {}, "Mission"), progress),
      h("p", { class: "goal", html: goal }),
      how.length ? h("details", { class: "how", open: "" }, h("summary", {}, "How to get there"), h("ol", {}, ...how.map((x) => h("li", { html: x })))) : null,
      targets.length ? h("ul", { class: "targets" }, ...items) : null);
    el.update = (state) => {
      targets.forEach((t, i) => { let ok = false; try { ok = !!t.test(state); } catch (e) { ok = false; } if (ok && !done[i]) { done[i] = true; items[i].classList.add("done"); pulse(items[i]); } });
      setProgress();
    };
    el.reset = () => { done.fill(false); items.forEach((li) => li.classList.remove("done")); setProgress(); };
    setProgress();
    return el;
  }

  /* checkpoint({lab, id, title, minutes, onStart(), onLock(), collect() -> {score, max, answers, summary}}): a timed class activity.
     A sticky bar with name, team and a countdown. Start calls onStart() (enable the activity); when the time is up, or the student presses
     "Submit", onLock() is called (freeze the activity) and collect() is sent to /api/answers once per device. Class results are live at
     activity.html#<lab>/<id>. Returns {el, finish(), started(), locked()}; call finish() when the student completes the activity early. */
  function checkpoint(c) {
    const key = `cs220p:${c.lab}:cp:${c.id}`, total = c.minutes * 60000;
    const st = store(key) || {};
    const save = () => store(key, st);
    const mmss = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
    const left = () => (st.startedAt ? Math.max(0, st.startedAt + total - Date.now()) : total);
    const saved = store("cs220p:player") || {};
    const name = h("input", { type: "text", placeholder: "your name", maxlength: 24, value: saved.name || "" });
    const team = h("input", { type: "text", placeholder: "team", maxlength: 12, value: saved.team || "", style: "text-transform:uppercase;width:6rem" });
    const timeEl = h("span", { class: "cp-time" }, mmss(total));
    const startBtn = h("button", { onclick: () => start() }, `Start (${c.minutes} min)`);
    const submitBtn = h("button", { onclick: () => submit() }, "Submit my answers");
    const msg = h("div", { class: "cp-msg" });
    const results = h("a", { href: `activity.html#${c.lab}/${c.id}`, target: "_blank" }, "Class results ↗");
    const el = h("div", { class: "checkpoint" }, h("div", { class: "cp-row" }, h("b", {}, "⏱ " + (c.title || "Class activity")), timeEl, name, team, startBtn, submitBtn, results), msg);
    let timer = null, err = null;   // err: the last submit failure, shown until the next attempt
    function render() {
      startBtn.classList.toggle("hidden", !!st.startedAt);
      submitBtn.classList.toggle("hidden", !st.startedAt || !!st.submitted);
      submitBtn.textContent = st.locked ? "Submit my answers" : "I'm done: submit now";
      timeEl.textContent = st.submitted ? "submitted" : mmss(left());
      el.classList.toggle("running", !!st.startedAt && !st.locked);
      el.classList.toggle("urgent", !!st.startedAt && !st.locked && left() < 60000);
      if (st.submitted) { msg.innerHTML = ""; msg.append(callout(`Submitted as <b>${esc(st.submitted.name)}</b> (team ${esc(st.submitted.team)}): <b>${fmt(st.submitted.score, 1)} of ${fmt(st.submitted.max, 1)}</b>. ${st.submitted.summary || ""}`, "example")); }
      else if (st.locked && err) { msg.innerHTML = ""; msg.append(callout(err, "edge")); }
      else if (st.locked) { msg.innerHTML = ""; msg.append(callout("Time is up: the activity is frozen. Enter your name and team, then press <b>Submit my answers</b>.", "edge")); }
      else if (!st.startedAt) msg.innerHTML = "";
    }
    function tick() { render(); if (st.startedAt && !st.locked && left() === 0) lock(); }
    function start() {
      if (st.startedAt) return;
      st.startedAt = Date.now(); save();
      if (c.onStart) c.onStart();
      clearInterval(timer); timer = setInterval(tick, 250); render();
    }
    function lock() { if (st.locked) return; st.locked = true; save(); clearInterval(timer); if (c.onLock) c.onLock(); render(); }
    async function submit() {
      err = null;
      const nm = name.value.trim(), tm = team.value.trim().toUpperCase();
      if (!nm || !tm) { alert("Enter your name and your team first."); return; }
      if (!st.locked && !confirm("Submit now? The activity freezes and you cannot change your answers.")) return;
      lock();
      const r = c.collect();
      store("cs220p:player", { name: nm, team: tm });
      submitBtn.disabled = true; submitBtn.textContent = "Sending…";
      try {
        const res = await fetch(`${API}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lab: c.lab, exercise: c.id, name: nm, team: tm, device: deviceId(), score: r.score, max: r.max, answers: r.answers }) });
        const body = await res.json().catch(() => ({ error: `Server error ${res.status}.` }));
        if (!res.ok && !body.prior) { err = esc(body.error || `Server error ${res.status}.`); return; }
        st.submitted = body.prior ? { ...body.prior, summary: "This device had already submitted." } : { name: nm, team: tm, score: r.score, max: r.max, summary: r.summary || "" };
        save(); render();
      } catch (e) {
        err = "Could not reach the server. Check the connection and press Submit again; your answers are kept.";
      } finally { submitBtn.disabled = false; render(); }
    }
    /* resume after a reload: a running activity keeps its clock; a frozen one stays frozen */
    if (st.startedAt && !st.locked) { if (left() === 0) { st.locked = true; save(); } else { timer = setInterval(tick, 250); queueMicrotask(() => c.onStart && c.onStart()); } }
    if (st.locked) queueMicrotask(() => c.onLock && c.onLock());
    render();
    return { el, finish: () => lock(), started: () => !!st.startedAt, locked: () => !!st.locked };
  }

  /* Tournament.
     Each lab declares its spec once at top level: const TOUR = Lab.tournamentSpec({labId, intro, howTo?, params, practiceSeeds, run, unit?, grade?, compare?, precompute?}).
     params: [{key, label, type: "select", options, string?, default, cards?} | {key, label, min, max, step, default, fmt?}], each optionally with
       help (a line under the control) and showIf(params) -> bool (hide controls that do not apply). With cards: true a select is shown as
       clickable cards; its options may carry desc.
     run(params, seeds) -> {points, details: [{k, v, cls?}], summary?, bars?: [{label, value, mark?}]}; bars draw a per-case chart (e.g. per day).
     howTo: [html...] numbered steps above the controls. compare: detail keys (k) shown as columns of the practice-run table.
     Practice runs happen here on practiceSeeds. The official run is scored by the server (/api/submit) on hidden seeds that never reach the browser,
     or, with sameCases: true, on the same cases as practice (the server still recomputes the score; nothing is hidden). */
  function tournamentSpec(spec) { return spec; }
  const API = "/api";
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };
  function deviceId() { let id = store("cs220p:device"); if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); store("cs220p:device", id); } return id; }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  /* bar chart of signed values, e.g. money left per day; values below zero grow to the left of the axis */
  function barChart(bars, unit = "") {
    const max = Math.max(1e-9, ...bars.map((b) => Math.abs(b.value))), neg = bars.some((b) => b.value < 0), pos = bars.some((b) => b.value > 0);
    const zero = neg && pos ? 50 : neg ? 100 : 0;   // where the axis sits, in % of the track
    const rows = bars.map((b) => {
      const w = (Math.abs(b.value) / max) * (neg && pos ? 50 : 100);
      const fill = h("i", { class: b.value < 0 ? "neg" : "pos", style: `left:${b.value < 0 ? zero - w : zero}%;width:0%` });
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = w + "%")));
      return h("div", { class: "bar-row" + (b.mark ? " marked" : "") }, h("span", { class: "bl" }, b.label), h("span", { class: "track" }, h("i", { class: "axis", style: `left:${zero}%` }), fill), h("span", { class: "bv" }, (b.value > 0 ? "+" : "") + fmt(b.value, 0) + (unit ? " " + unit : "")));
    });
    return h("div", { class: "barchart" }, ...rows);
  }
  function tournament(spec) {
    const lockKey = `cs220p:${spec.labId}:official`, unit = spec.unit || "points";
    const params = {}, ctls = {}, wraps = {};
    const valueOf = (p, v) => (p.type === "select" ? (isNaN(+v) || p.string ? v : +v) : v);
    const label = (p, v) => { if (p.type === "select") { const o = p.options.find((x) => String(x.value ?? x) === String(v)); return o ? o.label ?? o : v; } return p.fmt ? p.fmt(v) : v; };
    const visible = (p) => !p.showIf || p.showIf(params);
    function refreshVisible() { spec.params.forEach((p) => wraps[p.key].classList.toggle("hidden", !visible(p))); }
    function setParam(p, v) { params[p.key] = valueOf(p, v); refreshVisible(); if (tries.length) renderCompare(); }
    const ctlEls = spec.params.map((p) => {
      params[p.key] = p.default;
      let el;
      if (p.type === "select" && p.cards) {
        const cards = p.options.map((o) => h("button", { type: "button", class: "agent-card", "data-v": o.value, onclick: () => { cards.forEach((c) => c.classList.toggle("on", c === cardFor(o.value))); setParam(p, o.value); } }, h("b", {}, o.label), o.desc ? h("span", {}, o.desc) : null));
        const cardFor = (v) => cards.find((c) => c.dataset.v === String(v));
        cardFor(p.default).classList.add("on");
        el = h("div", { class: "ctl" }, h("label", {}, h("span", {}, p.label)), h("div", { class: "agent-cards" }, ...cards));
        el.set = (v) => cards.forEach((c) => c.classList.toggle("on", c.dataset.v === String(v)));
      } else if (p.type === "select") el = select({ label: p.label, options: p.options, value: p.default, onchange: (v) => setParam(p, v) });
      else el = range({ label: p.label, min: p.min, max: p.max, step: p.step, value: p.default, fmt: p.fmt || ((v) => v), onchange: (v) => setParam(p, v) });
      ctls[p.key] = el;
      wraps[p.key] = h("div", { class: "tparam" }, el, p.help ? h("div", { class: "note", style: "margin:-.2rem 0 .5rem" }, p.help) : null);
      return wraps[p.key];
    });
    refreshVisible();
    const summary = (ps) => spec.params.filter((p) => !p.showIf || p.showIf(ps)).map((p) => `${p.label.replace(/ \(.*\)$/, "")}: ${label(p, ps[p.key])}`).join(" · ");
    const saved = store("cs220p:player") || {};
    const name = h("input", { type: "text", placeholder: "your name", maxlength: 24, value: saved.name || "" });
    const team = h("input", { type: "text", placeholder: "team or table, e.g. A1", maxlength: 12, value: saved.team || "", style: "text-transform:uppercase" });
    const out = h("div"), status = h("div"), compareBox = h("div");
    const practiceBtn = h("button", { class: "ghost" }, "Practice run (unlimited)");
    const officialBtn = h("button", {}, "Official run (once)");
    const tries = [];
    const gradeOf = (v) => (spec.grade ? spec.grade(v) : v >= 700 ? "good" : v < 350 ? "bad" : "");
    function render(res, mode) {
      out.innerHTML = "";
      const pts = h("div", { class: "v" }, "0");
      out.append(h("div", { class: "metrics" }, h("div", { class: "metric big " + gradeOf(res.points) }, h("div", { class: "k" }, (mode === "official" ? "Official: " : "Practice: ") + unit), pts), ...res.details.map((d) => metric(d.k, d.v, d.cls || ""))));
      tween(700, (t) => (pts.textContent = fmt(res.points * t, 0)));
      if (res.bars && res.bars.length) out.append(h("h4", { style: "margin:.8rem 0 .3rem" }, spec.barsTitle || "Per case"), barChart(res.bars, spec.barsUnit || ""));
      if (res.summary) out.append(h("div", { class: "note", html: res.summary }));
      out.append(h("div", { class: "note" }, mode === "official"
        ? (spec.sameCases ? "Scored by the server on the same cases as practice." : "Scored by the server on the hidden tournament data.")
        : (spec.sameCases ? "Practice run on the same cases the official run scores." : "Practice data. The official run uses different hidden data, so tune for robustness, not for one case.")));
    }
    function renderCompare() {
      compareBox.innerHTML = "";
      if (!tries.length) return;
      const best = tries.reduce((a, b) => (b.points > a.points ? b : a));
      const cur = JSON.stringify(params);
      const keys = spec.compare || [];
      const t = h("table", { class: "compare" }, h("tr", {}, h("th", {}, "#"), h("th", {}, "Settings"), h("th", {}, unit), ...keys.map((k) => h("th", {}, k)), h("th", {})));
      tries.slice().reverse().forEach((r) => {
        const det = Object.fromEntries(r.details.map((d) => [d.k, d.v]));
        const use = h("button", { class: "ghost", onclick: () => { spec.params.forEach((p) => { ctls[p.key].set(r.params[p.key]); params[p.key] = r.params[p.key]; }); refreshVisible(); renderCompare(); pulse(compareBox); } }, JSON.stringify(r.params) === cur ? "current" : "Use");
        if (JSON.stringify(r.params) === cur) use.disabled = true;
        t.append(h("tr", { class: r === best ? "best" : "" }, h("td", {}, r.n), h("td", { class: "note" }, summary(r.params)), h("td", { class: "pts " + gradeOf(r.points) }, fmt(r.points, 0)), ...keys.map((k) => h("td", {}, det[k] ?? "")), h("td", {}, use)));
      });
      compareBox.append(h("h4", { style: "margin:1rem 0 .3rem" }, "Compare your practice runs"), h("p", { class: "note", style: "margin:0 0 .3rem" }, `Best so far is highlighted. Press Use to put a run's settings back on the controls; the official run submits whatever the controls show.`), h("div", { class: "wide" }, t));
    }
    function refreshLock() {
      const lock = store(lockKey);
      officialBtn.disabled = !!lock;
      status.innerHTML = "";
      if (lock) status.append(callout(`Official run done by <b>${esc(lock.name)}</b> (team ${esc(lock.team)}): <b>${fmt(lock.points, 0)} ${esc(unit)}</b>${lock.rank ? `, rank ${lock.rank} of ${lock.total} when submitted` : ""}. <a href="leaderboard.html#${spec.labId}" target="_blank">Open the leaderboard</a>`, "example"));
    }
    practiceBtn.addEventListener("click", () => {
      const res = spec.run({ ...params }, spec.practiceSeeds); render(res, "practice");
      tries.push({ n: tries.length + 1, params: { ...params }, points: res.points, details: res.details });
      renderCompare();
    });
    officialBtn.addEventListener("click", async () => {
      const nm = name.value.trim(), tm = team.value.trim().toUpperCase();
      if (!nm || !tm) { alert("Enter your name and your team first."); return; }
      if (!confirm(`One official run per person.\n\nSubmit as ${nm} (team ${tm}) with:\n${summary(params)}?`)) return;
      store("cs220p:player", { name: nm, team: tm });
      officialBtn.disabled = true; officialBtn.textContent = "Scoring on the server…";
      try {
        const r = await fetch(`${API}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lab: spec.labId, name: nm, team: tm, device: deviceId(), params }) });
        const body = await r.json().catch(() => ({ error: `Server error ${r.status}.` }));
        if (!r.ok) {
          if (body.lock) { store(lockKey, body.lock); refreshLock(); } else officialBtn.disabled = false;
          status.innerHTML = ""; status.append(callout(esc(body.error || `Server error ${r.status}.`), "edge")); return;
        }
        render(body, "official");
        store(lockKey, { name: nm, team: tm, points: body.points, rank: body.rank, total: body.total }); refreshLock();
      } catch (e) {
        officialBtn.disabled = false; status.innerHTML = ""; status.append(callout("Could not reach the tournament server. Check the connection and try again; nothing was submitted.", "edge"));
      } finally { officialBtn.textContent = "Official run (once)"; }
    });
    refreshLock();
    const howTo = spec.howTo ? h("div", { class: "mission" }, h("div", { class: "m-head" }, h("h3", {}, "How to play")), h("ol", { style: "margin:.4rem 0 0;padding-left:1.3rem" }, ...spec.howTo.map((x) => h("li", { html: x, style: "margin:.25rem 0" })))) : null;
    return h("div", {},
      h("div", { class: "theory", html: spec.intro }),
      howTo,
      h("div", { class: "lab" },
        h("div", { class: "controls" }, h("div", { class: "ctl" }, h("label", {}, h("span", {}, "Name")), name), h("div", { class: "ctl" }, h("label", {}, h("span", {}, "Team")), team), ...ctlEls, h("div", { class: "btns" }, practiceBtn, officialBtn)),
        h("div", { class: "stage" }, h("h3", { style: "margin-top:0" }, "Result"), out, status, compareBox, h("p", { class: "note" }, h("a", { href: `leaderboard.html#${spec.labId}`, target: "_blank" }, "Live leaderboard ↗")))));
  }

  /* app shell: one version for everyone. Each step shows its theory, the task and the interactive part.
     cfg.welcome (optional): {kicker, title, lead (html), facts: [text...], scene(canvas) -> stop()} shows a welcome screen before step 1
     with a full-width animated scene. The canvas is sized to its box at device resolution; scene() draws every frame from
     canvas.width/height and returns a function that stops its animation (called when the student leaves the welcome screen). */
  function init(cfg) {
    document.title = cfg.title;
    const app = h("div", { class: "app" });
    const list = h("ul", { class: "steps" });
    const main = h("div", { class: "main" });
    const dark = h("input", { type: "checkbox" });
    dark.checked = matchMedia("(prefers-color-scheme: dark)").matches;
    dark.addEventListener("change", () => document.documentElement.setAttribute("data-theme", dark.checked ? "dark" : "light"));
    const rail = h("aside", { class: "rail" }, h("div", { class: "brand" }, h("a", { href: "index.html", style: "color:inherit;text-decoration:none" }, "CS220P Data Analytics")), h("h1", {}, cfg.title), list,
      h("div", { class: "tools" }, h("a", { href: "leaderboard.html", target: "_blank" }, "Live leaderboard ↗"), h("label", {}, dark, "Dark theme"), h("div", { class: "note" }, cfg.footer || "")));
    app.append(rail, main);
    document.body.append(app);
    const mounted = {};
    let current = 0, stopScene = null;
    const leaveWelcome = () => { if (stopScene) { stopScene(); stopScene = null; } };
    const W = cfg.welcome;
    function showWelcome() {
      current = -1;
      list.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.welcome === "1"));
      main.innerHTML = "";
      const cv = h("canvas", { class: "welcome-scene" });
      const total = cfg.steps.reduce((a, s) => a + (s.time || 0), 0);
      const hero = h("div", { class: "welcome" }, cv,
        h("div", { class: "welcome-text" },
          W.kicker ? h("div", { class: "kicker" }, W.kicker) : null,
          h("h2", {}, W.title || cfg.title),
          W.lead ? h("p", { class: "lead", html: W.lead }) : null,
          h("div", { class: "chips" }, ...(W.facts || [`${cfg.steps.length} steps`, `about ${total} min`, "live tournament at the end"]).map((f) => h("span", { class: "chip" }, f))),
          h("div", { class: "btns" }, h("button", { class: "start", onclick: () => show(0) }, "Start the lab →"))));
      main.append(hero);
      const size = () => { const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr)); };
      size();
      const ro = new ResizeObserver(size); ro.observe(cv);
      const stop = W.scene ? W.scene(cv) : null;
      stopScene = () => { ro.disconnect(); if (stop) stop(); };
      if (location.hash !== "#welcome") history.replaceState(null, "", "#welcome");
      window.scrollTo({ top: 0 });
    }
    function show(i) {
      leaveWelcome();
      current = clamp(i, 0, cfg.steps.length - 1);
      const s = cfg.steps[current];
      list.querySelectorAll("button").forEach((b) => b.classList.toggle("active", +b.dataset.i === current));
      main.innerHTML = "";
      main.append(h("div", { class: "step-head" }, h("h2", {}, s.title), h("div", { class: "where" }, `Step ${current + 1} of ${cfg.steps.length}` + (s.time ? ` · about ${s.time} min` : ""))));
      if (s.theory) main.append(h("div", { class: "theory", html: s.theory }));
      const task = (window.LAB_TASKS || {})[s.id];   // steps with mission: true show their Mission box instead (the task text stays in the TA run sheet)
      if (task && !s.mission) main.append(h("div", { class: "ask show", html: "<div class='q'>Your task</div><div class='a'>" + task + "</div>" }));
      if (!mounted[current]) mounted[current] = s.mount ? s.mount() : h("div");
      main.append(mounted[current]);
      const prev = current === 0 ? (W ? h("button", { class: "ghost", onclick: showWelcome }, "Welcome") : h("button", { class: "ghost", disabled: "" }, "Previous")) : h("button", { class: "ghost", onclick: () => show(current - 1) }, "Previous");
      main.append(h("div", { class: "nav" }, prev, h("button", { disabled: current === cfg.steps.length - 1 ? "" : null, onclick: () => show(current + 1) }, "Next step")));
      location.hash = s.id;
      window.scrollTo({ top: 0 });
    }
    if (W) list.append(h("li", {}, h("button", { class: "welcome-btn", "data-welcome": "1", onclick: showWelcome }, h("span", { class: "n" }, "◆"), "Welcome")));
    cfg.steps.forEach((s, i) => list.append(h("li", {}, h("button", { class: s.tour ? "tour" : "", "data-i": i, onclick: () => show(i) }, h("span", { class: "n" }, s.tour ? "★" : i + 1), s.title))));
    const hashStep = () => cfg.steps.findIndex((s) => s.id === location.hash.slice(1));
    if (W && hashStep() < 0) showWelcome(); else show(Math.max(0, hashStep()));
    addEventListener("hashchange", () => { if (W && location.hash === "#welcome") { if (current !== -1) showWelcome(); return; } const i = hashStep(); if (i >= 0 && i !== current) show(i); });
  }

  window.Lab = { $, h, RNG, fmt, mean, sd, median, clamp, sleep, tween, pulse, range, select, check, callout, examples, mission, checkpoint, metric, canvas, css, quiz, tournamentSpec, tournament, init, esc };
})();

