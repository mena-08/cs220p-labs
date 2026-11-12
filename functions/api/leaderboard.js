/* GET /api/leaderboard?lab=L1: every official run of the lab, best first, plus the parameter labels for display. */
import { spec, labIds, json } from "../_lib/tournament.js";

export async function onRequestGet({ request, env }) {
  const lab = new URL(request.url).searchParams.get("lab") || labIds[0];
  const s = spec(lab);
  if (!s) return json({ error: "Unknown lab." }, 400);
  const { results } = await env.DB.prepare("SELECT id, name, team, params, points, details, created_at FROM submissions WHERE lab = ? ORDER BY points DESC, created_at ASC").bind(lab).all();
  return json({
    lab, labs: labIds, unit: s.unit || "points",
    params: s.params.map((p) => ({ key: p.key, label: p.label, options: p.type === "select" ? p.options.map((o) => (typeof o === "object" ? { value: o.value, label: o.label } : { value: o, label: String(o) })) : null })),
    rows: results.map((r) => ({ ...r, params: JSON.parse(r.params), details: JSON.parse(r.details) })),
  });
}
