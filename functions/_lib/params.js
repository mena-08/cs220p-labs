/* Tournament parameters, shared by the server (validation) and the build (precomputed score tables).
   A spec param is {key, label, type: "select", options, string?} or {key, label, min, max, step}. */

const optionValue = (o) => (typeof o === "object" ? o.value : o);
const selectValue = (p, opt) => (p.string || isNaN(+opt) ? String(opt) : +opt);
const rangeValue = (p, i) => +(p.min + i * (+p.step || 1)).toFixed(10);

/* Canonical parameter object in spec order, or throws with a message for the student. */
export function normalize(spec, params) {
  if (!params || typeof params !== "object") throw new Error("Missing parameters.");
  const keys = spec.params.map((p) => p.key);
  for (const k of Object.keys(params)) if (!keys.includes(k)) throw new Error(`Unknown parameter "${k}".`);
  const out = {};
  for (const p of spec.params) {
    const v = params[p.key];
    if (v === undefined || v === null) throw new Error(`Missing parameter "${p.label}".`);
    if (p.type === "select") {
      const opt = p.options.map(optionValue).find((o) => String(o) === String(v));
      if (opt === undefined) throw new Error(`Invalid value for "${p.label}".`);
      out[p.key] = selectValue(p, opt);
    } else {
      const x = +v, step = +p.step || 1, i = Math.round((x - p.min) / step);
      if (!Number.isFinite(x) || x < p.min - 1e-9 || x > p.max + 1e-9 || Math.abs((x - p.min) / step - i) > 1e-6) throw new Error(`Invalid value for "${p.label}".`);
      out[p.key] = rangeValue(p, i);
    }
  }
  return out;
}

/* Every canonical parameter object of a spec (for precomputed labs). */
export function enumerate(spec) {
  const domains = spec.params.map((p) => (p.type === "select" ? p.options.map((o) => selectValue(p, optionValue(o))) : Array.from({ length: Math.round((p.max - p.min) / (+p.step || 1)) + 1 }, (_, i) => rangeValue(p, i))));
  let combos = [{}];
  spec.params.forEach((p, j) => { combos = combos.flatMap((c) => domains[j].map((v) => ({ ...c, [p.key]: v }))); });
  return combos;
}

export const tableKey = (params) => JSON.stringify(params);
