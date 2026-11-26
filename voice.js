/* Narration for lesson steps, and "Play as video" (auto-advancing, captioned).
   Uses generated Gemini audio from assets/voice/ when a file exists for the exact text, otherwise the browser's own voice. */
(() => {
  const A = window.ATLAS;
  if (!A) return;
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(16); };
  let manifest = {}, scripts = {};
  fetch("assets/voice/scripts.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).then((m) => { scripts = m; paintScript(); }).catch(() => {});
  const lang = () => (A.store.data.voiceLang === "ar" ? "ar" : "en");
  /* narration scripts (English + Egyptian Arabic) when they were written for the current version of the step */
  const scriptFor = (id, idx, en) => { const t = scripts[`${id}/${idx}`] || (window.SCRIPTS_GOLD || {})[`${id}/${idx}`]; return t && (!t.src || t.src === hash(en)) ? t : null; };
  const arNarration = (id, idx, en) => scriptFor(id, idx, en)?.ar || null;
  const paintScript = () => {
    const row = $(".vc-row"); if (!row || !cur.id) return;
    let d = $(".vc-script");
    const sc = scriptFor(cur.id, cur.idx, A.narration(cur.id, cur.idx));
    if (!sc) { d?.remove(); return; }
    if (!d) { d = document.createElement("details"); d.className = "vc-script"; row.after(d); }
    const ar = lang() === "ar"; d.dir = ar ? "rtl" : "ltr";
    d.innerHTML = `<summary>${ar ? "📜 الشرح الكامل" : "📜 Full explanation"}</summary><p ${ar ? 'dir="rtl" lang="ar"' : ""}></p>`;
    d.querySelector("p").textContent = ar ? sc.ar : sc.en;
  };
  /* the browser's own Arabic voices are robotic, except the neural ones (Edge: "Microsoft Salma/Shakir Online (Natural)") */
  const naturalArabic = () => synth && synth.getVoices().filter((v) => /^ar/i.test(v.lang) && /natural|online|neural/i.test(v.name)).sort((a, b) => /eg/i.test(b.lang) - /eg/i.test(a.lang))[0];
  fetch("assets/voice/manifest.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).then((m) => { manifest = m.files || {}; }).catch(() => {});
  const synth = window.speechSynthesis;
  const pickVoice = (lang) => {
    if (!synth) return null;
    const vs = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
    const rank = (v) => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google|microsoft|samantha|daniel/i.test(v.name) ? 2 : 0) + (/en-us|en-gb|ar-eg|ar-sa/i.test(v.lang) ? 1 : 0);
    return vs.sort((a, b) => rank(b) - rank(a))[0] || null;
  };
  synth?.addEventListener?.("voiceschanged", () => {});

  /* short MP4 clips (tools/make_clips.py) */
  let clips = {};
  fetch("assets/clips/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : {})).then((c) => { clips = c; addClipBadge(); }).catch(() => {});
  const addClipBadge = () => {
    const c = clips[cur.id], badges = document.querySelector(".title-row .badges");
    if (!c || !badges || badges.querySelector(".clip-badge")) return;
    const b = document.createElement("button"); b.className = "badge b-green clip-badge"; b.textContent = `🎬 ${c.secs}s clip`; b.title = "Watch a short video of this lesson";
    b.onclick = () => openClip(cur.id); badges.prepend(b);
  };
  const openClip = (id) => {
    window.VOICE.stop(); if (window.Stage3D && !window.Stage3D.isPaused()) window.Stage3D.togglePause();
    const d = document.createElement("dialog"); d.className = "clip-dialog";
    d.innerHTML = `<video controls autoplay playsinline preload="metadata" poster="assets/clips/${id}.jpg" src="assets/clips/${id}.mp4"></video><form method="dialog"><button class="btn">Close</button></form>`;
    d.addEventListener("close", () => d.remove()); document.body.appendChild(d); d.showModal();
  };
  let warned = false;
  let cur = { id: null, idx: -1 }, mode = null, token = 0, audio = null, stepStart = 0;
  const $ = (s) => document.querySelector(s);
  const sentences = (t) => t.match(/[^.!?]+[.!?]+["”)]?\s*|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) || [t];

  const caption = (text) => {
    const slot = $("#stageSlot .s3-fig") || $("#stageSlot"); if (!slot) return;
    let c = slot.querySelector(".vc-cap");
    if (!c) { c = document.createElement("div"); c.className = "vc-cap"; c.setAttribute("aria-live", "polite"); slot.appendChild(c); }
    c.textContent = text || ""; c.classList.toggle("show", !!text);
    c.dir = /[؀-ۿ]/.test(text || "") ? "rtl" : "ltr";
  };
  const stopAll = () => { token++; synth?.cancel(); if (audio) { audio.pause(); audio = null; } caption(""); };
  const paintButtons = () => {
    const say = $("#vcSay"), watch = $("#vcWatch"), lg = $("#vcLang");
    if (lg) { lg.textContent = lang() === "ar" ? "الصوت: مصري" : "Voice: English"; lg.dir = lang() === "ar" ? "rtl" : "ltr"; lg.setAttribute("aria-label", "Narration language"); }
    if (say) { say.textContent = mode === "say" ? "■ Stop" : "🔊 Listen"; say.setAttribute("aria-pressed", mode === "say"); }
    if (watch) { watch.textContent = mode === "watch" ? "■ Stop video" : "▶ Play as video"; watch.setAttribute("aria-pressed", mode === "watch"); watch.classList.toggle("btn-primary", mode === "watch"); }
    document.body.classList.toggle("vc-watching", mode === "watch");
  };

  /* speak one piece of text; resolves when finished (or cancelled) */
  const speak = (text, key, lang, my) => new Promise((done) => {
    const file = manifest[key];
    if (file && file.h === hash(text)) {
      audio = new Audio(`assets/voice/${file.f}`);
      const parts = sentences(text), total = text.length;
      audio.ontimeupdate = () => { if (my !== token || !audio) return; const at = (audio.currentTime / (audio.duration || 1)) * total; let acc = 0; caption(parts.find((p) => (acc += p.length + 1) >= at) || parts[parts.length - 1]); };
      audio.onended = audio.onerror = () => done();
      audio.play().catch(() => { audio = null; browserSpeak(text, lang, my).then(done); });
      return;
    }
    browserSpeak(text, lang, my).then(done);
  });
  const browserSpeak = async (text, lang, my) => {
    if (lang === "ar" && !naturalArabic()) { // no robot voice for Arabic: captions only
      for (const p of sentences(text)) { if (my !== token) return; caption(p); await new Promise((r) => setTimeout(r, 70 * p.length + 600)); }
      return;
    }
    if (!synth) { for (const p of sentences(text)) { if (my !== token) return; caption(p); await new Promise((r) => setTimeout(r, 60 * p.length)); } return; }
    const voice = lang === "ar" ? naturalArabic() : pickVoice(lang);
    for (const p of sentences(text)) {
      if (my !== token) return;
      caption(p);
      const t0 = performance.now();
      await new Promise((r) => { const u = new SpeechSynthesisUtterance(p); if (voice) u.voice = voice; u.lang = voice ? voice.lang : lang === "ar" ? "ar-EG" : "en-US"; u.rate = 1; u.onend = u.onerror = () => r(); synth.speak(u); setTimeout(r, 400 + p.length * 120); });
      /* no voice installed (speech ends at once): keep the caption up long enough to read */
      const left = p.length * 55 - (performance.now() - t0);
      if (left > 0 && my === token) await new Promise((r) => setTimeout(r, left));
    }
  };

  const playStep = async () => {
    const my = ++token; synth?.cancel(); if (audio) { audio.pause(); audio = null; }
    const { id, idx } = cur, base = A.narration(id, idx), en = scriptFor(id, idx, base)?.en || base, ar = lang() === "ar" ? arNarration(id, idx, base) : null;
    stepStart = performance.now();
    window.Stage3D?.replay();
    if (ar) await speak(ar, `${id}/${idx}/ar`, "ar", my);
    else if (lang() === "ar") {
      /* no Egyptian version of this step yet: say so once, then use English */
      if (!warned) { warned = true; caption("الصوت المصري للخطوة دي لسه بيتجهز، هنسمعها بالإنجليزي دلوقتي."); await new Promise((r) => setTimeout(r, 2600)); }
      if (my === token) await speak(en, `${id}/${idx}`, "en", my);
    } else await speak(en, `${id}/${idx}`, "en", my);
    if (my !== token) return;
    if (mode === "watch") {
      const minShow = 6000 - (performance.now() - stepStart);
      await new Promise((r) => setTimeout(r, Math.max(900, minShow)));
      if (my !== token || mode !== "watch") return;
      const c = A.current();
      if (c && c.idx < c.n - 1) { autoNav = true; A.goStep(c.idx + 1); return; }
      caption("End of lesson."); setTimeout(() => my === token && caption(""), 2500);
    }
    mode = null; paintButtons();
  };

  let autoNav = false;
  window.VOICE = {
    bind(id, idx) {
      const moved = id !== cur.id || idx !== cur.idx;
      cur = { id, idx };
      if (moved && mode && !autoNav) { mode = null; stopAll(); }
      const wasAuto = autoNav; autoNav = false;
      paintButtons(); addClipBadge(); paintScript();
      $("#vcLang")?.addEventListener("click", () => { A.store.data.voiceLang = lang() === "ar" ? "en" : "ar"; A.store.save(); paintButtons(); paintScript(); if (mode) playStep(); });
      $("#vcSay")?.addEventListener("click", () => { if (mode) { mode = null; stopAll(); paintButtons(); return; } mode = "say"; paintButtons(); playStep(); });
      $("#vcWatch")?.addEventListener("click", () => { if (mode === "watch") { mode = null; stopAll(); paintButtons(); return; } mode = "watch"; paintButtons(); $("#stageSlot")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); playStep(); });
      if (wasAuto && mode === "watch") requestAnimationFrame(playStep);
    },
    stop() { mode = null; stopAll(); paintButtons(); },
  };
  { const c = A.current(); if (c) window.VOICE.bind(c.id, c.idx); } // the first lesson may have rendered before this script ran
  window.addEventListener("hashchange", () => { if (!location.hash.startsWith("#/lesson/") && mode) { mode = null; stopAll(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && mode) { mode = null; stopAll(); paintButtons(); } });
})();
