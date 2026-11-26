(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const strip = (s) => String(s).replace(/<[^>]+>/g, "");

  /* ───────── data normalisation ───────── */
  const CATS = window.DJANGO_CATEGORIES;
  const QS = window.DJANGO_QUESTIONS;
  const SCENES = window.DJANGO_SCENES || {};
  const DJ_REFS = window.DJANGO_REFS || {};

  const guessKind = (id) => {
    if (/^(users?|clients|prod|dev|oncall)$/.test(id)) return "user";
    if (/browser|client|user|alice|bob|poster|reader|dash/.test(id)) return "client";
    if (/db|primary|replica|^r\d$|^s\d$|shard|store|sql|doc|wide|idx|btree|lsm|blob/.test(id)) return "db";
    if (/cache|redis|kv/.test(id)) return "cache";
    if (/queue|bus|topic|broker|wal|log|src|dlq|buf/.test(id)) return "queue";
    if (/^lb$|router|gateway|api$|limiter|lim|reg$|policy/.test(id)) return "lb";
    if (/cdn|edge/.test(id)) return "edge";
    if (/dns|ext|psp|idp|kms|email|third/.test(id)) return "ext";
    if (/worker|^w\d$|^c\d$|consumer|job|relay|fan|batch|stream|unit|integ|e2e|ci/.test(id)) return "worker";
    return "server";
  };
  const parseFlows = (s) => s.split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
    const [ab, kind = "req"] = t.split(":");
    const [a, b] = ab.split(">");
    return [a.trim(), b.trim(), kind.trim()];
  });
  const words = (s) => (typeof s === "string" ? s.split(/\s+/).filter(Boolean) : s);
  const normStep = (s) => ({
    tag: s.t || s.tag || "concept",
    short: s.s || s.short,
    title: s.h || s.title,
    body: Array.isArray(s.body) ? s.body : String(s.b || "").split(/\n\n/),
    key: s.k || s.key || "",
    flows: typeof s.f === "string" ? parseFlows(s.f) : s.flows || [],
    active: words(s.a ?? s.active ?? []),
    show: s.v || s.show ? words(s.v || s.show) : null,
    metrics: s.m || s.metrics || {},
    ev: s.ev, fx: s.fx, L: s.L, gate: s.gate, g: s.g, setup: s.setup, code: s.code, note: s.note,
  });
  const normLesson = (l, extra = {}) => ({
    id: l.id,
    title: l.title,
    subtitle: l.sub || l.subtitle || "",
    level: l.level || "Intermediate",
    minutes: l.min || l.minutes || 6,
    learn: l.learn || [],
    deep: l.deep || [],
    iv: l.iv || [],
    refs: l.refs || [],
    metricKeys: l.mk || l.metricKeys || [],
    nodes: l.nodes.map((n) => ({ ...n, kind: n.kind || guessKind(n.id) })),
    code: l.code || null,
    steps: l.steps.map(normStep),
    ...extra,
  });

  const djGreens = ["#0c4b33", "#2f6f4f", "#44805c", "#1f5e46", "#3d7a5a", "#2a6650", "#4f8a68", "#185440", "#36704f", "#24604a"];
  const TRACKS = [
    ...window.TRACKS,
    {
      id: "dj",
      title: "Senior Django",
      modules: CATS.map((c, i) => ({ id: "dj-" + c.id, title: c.title, color: djGreens[i % djGreens.length], lessons: QS.filter((q) => q.cat === c.id && SCENES[q.id]).map((q) => "dj-" + q.id) })),
    },
  ];
  const LESSON = {};
  Object.values(window.LESSONS).forEach((l) => (LESSON[l.id] = normLesson(l)));
  QS.forEach((q) => {
    const sc = SCENES[q.id];
    if (!sc) return;
    LESSON["dj-" + q.id] = normLesson({ id: "dj-" + q.id, title: sc.t, sub: q.q, level: q.level, min: 5, mk: sc.mk, nodes: sc.nodes, steps: sc.steps, refs: DJ_REFS[q.cat] || [] }, { qa: q });
  });
  const ORDER = [];
  TRACKS.forEach((t) => t.modules.forEach((m, mi) => m.lessons.forEach((id, li) => {
    if (!LESSON[id]) { console.warn("missing lesson", id); return; }
    Object.assign(LESSON[id], { track: t, module: m, mi, li });
    ORDER.push(id);
  })));
  TRACKS.forEach((t) => t.modules.forEach((m) => (m.lessons = m.lessons.filter((id) => LESSON[id]))));

  /* ───────── persistence (per-browser, best effort) ───────── */
  const STORE_KEY = "backend-atlas:v1";
  const store = (() => {
    const data = { lessons: {}, q: {}, theme: null, openModules: {} };
    try { Object.assign(data, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch (_) {}
    return { data, save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (_) {} } };
  })();

  /* ───────── theme (light by default) ───────── */
  const applyTheme = () => { document.documentElement.dataset.theme = store.data.theme === "dark" ? "dark" : "light"; };
  applyTheme();
  $("#themeBtn").addEventListener("click", () => {
    store.data.theme = store.data.theme === "dark" ? "light" : "dark";
    store.save(); applyTheme(); window.Stage3D?.recolor();
  });

  /* ───────── state ───────── */
  const state = {
    route: { name: null },
    step: 0,
    dj: { cat: "all", level: "all", status: "all", text: "" },
    openQ: new Set(),
    drillId: null,
    drillRevealed: false,
  };

  const parseRoute = () => {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "django") return { name: "django", q: parts[1] === "q" ? parts[2] : null };
    if (parts[0] === "lesson" && LESSON[parts[1]]) return { name: "lesson", id: parts[1], step: Number(parts[2]) || 0 };
    return { name: "lesson", id: ORDER[0], step: 0 };
  };

  /* ───────── sidebar ───────── */
  const isDone = (id) => !!store.data.lessons[id];
  const renderSidebar = () => {
    const current = state.route.name === "lesson" ? LESSON[state.route.id] : null;
    const done = ORDER.filter(isDone).length;
    const known = QS.filter((q) => store.data.q[q.id] === "known").length;
    let n = 0;
    const html = TRACKS.map((t) => {
      const tDone = t.modules.reduce((a, m) => a + m.lessons.filter(isDone).length, 0);
      const tTotal = t.modules.reduce((a, m) => a + m.lessons.length, 0);
      return `<div class="track">
        <div class="side-head"><span>${esc(t.title)}</span><small>${tDone}/${tTotal}</small></div>
        ${t.id === "dj" ? `<a class="dj-entry ${state.route.name === "django" ? "active" : ""}" href="#/django"><b>All questions (Q&amp;A list)</b><span>${QS.length} questions · ${known} known</span></a>` : ""}
        ${t.modules.map((m) => {
          n++;
          const isOpen = store.data.openModules[m.id] ?? (current ? current.module.id === m.id : false);
          return `<div class="module ${isOpen ? "open" : ""}" data-module="${m.id}">
            <button class="module-btn" aria-expanded="${isOpen}">
              <span class="chev">›</span><span class="folder" style="background:${m.color}"></span>
              <span class="mod-title">${t.id === "sd" ? String(n).padStart(2, "0") + ". " : ""}${esc(m.title)}</span>
              <span class="count">${m.lessons.filter(isDone).length}/${m.lessons.length}</span>
            </button>
            <ul class="lesson-list">
              ${m.lessons.map((id) => `<li><a class="lesson-link ${current && current.id === id ? "active" : ""} ${isDone(id) ? "done" : ""}" href="#/lesson/${id}">
                <span class="tick">${isDone(id) ? "✓" : ""}</span><span>${esc(LESSON[id].title)}</span></a></li>`).join("")}
            </ul>
          </div>`;
        }).join("")}
      </div>`;
    }).join(`<hr class="side-divider" />`);
    $("#sidebar").innerHTML = html + `
      <div class="card progress-card"><div style="flex:1">PROGRESS
        <div class="bar"><i style="width:${(done / ORDER.length) * 100}%"></i></div></div>
        <span style="margin-left:12px">${done} / ${ORDER.length}</span></div>`;
    $$(".module-btn", $("#sidebar")).forEach((b) => b.addEventListener("click", () => {
      const mod = b.closest(".module");
      const open = !mod.classList.contains("open");
      mod.classList.toggle("open", open);
      b.setAttribute("aria-expanded", open);
      store.data.openModules[mod.dataset.module] = open;
      store.save();
    }));
    const act = $(".lesson-link.active", $("#sidebar"));
    if (act && act.scrollIntoViewIfNeeded) act.scrollIntoViewIfNeeded(false);
  };

  /* ───────── 3D stage (engine3d.js, loaded as a module) ───────── */
  const stage = () => window.Stage3D;
  let pendingStage = null;
  const mountStage = (lesson, idx) => {
    const slot = $("#stageSlot");
    if (!slot) return;
    if (!stage()) { pendingStage = [lesson, idx]; slot.innerHTML = `<div class="stage-loading">Loading 3D scene…</div>`; return; }
    slot.innerHTML = "";
    stage().attach(slot);
    stage().show(lesson, idx);
  };
  window.addEventListener("stage3d-ready", () => { if (pendingStage && state.route.name === "lesson") mountStage(...pendingStage); pendingStage = null; });
  const ICONS = { clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6v6l4 2", bars: "M4 20v-2M9 20v-6M14 20v-10M19 20V4", steps: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01", copy: "M9 9h11v11H9zM5 15H4V4h11v1", check: "M4 12l5 5L20 6" };
  const ico = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

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

  const catTitle = (id) => (CATS.find((c) => c.id === id) || {}).title || id;
  const refsHtml = (refs) => refs && refs.length
    ? `<div class="refs"><small>SOURCES &amp; FURTHER READING</small><ul>${refs.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a></li>`).join("")}</ul></div>` : "";

  const answerHtml = (q) => `
    <div class="tldr">${esc(q.short)}</div>
    ${q.a.map((p) => `<p>${p}</p>`).join("")}
    ${q.code ? `<pre class="code"><code>${highlight(q.code)}</code></pre>` : ""}
    ${q.follow && q.follow.length ? `<div class="follow"><small>LIKELY FOLLOW-UPS</small><ul>${q.follow.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>` : ""}`;

  const markButtons = (q) => {
    const st = store.data.q[q.id];
    return `<div class="q-actions" data-qid="${q.id}">
      <button class="btn ${st === "known" ? "on" : ""}" data-mark="known">✓ I know this</button>
      <button class="btn ${st === "review" ? "on-review" : ""}" data-mark="review">↺ Review later</button>
    </div>`;
  };
  const bindMarks = (root, after) => $$("[data-mark]", root).forEach((b) => (b.onclick = () => {
    const id = b.closest("[data-qid]").dataset.qid;
    const val = b.dataset.mark;
    if (store.data.q[id] === val) delete store.data.q[id]; else store.data.q[id] = val;
    store.save();
    after();
  }));

  /* ───────── lesson view ───────── */
  const renderLesson = () => {
    const lesson = LESSON[state.route.id];
    const stepIdx = Math.min(state.step, lesson.steps.length - 1);
    const step = lesson.steps[stepIdx];
    const prev = lesson.steps[stepIdx - 1];
    const last = stepIdx === lesson.steps.length - 1;
    if (last && !isDone(lesson.id)) { store.data.lessons[lesson.id] = true; store.save(); renderSidebar(); }

    const levelClass = { Beginner: "b-green", Intermediate: "b-sky", Advanced: "b-rose", Senior: "b-sky", Staff: "b-violet", Lead: "b-amber", CTO: "b-rose" }[lesson.level] || "b-green";
    const q = lesson.qa;
    const idxNum = ORDER.indexOf(lesson.id);
    const next = lesson.steps[stepIdx + 1];
    const nextLessonId = ORDER[idxNum + 1];

    $("#layout").classList.remove("wide");
    $("#main").innerHTML = `
      <section class="card stage ${q ? "is-dj" : ""}">
        <div class="crumbs">${esc(lesson.track.title)} / ${esc(lesson.module.title)} / ${lesson.li + 1} of ${lesson.module.lessons.length}</div>
        <div class="title-row">
          <h1>${esc(lesson.title)}</h1>
          <div class="badges">
            <span class="badge b-amber">${ico("clock")}${lesson.minutes} min</span>
            <span class="badge ${levelClass}">${ico("bars")}${esc(lesson.level)}</span>
            <span class="badge b-violet">${ico("steps")}${lesson.steps.length} steps</span>
            ${q ? `<span class="badge b-dj">Django</span>` : ""}
          </div>
        </div>
        <p class="subtitle">${q ? `<span class="q-label">Interview question</span> ` : ""}${esc(lesson.subtitle)}</p>
        <div id="stageSlot" class="stage-slot"></div>
        <div class="card steps-card">
          <div class="steps-head">IN THIS ${q ? "WALKTHROUGH" : "LESSON"} <span>Step ${stepIdx + 1} of ${lesson.steps.length}</span></div>
          <div class="step-strip">
            ${lesson.steps.map((s, i) => `<button class="step-dot ${i === stepIdx ? "current" : ""} ${i < stepIdx ? "seen" : ""}" data-step="${i}"><i>${i + 1}</i>${esc(s.short)}</button>`).join("")}
          </div>
        </div>
        ${q ? `
        <div class="card detail-card">
          <div class="detail-head"><h3>Model answer</h3>${markButtons(q)}</div>
          ${answerHtml(q)}
          ${refsHtml(lesson.refs)}
        </div>` : `
        <div class="detail-grid">
          ${lesson.deep.length ? `<div class="card detail-card"><h3>Deep dive</h3><ul class="deep">${lesson.deep.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
          ${lesson.iv.length ? `<div class="card detail-card iv"><h3>In the interview</h3><ul class="deep">${lesson.iv.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
        </div>
        ${lesson.refs.length ? `<div class="card detail-card">${refsHtml(lesson.refs)}</div>` : ""}`}
      </section>`;

    const nextLabel = next ? `Next: ${esc(next.short)} →` : nextLessonId ? `Next: ${esc(LESSON[nextLessonId].title)} →` : `Django Q&amp;A →`;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>STEP ${stepIdx + 1} / ${lesson.steps.length}</span><span class="tag ${step.tag}">${step.tag}</span></div>
        <h2>${esc(step.title)}</h2>
        ${step.body.map((p) => `<p>${p}</p>`).join("")}
        ${step.key ? `<div class="key-idea"><small>KEY IDEA</small>${esc(step.key)}</div>` : ""}
        ${step.setup ? `<div class="sec">THE SETUP</div><div class="setup">${step.setup.map(([k, v, c]) => `<div class="${c || ""}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
        ${step.code ? `<div class="sec">IN CODE <button class="btn copy" id="copyCode">${ico("copy")}Copy</button></div><pre class="code"><code>${highlight(step.code)}</code></pre>${step.note ? `<p class="code-note">${esc(step.note)}</p>` : ""}` : ""}
        <div class="nav-row">
          <button class="btn" id="backBtn" ${stepIdx === 0 ? "disabled" : ""}>← Back</button>
          <button class="btn btn-primary" id="nextBtn">${nextLabel}</button>
        </div>
        <div class="hint"><kbd>←</kbd><kbd>→</kbd> step · <kbd>Space</kbd> pause · <kbd>R</kbd> replay · <kbd>V</kbd> reset view</div>
      </section>
      ${q ? `<section class="card panel">
        <div class="panel-top"><span>SAY IT IN ONE LINE</span></div>
        <p class="one-liner">${esc(q.short)}</p>
        <div class="panel-top" style="margin-top:12px"><span>KEY IDEAS</span></div>
        <ul class="learn-list">${lesson.steps.map((s, i) => `<li class="${i <= stepIdx ? "got" : ""}">${esc(s.key)}</li>`).join("")}</ul>
      </section>` : `<section class="card panel">
        <div class="panel-top"><span>YOU'LL LEARN</span></div>
        <ul class="learn-list">${lesson.learn.map((t, i) => `<li class="${(i + 1) / lesson.learn.length <= (stepIdx + 1) / lesson.steps.length ? "got" : ""}">${esc(t)}</li>`).join("")}</ul>
      </section>`}`;

    mountStage(lesson, stepIdx);
    const cp = $("#copyCode");
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(step.code); cp.innerHTML = ico("check") + "Copied"; } catch (_) { cp.textContent = "Select the code to copy"; } };
    $("#backBtn").onclick = () => goStep(stepIdx - 1);
    $("#nextBtn").onclick = () => {
      if (next) goStep(stepIdx + 1);
      else location.hash = nextLessonId ? `#/lesson/${nextLessonId}` : "#/django";
    };
    $$(".step-dot").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.step))));
    if (q) bindMarks($("#main"), () => { renderLesson(); renderSidebar(); });
  };

  const goStep = (i) => {
    const lesson = LESSON[state.route.id];
    state.step = Math.max(0, Math.min(lesson.steps.length - 1, i));
    history.replaceState(null, "", `#/lesson/${lesson.id}/${state.step}`);
    renderLesson();
  };

  const togglePause = () => stage()?.togglePause();

  /* ───────── Django Q&A list ───────── */
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
    stage()?.detach();
    $("#layout").classList.add("wide");
    const firstDj = ORDER.find((id) => id.startsWith("dj-"));
    $("#main").innerHTML = `
      <section class="card dj-hero">
        <span class="badge b-dj">Backend · Django · Senior</span>
        <h1>Senior Django Interview Questions</h1>
        <p>${QS.length} questions that come up in senior and staff backend interviews. Each one has a 3D walkthrough, a one-line answer, a full explanation with code, likely follow-ups, and links to the official docs.</p>
        <div class="dj-tools">
          <a class="btn btn-dj" href="#/lesson/${firstDj}">▶ Start 3D walkthroughs</a>
          <input type="search" id="djSearch" placeholder="Filter questions (e.g. select_for_update, migrations)…" value="${esc(state.dj.text)}" />
          <select id="djLevel" aria-label="Level"><option value="all">All levels</option><option value="Senior">Senior</option><option value="Staff">Staff</option></select>
          <select id="djStatus" aria-label="Status"><option value="all">Any status</option><option value="new">Not reviewed</option><option value="review">Needs review</option><option value="known">Known</option></select>
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
    if (state.route.q) state.openQ.add(state.route.q);
    renderQList();
    renderDjAside();
    if (state.route.q) requestAnimationFrame(() => document.getElementById(`q-${state.route.q}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  };

  const renderQList = () => {
    $("#djChips").innerHTML = [{ id: "all", title: "All" }, ...CATS].map((c) => {
      const n = c.id === "all" ? QS.length : QS.filter((q) => q.cat === c.id).length;
      return `<button class="chip ${state.dj.cat === c.id ? "on" : ""}" data-cat="${c.id}">${esc(c.title)}<small>${n}</small></button>`;
    }).join("");
    $$(".chip", $("#djChips")).forEach((b) => (b.onclick = () => { state.dj.cat = b.dataset.cat; renderQList(); }));
    const list = filteredQs();
    $("#expandAll").textContent = list.length && list.every((q) => state.openQ.has(q.id)) ? "Collapse all" : "Expand all";
    $("#qList").innerHTML = list.length ? list.map(renderQ).join("") : `<div class="card empty">No questions match these filters.</div>`;
    $$(".q-head", $("#qList")).forEach((h) => (h.onclick = () => {
      const id = h.closest(".q").dataset.id;
      state.openQ.has(id) ? state.openQ.delete(id) : state.openQ.add(id);
      h.closest(".q").classList.toggle("open");
      h.setAttribute("aria-expanded", state.openQ.has(id));
    }));
    bindMarks($("#qList"), () => { renderQList(); renderDjAside(); renderSidebar(); });
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
        ${LESSON["dj-" + q.id] ? `<a class="btn btn-dj watch" href="#/lesson/dj-${q.id}">▶ Watch the 3D walkthrough</a>` : ""}
        ${answerHtml(q)}
        ${refsHtml(DJ_REFS[q.cat])}
        ${markButtons(q)}
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
        <div class="stat-grid"><div class="stat"><b>${known}</b><small>known</small></div><div class="stat"><b>${review}</b><small>to review</small></div></div>
        <div class="bar" style="margin-top:12px"><i style="width:${(known / QS.length) * 100}%;background:var(--dj)"></i></div>
      </section>
      <section class="card panel drill">
        <div class="panel-top"><span>MOCK INTERVIEW</span><span class="tag concept">${esc(catTitle(drill.cat))}</span></div>
        <h2>${esc(drill.q)}</h2>
        ${state.drillRevealed ? `<div class="tldr">${esc(drill.short)}</div><p><a href="#/lesson/dj-${drill.id}">Open the 3D walkthrough →</a></p>` : `<p>Answer out loud first, then check yourself.</p>`}
        <div class="nav-row">
          ${state.drillRevealed ? "" : `<button class="btn btn-dj" id="revealBtn">Reveal</button>`}
          <button class="btn" id="nextDrill">Next →</button>
        </div>
      </section>
      <section class="card panel">
        <div class="panel-top"><span>BY TOPIC</span></div>
        <div class="cat-bars">${CATS.map((c) => {
          const qs = QS.filter((q) => q.cat === c.id);
          const k = qs.filter((q) => store.data.q[q.id] === "known").length;
          return `<div>${esc(c.title)} <span style="float:right;color:var(--muted)">${k}/${qs.length}</span><div class="bar"><i style="width:${(k / qs.length) * 100}%"></i></div></div>`;
        }).join("")}</div>
      </section>`;
    $("#revealBtn")?.addEventListener("click", () => { state.drillRevealed = true; renderDjAside(); });
    $("#nextDrill").addEventListener("click", () => { pickDrill(); renderDjAside(); });
  };

  /* ───────── search ───────── */
  const searchIndex = ORDER.map((id) => {
    const l = LESSON[id];
    const qa = l.qa ? " " + l.qa.short + " " + strip(l.qa.a.join(" ")) + " " + (l.qa.code || "") : "";
    return { title: l.qa ? l.qa.q : l.title, sub: `${l.track.title} · ${l.module.title}`, href: `#/lesson/${id}`, hay: (l.title + " " + l.subtitle + " " + l.steps.map((s) => s.title + " " + strip(s.body.join(" "))).join(" ") + " " + strip(l.deep.join(" ")) + qa).toLowerCase() };
  });
  let searchSel = 0;
  const openSearch = () => { $("#searchModal").hidden = false; $("#searchInput").value = ""; searchSel = 0; runSearch(); $("#searchInput").focus(); };
  const closeSearch = () => { $("#searchModal").hidden = true; };
  const runSearch = () => {
    const t = $("#searchInput").value.trim().toLowerCase();
    const res = (t ? searchIndex.filter((i) => t.split(/\s+/).every((w) => i.hay.includes(w) || i.title.toLowerCase().includes(w))) : searchIndex).slice(0, 14);
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
    else if (e.key.toLowerCase() === "r") stage()?.replay();
    else if (e.key.toLowerCase() === "v") stage()?.resetView();
    else if (e.key === " " && !e.target.matches("button, a")) { e.preventDefault(); togglePause(); }
  });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("#scrim").addEventListener("click", () => document.body.classList.remove("nav-open"));

  /* ───────── router ───────── */
  const render = () => {
    const r = parseRoute();
    const changed = r.name !== state.route.name || r.id !== state.route.id;
    state.route = r;
    if (r.name === "lesson") {
      state.step = r.step;
      renderSidebar();
      renderLesson();
      document.title = `${LESSON[r.id].title} · Backend Atlas`;
    } else {
      renderSidebar();
      renderDjango();
      document.title = "Senior Django Questions · Backend Atlas";
    }
    document.body.classList.remove("nav-open");
    if (changed) window.scrollTo(0, 0);
  };
  window.addEventListener("hashchange", render);
  render();
})();
