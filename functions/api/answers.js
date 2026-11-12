/* Timed class activities (Lab.checkpoint) and submitted quizzes (Lab.quiz with submit).
   POST /api/answers {lab, exercise, name, team, device, score, max, answers}: one submission per device and exercise.
   GET  /api/answers?lab=L2&exercise=byhand: every submission, best first, for the class results page.
   PRIVATE activities are only returned with the admin token (the TA sees them in the leaderboard's Admin panel). */
import { labIds, json, cleanText, authorized } from "../_lib/tournament.js";

const EXERCISE = /^[a-z0-9-]{1,32}$/;
const PRIVATE = new Set(["L1/properties", "L2/reportcard"]);

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "The request was not valid JSON." }, 400); }
  const lab = String(body.lab || ""), exercise = String(body.exercise || "");
  if (!labIds.includes(lab) || !EXERCISE.test(exercise)) return json({ error: "Unknown activity." }, 400);
  const name = cleanText(body.name, 24), team = cleanText(body.team, 12, true), device = cleanText(body.device, 64);
  if (!name || !team) return json({ error: "Enter your name and your team." }, 400);
  if (!device) return json({ error: "Missing device id; reload the page." }, 400);
  const score = +body.score, max = +body.max;
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0 || score < 0 || score > max) return json({ error: "Invalid score." }, 400);
  const answers = JSON.stringify(body.answers ?? {});
  if (answers.length > 4000) return json({ error: "Answers too long." }, 400);

  const prior = await env.DB.prepare("SELECT name, team, score, max FROM answers WHERE lab = ? AND exercise = ? AND device = ?").bind(lab, exercise, device).first();
  if (prior) return json({ error: `This device already submitted (${prior.name}, team ${prior.team}).`, prior }, 409);
  await env.DB.prepare("INSERT INTO answers (lab, exercise, name, team, device, score, max, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(lab, exercise, name, team, device, score, max, answers).run();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM answers WHERE lab = ? AND exercise = ?").bind(lab, exercise).first();
  return json({ ok: true, total: total.n });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), lab = url.searchParams.get("lab") || "", exercise = url.searchParams.get("exercise") || "";
  if (!labIds.includes(lab) || !EXERCISE.test(exercise)) return json({ error: "Unknown activity." }, 400);
  if (PRIVATE.has(`${lab}/${exercise}`) && !authorized(request, env)) return json({ error: "Private activity: unlock the Admin panel with the admin token.", private: true }, 401);
  const { results } = await env.DB.prepare("SELECT id, name, team, score, max, answers, created_at FROM answers WHERE lab = ? AND exercise = ? ORDER BY score DESC, created_at ASC").bind(lab, exercise).all();
  return json({ lab, exercise, rows: results.map((r) => ({ ...r, answers: JSON.parse(r.answers) })) });
}
