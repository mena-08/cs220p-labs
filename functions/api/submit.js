/* POST /api/submit {lab, name, team, device, params}: one official run, scored on the hidden seeds and stored. */
import { spec, normalize, score, json, cleanText } from "../_lib/tournament.js";

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "The request was not valid JSON." }, 400); }
  const lab = String(body.lab || ""), s = spec(lab);
  if (!s) return json({ error: "Unknown lab." }, 400);
  const name = cleanText(body.name, 24), team = cleanText(body.team, 12, true), device = cleanText(body.device, 64);
  if (!name || !team) return json({ error: "Enter your name and your team." }, 400);
  if (!device) return json({ error: "Missing device id; reload the page." }, 400);

  let params;
  try { params = normalize(s, body.params); } catch (e) { return json({ error: e.message }, 400); }

  const prior = await env.DB.prepare("SELECT name, team, points FROM submissions WHERE lab = ? AND device = ?").bind(lab, device).first();
  if (prior) return json({ error: `This device already made its official run (${prior.name}, team ${prior.team}).`, lock: { name: prior.name, team: prior.team, points: prior.points } }, 409);
  const taken = await env.DB.prepare("SELECT 1 FROM submissions WHERE lab = ? AND team = ? AND name = ? COLLATE NOCASE").bind(lab, team, name).first();
  if (taken) return json({ error: `${name} already has an official run in team ${team}. Ask the TA if this is a mistake.` }, 409);

  let res;
  try { res = score(lab, params); } catch (e) { return json({ error: `Scoring failed: ${e.message}` }, 500); }
  const points = Math.round(res.points);

  try {
    await env.DB.prepare("INSERT INTO submissions (lab, name, team, device, params, points, details) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(lab, name, team, device, JSON.stringify(params), points, JSON.stringify(res.details || [])).run();
  } catch (e) {
    return json({ error: "Someone with this name or device submitted at the same moment. Reload the page." }, 409);
  }
  const better = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE lab = ? AND points > ?").bind(lab, points).first();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions WHERE lab = ?").bind(lab).first();
  return json({ points, details: res.details || [], summary: res.summary || "", rank: better.n + 1, total: total.n });
}
