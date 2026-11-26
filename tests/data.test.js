/* Data checks that need no browser: every lab runs for every combination of its controls,
   and every draw-mode model answer passes its own rubric. Run: node tests/data.test.js */
const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
global.window = global; global.document = { addEventListener() {}, querySelector() { return null; } }; global.localStorage = { getItem: () => null };
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const [, f] of html.matchAll(/<script src="(data\/[^"?]+)/g)) eval(fs.readFileSync(path.join(root, f), "utf8"));
require(path.join(root, "draw.js"));
let fails = 0;
const fail = (m) => { fails++; console.error("✗ " + m); };
const S = { metric() {}, tag() {}, pool() {}, ring() {}, gate() {} };
for (const [id, lab] of Object.entries(window.LABS)) {
  if (!window.LESSONS[id] && !(id.startsWith("dj-") && window.DJANGO_SCENES[id.slice(3)])) fail(`lab ${id}: no such lesson`);
  let combos = [{}];
  lab.controls.forEach((c) => { const n = []; combos.forEach((o) => c.opts.forEach(([, v]) => n.push({ ...o, [c.id]: v }))); combos = n; });
  for (const p of combos) {
    try {
      const st = lab.make(p);
      if (!st.ev.length) throw new Error("no events");
      if (!st.k || !st.setup || !st.code) throw new Error("missing key idea, setup or code");
      for (let t = 0; t < st.L; t += 97) st.fx(t, S);
    } catch (e) { fail(`lab ${id} ${JSON.stringify(p)}: ${e.message}`); }
  }
  console.log(`✓ lab ${id}: ${combos.length} combinations`);
}
for (const p of window.DRAW.problems) {
  const r = window.DRAW.checkModel(p.id);
  if (r.got !== r.total || r.bad) fail(`draw ${p.id}: model answer scores ${r.got}/${r.total}, ${r.bad} red flags`);
  else console.log(`✓ draw ${p.id}: model passes ${r.total} rules`);
}
if (fails) { console.error(`${fails} failure(s)`); process.exit(1); }
