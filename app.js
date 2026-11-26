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
  /* "Try it" lab: an extra last step rebuilt from the controls in the side panel */
  const labStep = (lab, params) => ({ ...normStep({ t: "lab", s: "Try it", h: lab.h, b: lab.b, ...lab.make(params) }), lab, params });
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
    steps: l.steps.map(normStep).concat((window.LABS || {})[l.id] ? [labStep(window.LABS[l.id], Object.fromEntries(window.LABS[l.id].controls.map((c) => [c.id, c.def])))] : []),
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

  window.ATLAS = { store, rerender: () => window.dispatchEvent(new HashChangeEvent("hashchange")) };

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
    if (parts[0] === "practice") return { name: "practice" };
    if (parts[0] === "draw" && window.DRAW) return { name: "draw", id: parts[1] };
    if (!parts.length || parts[0] === "home") return { name: "home" };
    if (parts[0] === "lesson" && LESSON[parts[1]] && LESSON[parts[1]].track) return { name: "lesson", id: parts[1], step: Number(parts[2]) || 0 };
    return { name: "lesson", id: ORDER[0], step: 0 };
  };

  /* ───────── sidebar ───────── */
  const isDone = (id) => !!store.data.lessons[id];
  const renderSidebar = () => {
    const current = state.route.name === "lesson" && LESSON[state.route.id]?.module ? LESSON[state.route.id] : null;
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
    const top = `<nav class="side-top"><a class="${state.route.name === "home" ? "active" : ""}" href="#/">${ico("home")}Home</a><a class="${state.route.name === "practice" ? "active" : ""}" href="#/practice">${ico("timer")}Practice</a><a class="${state.route.name === "draw" ? "active" : ""}" href="#/draw">${ico("target")}Draw</a></nav>`;
    $("#sidebar").innerHTML = top + html + `
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
  window.addEventListener("stage3d-ready", () => { if (pendingStage && (state.route.name === "lesson" || state.route.name === "home")) mountStage(...pendingStage); pendingStage = null; });
  const ICONS = { clock: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6v6l4 2", bars: "M4 20v-2M9 20v-6M14 20v-10M19 20V4", steps: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01", copy: "M9 9h11v11H9zM5 15H4V4h11v1", check: "M4 12l5 5L20 6", link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", play: "M7 4l13 8-13 8z", timer: "M10 2h4M12 14l3-3M12 6a8 8 0 1 0 0 16a8 8 0 1 0 0-16z", target: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z", home: "M3 11l9-8 9 8M5 10v10h14V10" };
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
    store.data.last = { id: lesson.id, step: stepIdx }; store.save();
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
        <div class="lesson-extra">${q ? `
        <div class="card detail-card">
          <div class="detail-head"><h3>Model answer</h3>${markButtons(q)}</div>
          ${answerHtml(q)}
          ${refsHtml(lesson.refs)}
        </div>` : `
        <div class="detail-grid">
          ${lesson.deep.length ? `<div class="card detail-card"><h3>Deep dive</h3><ul class="deep">${lesson.deep.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
          ${lesson.iv.length ? `<div class="card detail-card iv"><h3>In the interview</h3><ul class="deep">${lesson.iv.map((d) => `<li>${d}</li>`).join("")}</ul></div>` : ""}
        </div>
        ${lesson.refs.length ? `<div class="card detail-card">${refsHtml(lesson.refs)}</div>` : ""}`}</div>
      </section>`;

    const nextLabel = next ? `Next: ${esc(next.short)} →` : nextLessonId ? `Next: ${esc(LESSON[nextLessonId].title)} →` : `Django Q&amp;A →`;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>STEP ${stepIdx + 1} / ${lesson.steps.length}</span><span class="tag ${step.tag}">${step.tag}</span></div>
        <h2>${esc(step.title)}</h2>
        ${step.body.map((p) => `<p>${p}</p>`).join("")}
        ${step.key ? `<div class="key-idea"><small>KEY IDEA</small>${esc(step.key)}</div>` : ""}
        ${step.lab ? `<div class="sec">CHANGE THE SETUP</div><div class="lab">${step.lab.controls.map((c) => `<div class="lab-row"><span>${esc(c.label)}</span><div class="seg" role="group" aria-label="${esc(c.label)}">${c.opts.map(([lbl, v], i) => `<button class="${step.params[c.id] === v ? "on" : ""}" data-lc="${c.id}" data-li="${i}" aria-pressed="${step.params[c.id] === v}">${esc(lbl)}</button>`).join("")}</div></div>`).join("")}</div>` : ""}
        ${step.setup ? `<div class="sec">${step.lab ? "WHAT HAPPENED" : "THE SETUP"}</div><div class="setup">${step.setup.map(([k, v, c]) => `<div class="${c || ""}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
        ${step.code ? `<div class="sec">IN CODE <button class="btn copy" id="copyCode">${ico("copy")}Copy</button></div><pre class="code"><code>${highlight(step.code)}</code></pre>${step.note ? `<p class="code-note">${esc(step.note)}</p>` : ""}` : ""}
        <div class="nav-row">
          <button class="btn" id="backBtn" ${stepIdx === 0 ? "disabled" : ""}>← Back</button>
          <button class="btn btn-primary" id="nextBtn">${nextLabel}</button>
        </div>
        <div class="hint"><kbd>←</kbd><kbd>→</kbd> step · <kbd>Space</kbd> pause · <kbd>R</kbd> replay · <kbd>V</kbd> reset view</div>
        <button class="btn link-btn" id="copyLink">${ico("link")}Copy link to this step</button>
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

    /* narrow screens: step panel right under the stage, reading material after it */
    if (matchMedia("(max-width: 1180px)").matches) { const x = $("#main .lesson-extra"); if (x) $("#aside").append(x); }
    mountStage(lesson, stepIdx);
    $("#copyLink").onclick = async (ev) => { const b = ev.currentTarget, url = location.href.split("#")[0] + `#/lesson/${lesson.id}/${stepIdx}`; try { await navigator.clipboard.writeText(url); b.innerHTML = ico("check") + "Link copied"; } catch (_) { b.textContent = url; } };
    const cp = $("#copyCode");
    if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(step.code); cp.innerHTML = ico("check") + "Copied"; } catch (_) { cp.textContent = "Select the code to copy"; } };
    $("#backBtn").onclick = () => goStep(stepIdx - 1);
    $("#nextBtn").onclick = () => {
      if (next) goStep(stepIdx + 1);
      else location.hash = nextLessonId ? `#/lesson/${nextLessonId}` : "#/django";
    };
    $$(".step-dot").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.step))));
    $$("[data-lc]").forEach((b) => (b.onclick = () => {
      const c = step.lab.controls.find((x) => x.id === b.dataset.lc), params = { ...step.params, [c.id]: c.opts[Number(b.dataset.li)][1] };
      lesson.steps[stepIdx] = labStep(step.lab, params);
      renderLesson(); stage()?.restep(lesson);
      const again = $(`[data-lc="${c.id}"][data-li="${b.dataset.li}"]`); if (again) again.focus();
    }));
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
    const extra = l.steps.map((s) => (s.code || "") + " " + (s.setup || []).flat().join(" ") + " " + (s.note || "")).join(" ") + " " + strip(l.iv.join(" ")) + " " + l.level;
    return { title: l.qa ? l.qa.q : l.title, sub: `${l.track.title} · ${l.module.title} · ${l.level}`, href: `#/lesson/${id}`, hay: (l.title + " " + l.subtitle + " " + l.steps.map((s) => s.title + " " + strip(s.body.join(" "))).join(" ") + " " + strip(l.deep.join(" ")) + qa + " " + extra).toLowerCase() };
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


  /* ───────── home ───────── */
  const SHOWCASE = "timeouts-retries";
  const renderHome = () => {
    $("#layout").classList.add("wide");
    const steps = ORDER.reduce((a, id) => a + LESSON[id].steps.length, 0);
    const last = store.data.last && LESSON[store.data.last.id] ? store.data.last : null;
    const done = ORDER.filter(isDone).length;
    $("#main").innerHTML = `
      <section class="card home-hero">
        <span class="badge b-violet">${ico("target")}Backend interview prep · system design · Django</span>
        <h1>Learn backend systems by watching them run.</h1>
        <p>${ORDER.length} animated 3D walkthroughs and ${steps} steps, from how a request travels to what a CTO weighs when a region goes down. Every lesson shows the traffic, the numbers, the trace and the code.</p>
        <div class="home-cta">
          <a class="btn btn-primary" href="#/lesson/${last ? `${last.id}/${last.step}` : ORDER[0]}">${ico("play")}${last ? `Continue: ${esc(LESSON[last.id].title)}` : "Start with lesson 1"}</a>
          <a class="btn" href="#/practice">${ico("timer")}Practice an interview</a>
          <a class="btn" href="#/django">Django Q&amp;A</a>
        </div>
        <div id="stageSlot" class="stage-slot home-stage"></div>
        <p class="home-cap">Live: the circuit-breaker step of <a href="#/lesson/${SHOWCASE}/3">Timeouts &amp; Retries</a>. Drag to rotate, hover a unit.</p>
      </section>
      <section class="home-tracks">
        ${TRACKS.map((t) => { const ids = t.modules.flatMap((m) => m.lessons); const d = ids.filter(isDone).length; return `
          <div class="card home-track">
            <div class="ht-head"><h2>${esc(t.title)}</h2><span>${d} / ${ids.length}</span></div>
            <div class="bar"><i style="width:${(d / Math.max(1, ids.length)) * 100}%"></i></div>
            <ul>${t.modules.map((m) => `<li><span class="folder" style="background:${m.color}"></span><a href="#/lesson/${m.lessons[0]}">${esc(m.title)}</a><small>${m.lessons.length}</small></li>`).join("")}</ul>
          </div>`; }).join("")}
      </section>`;
    $("#aside").innerHTML = `
      <section class="card panel">
        <div class="panel-top"><span>YOUR PROGRESS</span></div>
        <p class="home-big">${done}<small> / ${ORDER.length} lessons</small></p>
        <div class="bar"><i style="width:${(done / ORDER.length) * 100}%"></i></div>
        ${practiceSummary()}
        <div id="syncSlot"></div>
      </section>
      <section class="card panel">
        <div class="panel-top"><span>HOW TO USE IT</span></div>
        <ol class="how-list"><li>Watch a walkthrough step by step with the arrow keys.</li><li>Read the trace and the code for each step.</li><li>Answer it out loud in practice mode, then grade yourself.</li></ol><a class="btn" href="#/practice">Open practice mode</a> <a class="btn" href="#/draw">Draw a design yourself</a>
      </section>`;
    window.SYNC?.mount($("#syncSlot"));
    const l = LESSON[SHOWCASE];
    if (l) mountStage(l, 3);
  };

  /* ───────── practice mode ───────── */
  const LEVELS = ["Beginner", "Intermediate", "Advanced", "Senior", "Staff", "Lead", "CTO"];
  const pr = { level: "all", track: "all", minutes: 5, id: null, phase: "ready", t0: 0, timer: 0, checks: new Set(), session: null, elapsed: 0 };
  store.data.practice = store.data.practice || {};
  const practicePool = () => ORDER.filter((id) => { const l = LESSON[id]; return (pr.level === "all" || l.level === pr.level) && (pr.track === "all" || l.track.id === pr.track); });
  const pickPractice = () => {
    const pool = practicePool(); if (!pool.length) { pr.id = null; return; }
    const P = store.data.practice, unseen = pool.filter((id) => !P[id] && id !== pr.id), weak = pool.filter((id) => P[id] && P[id].grade !== "good" && id !== pr.id);
    const from = unseen.length && Math.random() < 0.7 ? unseen : weak.length ? weak : pool.filter((id) => id !== pr.id).length ? pool.filter((id) => id !== pr.id) : pool;
    pr.id = from[Math.floor(Math.random() * from.length)]; pr.phase = "ready"; pr.checks = new Set();
  };
  const startSession = (n) => {
    const pool = practicePool(), P = store.data.practice;
    const shuffled = pool.map((id) => [id, (P[id] ? (P[id].grade === "good" ? 2 : 1) : 0) + Math.random()]).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    const ids = shuffled.slice(0, Math.min(n, shuffled.length));
    if (!ids.length) return;
    pr.session = { ids, idx: 0, results: [] }; pr.id = ids[0]; pr.phase = "ready"; pr.checks = new Set();
  };
  const recordSession = (grade, covered) => {
    const S = pr.session; S.results.push({ id: pr.id, grade, covered, elapsed: pr.elapsed || 0 });
    S.idx++;
    if (S.idx < S.ids.length) { pr.id = S.ids[S.idx]; pr.phase = "ready"; pr.checks = new Set(); }
    else pr.phase = "summary";
  };
  const sessionSummary = () => {
    const S = pr.session, c = { good: 0, partly: 0, missed: 0 };
    S.results.forEach((r) => (c[r.grade] = (c[r.grade] || 0) + 1));
    const total = S.results.reduce((a, r) => a + r.elapsed, 0);
    return `<section class="card pr-card">
      <div class="crumbs">Mock interview · ${S.results.length} questions · ${fmt(total)} answering</div>
      <h1 class="pr-q">${c.good === S.results.length ? "Clean sweep." : c.good >= S.results.length / 2 ? "Solid round. Close the gaps below." : "Worth another pass on these topics."}</h1>
      <div class="pr-grades"><span class="g-good">${c.good} nailed</span><span class="g-partly">${c.partly} partly</span><span class="g-missed">${c.missed} missed</span></div>
      <table class="pr-table"><thead><tr><th>Question</th><th>Level</th><th>Time</th><th>Checklist</th><th>Grade</th></tr></thead><tbody>
      ${S.results.map((r) => { const l = LESSON[r.id]; return `<tr><td><a href="#/lesson/${r.id}">${esc(l.qa ? l.qa.q : l.title)}</a></td><td>${esc(l.level)}</td><td>${fmt(r.elapsed)}</td><td>${Math.round(r.covered * 100)}%</td><td><small class="g-${r.grade}">${r.grade}</small></td></tr>`; }).join("")}
      </tbody></table>
      <div class="pr-grade" style="margin-top:14px"><button class="btn btn-primary" id="prAgain">${ico("timer")}Another mock</button><button class="btn" id="prEnd">Back to single questions</button></div>
    </section>`;
  };
  const promptFor = (l) => l.qa ? l.qa.q : l.track.id === "ip" ? `${l.subtitle} Walk me through how you'd handle it.` : `Explain ${l.title.toLowerCase()}: ${l.subtitle}`;
  const checklistFor = (l) => { const keys = l.steps.map((s) => s.key).filter(Boolean); return [...new Set([...(l.learn.length ? l.learn : []), ...keys])].slice(0, 8); };
  const practiceSummary = () => {
    const P = store.data.practice, vals = Object.entries(P);
    if (!vals.length) return `<p class="muted-s">No practice answers yet. <a href="#/practice">Try one</a>.</p>`;
    const c = { good: 0, partly: 0, missed: 0 }; vals.forEach(([, v]) => (c[v.grade] = (c[v.grade] || 0) + 1));
    return `<div class="pr-grades"><span class="g-good">${c.good} nailed</span><span class="g-partly">${c.partly} partly</span><span class="g-missed">${c.missed} missed</span></div>`;
  };
  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const renderPractice = () => {
    stage()?.detach(); clearInterval(pr.timer);
    $("#layout").classList.add("wide");
    if (!pr.session && (!pr.id || !LESSON[pr.id] || !practicePool().includes(pr.id))) pickPractice();
    const l = pr.id && LESSON[pr.id];
    const tracks = TRACKS.map((t) => `<option value="${t.id}" ${pr.track === t.id ? "selected" : ""}>${esc(t.title)}</option>`).join("");
    const levels = LEVELS.filter((lv) => ORDER.some((id) => LESSON[id].level === lv)).map((lv) => `<button class="chip ${pr.level === lv ? "on" : ""}" data-lv="${lv}">${lv}</button>`).join("");
    const list = l ? checklistFor(l) : [];
    if (pr.phase === "summary" && pr.session) {
      $("#main").innerHTML = sessionSummary(); $("#aside").innerHTML = practiceAside();
      $("#prAgain").onclick = () => { startSession(pr.session.ids.length); renderPractice(); };
      $("#prEnd").onclick = () => { pr.session = null; pickPractice(); renderPractice(); };
      return;
    }
    $("#main").innerHTML = `
      <section class="card pr-card">
        <div class="pr-filters"><button class="chip ${pr.level === "all" ? "on" : ""}" data-lv="all">All levels</button>${levels}
          <select id="prTrack" aria-label="Track"><option value="all">All tracks</option>${tracks}</select>
          <select id="prMin" aria-label="Time limit">${[3, 5, 10, 20].map((m) => `<option value="${m}" ${pr.minutes === m ? "selected" : ""}>${m} min</option>`).join("")}</select>
          ${pr.session ? `<span class="pr-session">Mock interview · question ${pr.session.idx + 1} of ${pr.session.ids.length}</span><button class="chip" id="prQuit">End mock</button>` : `<button class="chip pr-mock" data-mock="3">Mock: 3 questions</button><button class="chip pr-mock" data-mock="5">Mock: 5 questions</button>`}</div>
        ${l ? `
        <div class="crumbs">${esc(l.track.title)} / ${esc(l.module.title)} · <span class="badge">${esc(l.level)}</span></div>
        <h1 class="pr-q">${esc(promptFor(l))}</h1>
        <div class="pr-timer ${pr.phase}"><span id="prClock">${pr.phase === "review" ? fmt(pr.elapsed) : fmt(pr.minutes * 60000)}</span>${pr.phase === "review" ? `<span class="muted-s">your answer took ${fmt(pr.elapsed)} of ${pr.minutes}:00</span>` : ""}
          ${pr.phase === "ready" ? `<button class="btn btn-primary" id="prStart">${ico("timer")}Start answering out loud</button>` : ""}
          ${pr.phase === "answer" ? `<button class="btn btn-primary" id="prReveal">I'm done: show the checklist</button>` : ""}
          <button class="btn" id="prSkip">Skip</button></div>
        ${pr.phase === "review" ? `
          <div class="sec">DID YOU COVER…</div>
          <ul class="pr-checks">${list.map((x, i) => `<li><label><input type="checkbox" data-ci="${i}" ${pr.checks.has(i) ? "checked" : ""}> ${esc(x)}</label></li>`).join("")}</ul>
          ${l.qa ? `<div class="key-idea"><small>ONE-LINE ANSWER</small>${esc(l.qa.short)}</div>` : ""}
          ${l.iv.length ? `<div class="sec">WHAT INTERVIEWERS LISTEN FOR</div><ul class="deep">${l.iv.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
          <div class="sec">GRADE YOURSELF</div>
          <div class="pr-grade"><button class="btn g-good" data-g="good">${ico("check")}Nailed it</button><button class="btn g-partly" data-g="partly">Partly</button><button class="btn g-missed" data-g="missed">Missed it</button>
            <a class="btn" href="#/lesson/${l.id}">${ico("play")}Watch the walkthrough</a></div>` : `<p class="muted-s">Answer as if you were in the interview: say it out loud, draw it on paper, and mention trade-offs. Then compare against the checklist.</p>`}
        ` : `<p>No lessons match these filters.</p>`}
      </section>`;
    $("#aside").innerHTML = practiceAside();
    $$("[data-lv]").forEach((b) => (b.onclick = () => { pr.level = b.dataset.lv; pr.id = null; pr.session = null; renderPractice(); }));
    $("#prTrack").onchange = (e) => { pr.track = e.target.value; pr.id = null; renderPractice(); };
    $("#prMin").onchange = (e) => { pr.minutes = Number(e.target.value); renderPractice(); };
    $("#prSkip")?.addEventListener("click", () => { if (pr.session) { pr.elapsed = pr.phase === "answer" ? Date.now() - pr.t0 : 0; recordSession("missed", 0); } else pickPractice(); renderPractice(); });
    $$("[data-mock]").forEach((b) => (b.onclick = () => { startSession(Number(b.dataset.mock)); renderPractice(); }));
    $("#prQuit")?.addEventListener("click", () => { pr.session = null; pickPractice(); renderPractice(); });
    $("#prStart")?.addEventListener("click", () => { pr.phase = "answer"; pr.t0 = Date.now(); renderPractice(); });
    $("#prReveal")?.addEventListener("click", () => { pr.phase = "review"; pr.elapsed = Date.now() - pr.t0; renderPractice(); });
    $$("[data-ci]").forEach((c) => (c.onchange = () => { const i = Number(c.dataset.ci); c.checked ? pr.checks.add(i) : pr.checks.delete(i); }));
    $$("[data-g]").forEach((b) => (b.onclick = () => {
      const covered = list.length ? pr.checks.size / list.length : 0;
      store.data.practice[pr.id] = { grade: b.dataset.g, at: Date.now(), covered }; store.save();
      if (pr.session) recordSession(b.dataset.g, covered); else pickPractice();
      renderPractice();
    }));
    if (pr.phase === "answer") {
      const tick = () => { if (state.route.name !== "practice") return clearInterval(pr.timer); const left = pr.minutes * 60000 - (Date.now() - pr.t0); const el = $("#prClock"); if (el) { el.textContent = left > 0 ? fmt(left) : "time"; el.classList.toggle("over", left <= 0); } };
      tick(); pr.timer = setInterval(tick, 250);
    }
  };
  const practiceAside = () => {
    const P = store.data.practice, rows = Object.entries(P).filter(([id]) => LESSON[id]);
    const weak = rows.filter(([, v]) => v.grade !== "good").sort((a, b) => b[1].at - a[1].at).slice(0, 8);
    const byLevel = LEVELS.map((lv) => { const ids = ORDER.filter((id) => LESSON[id].level === lv); if (!ids.length) return ""; const g = ids.filter((id) => P[id]?.grade === "good").length; return `<div>${lv} <span style="float:right;color:var(--muted)">${g}/${ids.length}</span><div class="bar"><i style="width:${(g / ids.length) * 100}%"></i></div></div>`; }).join("");
    return `<section class="card panel"><div class="panel-top"><span>YOUR PRACTICE</span></div>${practiceSummary()}
        <div class="panel-top" style="margin-top:14px"><span>NAILED, BY LEVEL</span></div><div class="cat-bars">${byLevel}</div></section>
      <section class="card panel"><div class="panel-top"><span>REVISIT THESE</span></div>
        ${weak.length ? `<ul class="learn-list">${weak.map(([id, v]) => `<li><a href="#/lesson/${id}">${esc(LESSON[id].title)}</a> <small class="g-${v.grade}">${v.grade}</small></li>`).join("")}</ul>` : `<p class="muted-s">Topics you grade "partly" or "missed" show up here.</p>`}
        ${rows.length ? `<button class="btn" id="prReset">Reset practice history</button>` : ""}</section>`;
  };
  document.addEventListener("click", (e) => { if (e.target.id === "prReset" && confirmReset()) { store.data.practice = {}; store.save(); renderPractice(); } });
  let resetArmed = 0;
  const confirmReset = () => { const b = $("#prReset"); if (Date.now() - resetArmed < 4000) return true; resetArmed = Date.now(); if (b) b.textContent = "Click again to reset"; return false; };

  /* ───────── offline support ───────── */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

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
    } else if (r.name === "home") {
      renderSidebar(); renderHome();
      document.title = "Backend Atlas · 3D backend interview prep";
    } else if (r.name === "draw") {
      renderSidebar(); stage()?.detach(); clearInterval(pr.timer); $("#layout").classList.remove("wide");
      window.DRAW.render($("#main"), $("#aside"), r.id);
      document.title = "Draw it yourself · Backend Atlas";
    } else if (r.name === "practice") {
      renderSidebar(); renderPractice();
      document.title = "Practice · Backend Atlas";
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
