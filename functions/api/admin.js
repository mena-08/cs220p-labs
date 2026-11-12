/* POST /api/admin with "Authorization: Bearer <ADMIN_TOKEN>":
   {action: "check"} verifies the token; {action: "delete", id} removes one run (the student can then submit again);
   {action: "reset", lab} removes every run of a lab;
   {action: "deleteAnswer", id} removes one class-activity submission; {action: "resetExercise", lab, exercise} removes all of an activity. */
import { spec, json, authorized } from "../_lib/tournament.js";

export async function onRequestPost({ request, env }) {
  if (!authorized(request, env)) return json({ error: "Wrong admin token." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "The request was not valid JSON." }, 400); }
  if (body.action === "check") return json({ ok: true });
  if (body.action === "delete") {
    const r = await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(+body.id).run();
    return json({ deleted: r.meta.changes });
  }
  if (body.action === "reset") {
    if (!spec(String(body.lab))) return json({ error: "Unknown lab." }, 400);
    const r = await env.DB.prepare("DELETE FROM submissions WHERE lab = ?").bind(String(body.lab)).run();
    return json({ deleted: r.meta.changes });
  }
  if (body.action === "deleteAnswer") {
    const r = await env.DB.prepare("DELETE FROM answers WHERE id = ?").bind(+body.id).run();
    return json({ deleted: r.meta.changes });
  }
  if (body.action === "resetExercise") {
    const r = await env.DB.prepare("DELETE FROM answers WHERE lab = ? AND exercise = ?").bind(String(body.lab), String(body.exercise)).run();
    return json({ deleted: r.meta.changes });
  }
  return json({ error: "Unknown action." }, 400);
}
