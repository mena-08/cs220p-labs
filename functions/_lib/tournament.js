/* Server side of the CS220P tournaments: loads each lab's tournament spec (generated from the lab pages at build time)
   and scores parameters on the official seeds, which never reach the browser. */
import { LABS } from "../_generated/labs.js";
import { tableKey } from "./params.js";
export { normalize } from "./params.js";

const specs = {};
export const labIds = Object.keys(LABS);
export function spec(lab) {
  if (!Object.hasOwn(LABS, lab)) return null;
  return (specs[lab] ??= LABS[lab].load());
}

export const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function score(lab, params) {
  const L = LABS[lab];
  if (L.table) {
    const hit = L.table[tableKey(params)];
    if (!hit) throw new Error("This parameter combination has no precomputed score.");
    return hit;
  }
  const r = spec(lab).run({ ...params }, L.official);
  return { points: r.points, details: r.details, summary: r.summary };
}

export function cleanText(v, max, upper = false) {
  if (typeof v !== "string") return "";
  const s = v.normalize("NFKC").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return upper ? s.toUpperCase() : s;
}

export function authorized(request, env) {
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const want = env.ADMIN_TOKEN || "";
  if (!want || got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
