(() => {
  "use strict";

  const MODULES = window.MODULES;
  const CATS = window.DJANGO_CATEGORIES;
  const QS = window.DJANGO_QUESTIONS;
  const ALL_LESSONS = MODULES.flatMap((m, mi) => m.lessons.map((l, li) => ({ ...l, module: m, mi, li })));

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = (s) => String(s).replace(/<[^>]+>/g, "");

  /* ───────── persistence (per-browser, best effort) ───────── */
  const STORE_KEY = "backend-atlas:v1";
  const store = (() => {
    let data = { lessons: {}, q: {}, theme: null, openModules: {} };
    try { Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
    return {
      data,
      save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {} },
    };
  })();

  /* ───────── theme ───────── */
  const applyTheme = () => {
    if (store.data.theme) document.documentElement.dataset.theme = store.data.theme;
    else delete document.documentElement.dataset.theme;
  };
  applyTheme();
  $("#themeBtn").addEventListener("click", () => {
    const dark = store.data.theme ? store.data.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    store.data.theme = dark ? "light" : "dark";
    store.save();
    applyTheme();
  });

  /* ───────── state ───────── */
  const state = {
    route: { name: "lesson", id: ALL_LESSONS[0].id },
    step: 0,
    paused: false,
    dj: { cat: "all", level: "all", status: "all", text: "" },
    openQ: new Set(),
    drillId: null,
    drillRevealed: false,
  };

  const parseRoute = () => {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "django") return { name: "django", q: parts[1] === "q" ? parts[2] : null };
    if (parts[0] === "lesson" && ALL_LESSONS.some((l) => l.id === parts[1])) return { name: "lesson", id: parts[1], step: Number(parts[2]) || 0 };
    return { name: "lesson", id: ALL_LESSONS[0].id, step: 0 };
  };

  /* ───────── sidebar ───────── */
  const renderSidebar = () => {
    const done = Object.keys(store.data.lessons).filter((k) => store.data.lessons[k]).length;
    const known = QS.filter((q) => store.data.q[q.id] === "known").length;
    const current = state.route.name === "lesson" ? ALL_LESSONS.find((l) => l.id === state.route.id) : null;
    const html = [
      `<div class="side-head"><span>▤ System Design</span><small>${ALL_LESSONS.length} lessons</small></div>`,
      ...MODULES.map((m, mi) => {
        const isOpen = store.data.openModules[m.id] ?? (current ? current.module.id === m.id : mi === 0);
        const mDone = m.lessons.filter((l) => store.data.lessons[l.id]).length;
        return `<div class="module ${isOpen ? "open" : ""}" data-module="${m.id}">
          <button class="module-btn" aria-expanded="${isOpen}">
            <span class="chev">›</span><span class="folder" style="background:${m.color}"></span>
            <span>${String(mi + 1).padStart(2, "0")}. ${esc(m.title)}</span>
            <span class="count">${mDone}/${m.lessons.length}</span>
          </button>
          <ul class="lesson-list">
            ${m.lessons.map((l) => `<li><a class="lesson-link ${current && current.id === l.id ? "active" : ""} ${store.data.lessons[l.id] ? "done" : ""}" href="#/lesson/${l.id}">
              <span class="tick">${store.data.lessons[l.id] ? "✓" : ""}</span>${esc(l.title)}</a></li>`).join("")}
          </ul>
        </div>`;
      }),
      `<hr class="side-divider" />`,
      `<a class="dj-entry ${state.route.name === "django" ? "active" : ""}" href="#/django">
         <b>Senior Django Interview</b>
         <span>${QS.length} questions · ${CATS.length} topics · ${known} known</span>
       </a>`,
      `<div class="card progress-card"><div style="flex:1">PROGRESS
         <div class="bar"><i style="width:${(done / ALL_LESSONS.length) * 100}%"></i></div></div>
         <span style="margin-left:12px">${done} / ${ALL_LESSONS.length}</span></div>`,
    ].join("");
    $("#sidebar").innerHTML = html;
    $$(".module-btn", $("#sidebar")).forEach((b) =>
      b.addEventListener("click", () => {
        const mod = b.closest(".module");
        const open = !mod.classList.contains("open");
        mod.classList.toggle("open", open);
        b.setAttribute("aria-expanded", open);
        store.data.openModules[mod.dataset.module] = open;
        store.save();
      })
    );
  };

  /* ───────── diagram engine ───────── */
  const NODE_W = 158, NODE_H = 54;

  const edgePath = (a, b, bend) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // trim to the node boxes so packets start/stop at the edges
    const trim = (u) => Math.min(Math.abs((NODE_W / 2 + 6) / (u.x || 1e-9)), Math.abs((NODE_H / 2 + 6) / (u.y || 1e-9)));
    const t = trim({ x: ux, y: uy });
    const sx = a.x + ux * t, sy = a.y + uy * t, ex = b.x - ux * t, ey = b.y - uy * t;
    const mx = (sx + ex) / 2 - uy * bend, my = (sy + ey) / 2 + ux * bend;
    return { d: `M${sx.toFixed(1)},${sy.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`, mx: (sx + 2 * mx + ex) / 4, my: (sy + 2 * my + ey) / 4 };
  };

  const renderDiagram = (lesson, step) => {
    const byId = Object.fromEntries(lesson.nodes.map((n) => [n.id, n]));
    const show = new Set(step.show || lesson.nodes.map((n) => n.id));
    const active = new Set(step.active || []);
    const seen = {};
    const edges = (step.flows || []).map(([from, to, kind], i) => {
      const a = byId[from], b = byId[to];
      if (!a || !b) return "";
      const pair = [from, to].sort().join("|");
      seen[pair] = (seen[pair] || 0) + 1;
      const dir = from < to ? 1 : -1;
      const bend = 26 * dir * (seen[pair] > 1 || (step.flows || []).some(([f, t]) => f === to && t === from) ? 1 : 0.25) + (seen[pair] > 2 ? 18 : 0);
      const { d, mx, my } = edgePath(a, b, bend);
      const dur = 1.6;
      const motion = kind === "fail"
        ? `<animateMotion dur="${dur}s" begin="-${(i * 0.35).toFixed(2)}s" repeatCount="indefinite" keyPoints="0;0.5;0.5" keyTimes="0;0.6;1" calcMode="linear" path="${d}"/>
           <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.6;1" dur="${dur}s" begin="-${(i * 0.35).toFixed(2)}s" repeatCount="indefinite"/>`
        : `<animateMotion dur="${dur}s" begin="-${(i * 0.35).toFixed(2)}s" repeatCount="indefinite" path="${d}"/>`;
      return `<path class="edge ${kind}" d="${d}"/>
        ${kind === "fail" ? `<text x="${mx}" y="${my + 5}" text-anchor="middle" font-size="16" font-weight="800" fill="var(--fail)">✕</text>` : ""}
        <circle class="packet ${kind}" r="6" cx="0" cy="0">${motion}</circle>`;
    }).join("");

    const nodes = lesson.nodes.map((n) => {
      const cls = ["node", show.has(n.id) ? "" : "hidden", active.size && !active.has(n.id) ? "dim" : "", active.has(n.id) ? "active" : ""].join(" ");
      const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
      return `<g class="${cls}">
        <rect class="shadow" x="${x + 3}" y="${y + 3}" width="${NODE_W}" height="${NODE_H}" rx="10"/>
        <rect class="face" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="10"/>
        <text class="icon" x="${x + 24}" y="${n.y + 7}" text-anchor="middle">${n.icon}</text>
        <text class="lbl" x="${x + 44}" y="${n.y + 5}">${esc(n.label)}</text>
      </g>`;
    }).join("");

    return `<svg class="diagram" id="diagram" viewBox="0 0 800 440" role="img" aria-label="${esc(step.title)} diagram">${edges}${nodes}</svg>`;
  };

  /* ───────── lesson view ───────── */
  const renderLesson = () => {
    const lesson = ALL_LESSONS.find((l) => l.id === state.route.id);
    const stepIdx = Math.min(state.step, lesson.steps.length - 1);
    const step = lesson.steps[stepIdx];
    const prev = lesson.steps[stepIdx - 1];
    const last = stepIdx === lesson.steps.length - 1;
    if (last && !store.data.lessons[lesson.id]) { store.data.lessons[lesson.id] = true; store.save(); renderSidebar(); }

    const levelClass = { Beginner: "b-green", Intermediate: "b-sky", Advanced: "b-rose" }[lesson.level] || "b-green";
    const metrics = lesson.metricKeys.map((k) => {
      const v = step.metrics[k];
      const changed = v && (!prev || prev.metrics[k] !== v);
      return `<div class="metric ${changed ? "changed" : ""}"><small>${esc(k)}</small><b>${v ? esc(v) : "—"}</b></div>`;
    }).join("");

    $("#layout").classList.remove("wide");
    $("#main").innerHTML = `
      <section class="card stage">
        <div class="crumbs">${String(lesson.mi + 1).padStart(2, "0")}. ${esc(lesson.module.title)} / Lesson ${lesson.li + 1} of ${lesson.module.lessons.length}</div>
        <div class="title-row">
          <h1>${esc(lesson.title)}</h1>
          <div class="badges">
            <span class="badge b-amber">◷ ${lesson.minutes} min</span>
            <span class="badge ${levelClass}">${esc(lesson.level)}</span>
            <span class="badge b-violet">${lesson.steps.length} steps</span>
          </div>
        </div>
        <p class="subtitle">${esc(lesson.subtitle)}</p>
        <div class="canvas ${state.paused ? "paused" : ""}" id="canvas">
          <div class="canvas-top">
            <div class="metrics">${metrics}</div>
            <div class="controls">
              <button class="btn" id="replayBtn">↻ Replay</button>
              <button class="btn" id="pauseBtn">${state.paused ? "▶ Play" : "❚❚ Pause"}</button>
            </div>
          </div>
          ${renderDiagram(lesson, step)}
          <div class="legend"><span><i style="background:var(--req)"></i>request</span><span><i style="background:var(--res)"></i>response</span><span><i style="background:var(--sync)"></i>sync / handshake</span><span><i style="background:var(--fail)"></i>failure / miss</span></div>
        </div>
        <div class="card steps-card">
          <div class="steps-head">IN THIS LESSON <span>Step ${stepIdx + 1} of ${lesson.steps.length}</span></div>
          <div class="step-strip">
            ${lesson.steps.map((s, i) => `<button class="step-dot ${i === stepIdx ? "current" : ""} ${i < stepIdx ? "seen" : ""}" data-step="${i}"><i>${i + 1}</i>${esc(s.short)}</button>`).join("")}
          </div>
        </div>
      </section>`;

    const next = lesson.steps[stepIdx + 1];
    const nextLesson = ALL_LESSONS[ALL_LESSONS.findIndex((l) => l.id === lesson.id) + 1];
    const nextLabel = next ? `Next: ${esc(next.short)} →` : nextLesson ? `Next lesson →` : `Django questions →`;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>STEP ${stepIdx + 1} / ${lesson.steps.length}</span><span class="tag ${step.tag}">${step.tag}</span></div>
        <h2>${esc(step.title)}</h2>
        ${step.body.map((p) => `<p>${p}</p>`).join("")}
        <div class="key-idea"><small>KEY IDEA</small>${esc(step.key)}</div>
        <div class="nav-row">
          <button class="btn" id="backBtn" ${stepIdx === 0 ? "disabled" : ""}>← Back</button>
          <button class="btn btn-primary" id="nextBtn">${nextLabel}</button>
        </div>
        <div class="hint"><kbd>←</kbd><kbd>→</kbd> step · <kbd>R</kbd> replay · <kbd>Space</kbd> pause</div>
      </section>
      <section class="card panel">
        <div class="panel-top"><span>YOU'LL LEARN</span></div>
        <ul class="learn-list">${lesson.learn.map((t, i) => `<li class="${(i + 1) / lesson.learn.length <= (stepIdx + 1) / lesson.steps.length ? "got" : ""}">${esc(t)}</li>`).join("")}</ul>
      </section>`;

    const svg = $("#diagram");
    if (state.paused && svg.pauseAnimations) svg.pauseAnimations();
    $("#replayBtn").onclick = () => { svg.setCurrentTime && svg.setCurrentTime(0); };
    $("#pauseBtn").onclick = togglePause;
    $("#backBtn").onclick = () => goStep(stepIdx - 1);
    $("#nextBtn").onclick = () => {
      if (next) goStep(stepIdx + 1);
      else location.hash = nextLesson ? `#/lesson/${nextLesson.id}` : "#/django";
    };
    $$(".step-dot").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.step))));
  };

  const goStep = (i) => {
    const lesson = ALL_LESSONS.find((l) => l.id === state.route.id);
    state.step = Math.max(0, Math.min(lesson.steps.length - 1, i));
    history.replaceState(null, "", `#/lesson/${lesson.id}/${state.step}`);
    renderLesson();
  };

  const togglePause = () => {
    state.paused = !state.paused;
    const svg = $("#diagram");
    if (svg) state.paused ? svg.pauseAnimations() : svg.unpauseAnimations();
    $("#canvas")?.classList.toggle("paused", state.paused);
    const b = $("#pauseBtn");
    if (b) b.textContent = state.paused ? "▶ Play" : "❚❚ Pause";
  };

  /* ───────── tiny Python highlighter ───────── */
  const KW = /^(def|class|return|from|import|with|for|in|if|else|elif|async|await|None|True|False|try|except|raise|as|not|and|or|lambda|yield|pass|is)$/;
  const highlight = (code) => {
    const re = /(#[^\n]*)|("""[\s\S]*?"""|f?"[^"\n]*"|f?'[^'\n]*')|\b([A-Za-z_]+)\b/g;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (m[1]) out += `<span class="c">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="s">${esc(m[2])}</span>`;
      else out += KW.test(m[3]) ? `<span class="k">${m[3]}</span>` : esc(m[3]);
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  };

  /* ───────── Django view ───────── */
  const catTitle = (id) => (CATS.find((c) => c.id === id) || {}).title || id;
  const qNumber = (q) => QS.indexOf(q) + 1;

  const filteredQs = () => {
    const { cat, level, status, text } = state.dj;
    const t = text.trim().toLowerCase();
    return QS.filter((q) => {
      if (cat !== "all" && q.cat !== cat) return false;
      if (level !== "all" && q.level !== level) return false;
      const st = store.data.q[q.id] || "new";
      if (status !== "all" && st !== status) return false;
      if (t) {
        const hay = (q.q + " " + q.short + " " + strip(q.a.join(" ")) + " " + (q.code || "") + " " + catTitle(q.cat)).toLowerCase();
        return t.split(/\s+/).every((w) => hay.includes(w));
      }
      return true;
    });
  };

  const renderDjango = () => {
    $("#layout").classList.add("wide");
    $("#main").innerHTML = `
      <section class="card dj-hero">
        <span class="badge b-dj">Backend · Django · Senior</span>
        <h1>Senior Django Interview Questions</h1>
        <p>${QS.length} questions that come up in senior and staff backend interviews: ORM depth, concurrency, zero-downtime migrations, async, DRF, security and production operations. Each has a one-line answer, a full explanation, working code and the follow-ups interviewers usually ask next.</p>
        <div class="dj-tools">
          <input type="search" id="djSearch" placeholder="Filter questions (e.g. select_for_update, migrations)…" value="${esc(state.dj.text)}" />
          <select id="djLevel" aria-label="Level">
            <option value="all">All levels</option><option value="Senior">Senior</option><option value="Staff">Staff</option>
          </select>
          <select id="djStatus" aria-label="Status">
            <option value="all">Any status</option><option value="new">Not reviewed</option><option value="review">Needs review</option><option value="known">Known</option>
          </select>
          <button class="btn" id="expandAll">Expand all</button>
        </div>
        <div class="chips" id="djChips"></div>
      </section>
      <div class="q-list" id="qList"></div>`;
    $("#djLevel").value = state.dj.level;
    $("#djStatus").value = state.dj.status;
    $("#djSearch").addEventListener("input", (e) => { state.dj.text = e.target.value; renderQList(); });
    $("#djLevel").addEventListener("change", (e) => { state.dj.level = e.target.value; renderQList(); });
    $("#djStatus").addEventListener("change", (e) => { state.dj.status = e.target.value; renderQList(); });
    $("#expandAll").addEventListener("click", () => {
      const list = filteredQs();
      const allOpen = list.every((q) => state.openQ.has(q.id));
      list.forEach((q) => (allOpen ? state.openQ.delete(q.id) : state.openQ.add(q.id)));
      renderQList();
    });
    renderQList();
    renderDjAside();
    if (state.route.q) {
      state.openQ.add(state.route.q);
      renderQList();
      requestAnimationFrame(() => document.getElementById(`q-${state.route.q}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  };

  const renderQList = () => {
    const chips = [{ id: "all", title: "All" }, ...CATS].map((c) => {
      const n = c.id === "all" ? QS.length : QS.filter((q) => q.cat === c.id).length;
      return `<button class="chip ${state.dj.cat === c.id ? "on" : ""}" data-cat="${c.id}">${esc(c.title)}<small>${n}</small></button>`;
    }).join("");
    $("#djChips").innerHTML = chips;
    $$(".chip", $("#djChips")).forEach((b) => (b.onclick = () => { state.dj.cat = b.dataset.cat; renderQList(); }));

    const list = filteredQs();
    $("#expandAll").textContent = list.length && list.every((q) => state.openQ.has(q.id)) ? "Collapse all" : "Expand all";
    $("#qList").innerHTML = list.length ? list.map(renderQ).join("") : `<div class="card empty">No questions match these filters.</div>`;
    $$(".q-head", $("#qList")).forEach((h) => (h.onclick = () => {
      const id = h.closest(".q").dataset.id;
      state.openQ.has(id) ? state.openQ.delete(id) : state.openQ.add(id);
      h.closest(".q").classList.toggle("open");
      h.setAttribute("aria-expanded", state.openQ.has(id));
      $("#expandAll").textContent = list.every((q) => state.openQ.has(q.id)) ? "Collapse all" : "Expand all";
    }));
    $$("[data-mark]", $("#qList")).forEach((b) => (b.onclick = () => {
      const id = b.closest(".q").dataset.id;
      const val = b.dataset.mark;
      store.data.q[id] = store.data.q[id] === val ? undefined : val;
      if (!store.data.q[id]) delete store.data.q[id];
      store.save();
      renderQList(); renderDjAside(); renderSidebar();
    }));
  };

  const renderQ = (q) => {
    const st = store.data.q[q.id];
    const open = state.openQ.has(q.id);
    return `<article class="card q ${open ? "open" : ""} ${st || ""}" id="q-${q.id}" data-id="${q.id}">
      <button class="q-head" aria-expanded="${open}">
        <span class="q-num">${st === "known" ? "✓" : qNumber(q)}</span>
        <span class="q-title"><b>${esc(q.q)}</b>
          <span class="q-meta"><span class="badge b-dj">${esc(catTitle(q.cat))}</span><span class="badge ${q.level === "Staff" ? "b-violet" : "b-sky"}">${q.level}</span>${st === "review" ? `<span class="badge b-amber">needs review</span>` : ""}</span>
        </span>
        <span class="q-toggle">+</span>
      </button>
      <div class="q-body">
        <div class="tldr">${esc(q.short)}</div>
        ${q.a.map((p) => `<p>${p}</p>`).join("")}
        ${q.code ? `<pre class="code"><code>${highlight(q.code)}</code></pre>` : ""}
        ${q.follow && q.follow.length ? `<div class="follow"><small>LIKELY FOLLOW-UPS</small><ul>${q.follow.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}
        <div class="q-actions">
          <button class="btn ${st === "known" ? "on" : ""}" data-mark="known">✓ I know this</button>
          <button class="btn ${st === "review" ? "on-review" : ""}" data-mark="review">↺ Review later</button>
        </div>
      </div>
    </article>`;
  };

  const pickDrill = () => {
    const pool = QS.filter((q) => store.data.q[q.id] !== "known" && q.id !== state.drillId);
    const from = pool.length ? pool : QS;
    state.drillId = from[Math.floor(Math.random() * from.length)].id;
    state.drillRevealed = false;
  };

  const renderDjAside = () => {
    if (!state.drillId) pickDrill();
    const drill = QS.find((q) => q.id === state.drillId);
    const known = QS.filter((q) => store.data.q[q.id] === "known").length;
    const review = QS.filter((q) => store.data.q[q.id] === "review").length;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>YOUR PROGRESS</span></div>
        <div class="stat-grid">
          <div class="stat"><b>${known}</b><small>known</small></div>
          <div class="stat"><b>${review}</b><small>to review</small></div>
        </div>
        <div class="bar" style="margin-top:12px"><i style="width:${(known / QS.length) * 100}%;background:var(--dj)"></i></div>
      </section>
      <section class="card panel drill">
        <div class="panel-top"><span>MOCK INTERVIEW</span><span class="tag concept">${esc(catTitle(drill.cat))}</span></div>
        <h2>${esc(drill.q)}</h2>
        ${state.drillRevealed
          ? `<div class="tldr">${esc(drill.short)}</div><p><a href="#/django/q/${drill.id}">Read the full answer →</a></p>`
          : `<p>Answer out loud first, then check yourself.</p>`}
        <div class="nav-row">
          ${state.drillRevealed ? "" : `<button class="btn btn-dj" id="revealBtn">Reveal</button>`}
          <button class="btn" id="nextDrill">Next →</button>
        </div>
      </section>
      <section class="card panel">
        <div class="panel-top"><span>BY TOPIC</span></div>
        <div class="cat-bars">
          ${CATS.map((c) => {
            const qs = QS.filter((q) => q.cat === c.id);
            const k = qs.filter((q) => store.data.q[q.id] === "known").length;
            return `<div>${esc(c.title)} <span style="float:right;color:var(--muted)">${k}/${qs.length}</span><div class="bar"><i style="width:${(k / qs.length) * 100}%"></i></div></div>`;
          }).join("")}
        </div>
      </section>`;
    $("#revealBtn")?.addEventListener("click", () => { state.drillRevealed = true; renderDjAside(); });
    $("#nextDrill").addEventListener("click", () => { pickDrill(); renderDjAside(); });
  };

  /* ───────── search ───────── */
  const searchIndex = [
    ...ALL_LESSONS.map((l) => ({ title: l.title, sub: `Lesson · ${l.module.title}`, href: `#/lesson/${l.id}`, hay: (l.title + " " + l.subtitle + " " + l.steps.map((s) => s.title + " " + strip(s.body.join(" "))).join(" ")).toLowerCase() })),
    ...QS.map((q) => ({ title: q.q, sub: `Django · ${catTitle(q.cat)}`, href: `#/django/q/${q.id}`, hay: (q.q + " " + q.short + " " + strip(q.a.join(" ")) + " " + (q.code || "")).toLowerCase() })),
  ];
  let searchSel = 0;
  const openSearch = () => { $("#searchModal").hidden = false; $("#searchInput").value = ""; runSearch(); $("#searchInput").focus(); };
  const closeSearch = () => { $("#searchModal").hidden = true; };
  const runSearch = () => {
    const t = $("#searchInput").value.trim().toLowerCase();
    const res = (t ? searchIndex.filter((i) => t.split(/\s+/).every((w) => i.hay.includes(w))) : searchIndex).slice(0, 12);
    searchSel = Math.min(searchSel, Math.max(0, res.length - 1));
    $("#searchResults").innerHTML = res.length
      ? res.map((r, i) => `<li><a href="${r.href}" class="${i === searchSel ? "sel" : ""}">${esc(r.title)}<small>${esc(r.sub)}</small></a></li>`).join("")
      : `<li class="empty">Nothing found.</li>`;
  };
  $("#searchBtn").addEventListener("click", openSearch);
  $("#searchInput").addEventListener("input", () => { searchSel = 0; runSearch(); });
  $("#searchInput").addEventListener("keydown", (e) => {
    const links = $$("#searchResults a");
    if (e.key === "ArrowDown") { searchSel = Math.min(links.length - 1, searchSel + 1); runSearch(); e.preventDefault(); }
    if (e.key === "ArrowUp") { searchSel = Math.max(0, searchSel - 1); runSearch(); e.preventDefault(); }
    if (e.key === "Enter" && links[searchSel]) { location.hash = links[searchSel].getAttribute("href"); closeSearch(); }
  });
  $("#searchResults").addEventListener("click", (e) => { if (e.target.closest("a")) closeSearch(); });
  $("#searchModal").addEventListener("click", (e) => { if (e.target.id === "searchModal") closeSearch(); });

  /* ───────── keyboard + mobile nav ───────── */
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
    if (e.key === "Escape") { closeSearch(); document.body.classList.remove("nav-open"); return; }
    if (e.target.matches("input, select, textarea") || !$("#searchModal").hidden) return;
    if (state.route.name !== "lesson") return;
    if (e.key === "ArrowRight") goStep(state.step + 1);
    else if (e.key === "ArrowLeft") goStep(state.step - 1);
    else if (e.key.toLowerCase() === "r") $("#diagram")?.setCurrentTime(0);
    else if (e.key === " ") { e.preventDefault(); togglePause(); }
  });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));

  /* ───────── router ───────── */
  const render = () => {
    const r = parseRoute();
    const lessonChanged = r.name !== state.route.name || r.id !== state.route.id;
    state.route = r;
    if (r.name === "lesson") {
      state.step = lessonChanged ? r.step || 0 : (r.step ?? state.step);
      renderSidebar();
      renderLesson();
    } else {
      renderSidebar();
      renderDjango();
    }
    document.body.classList.remove("nav-open");
    if (lessonChanged) window.scrollTo(0, 0);
    document.title = r.name === "django" ? "Senior Django Questions · Backend Atlas" : `${ALL_LESSONS.find((l) => l.id === r.id).title} · Backend Atlas`;
  };
  window.addEventListener("hashchange", render);
  state.route = { name: null };
  render();
})();
