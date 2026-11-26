/* Tiny helpers so lesson files stay compact.
   Lesson: { id, title, sub, level, min, learn[], deep[], iv[], refs[[label,url]], mk[], nodes[], steps[] }
   Step:   { t: tag (problem|concept|case|recap), s: short label, h: heading, b: body (paragraphs split by blank line),
             k: key idea, f: "a>b:req, b>a:res" flows (req|res|sync|fail), a: "ids active", v: "ids visible" (default all), m: {metric: value} }
   Node kinds: client, user, server, worker, db, cache, queue, lb, edge, ext (guessed from id when omitted).
   N(id, label, x, y, kind, info) — info is an optional HTML tooltip for the unit.

   Optional step fields for richer 3D scenes (engine3d.js):
     ev:    custom timeline instead of playing f in order. Each event: { f, t, k, at, dur } in ms, plus optional
            endAt (0–1, where the packet stops), hold (ms to wait there), end: "pop" (fails with ✕) | "fade",
            popKind (colour when it pops), log (trace text, or false), done (trace text when it pops), tone (ok|warn|bad).
     L:     loop length in ms for ev.
     fx:    (t, S) => {}  called every frame with the loop clock. S.metric(icon, label, value, tone),
            S.tag(nodeId | "mid", text, tone, icon, progress0to1), S.pool(nodeId, ["idle"|"busy"|"stuck"|"free"…]),
            S.ring(nodeId, progress0to1, "--css-colour-var"), S.gate("CLOSED" | "OPEN" | "HALF-OPEN").
     gate:  "a>b" puts a circuit-breaker gate on that pipe (driven by S.gate).
     g:     static ground tags: { nodeId: [text, tone, icon] }.
     setup: [[label, value, "hi"|"bad"]] table in the side panel.  code / note: snippet + caveat in the side panel. */
window.LESSONS = window.LESSONS || {};
window.N = (id, label, x, y, kind, info) => ({ id, label, x, y, kind, info });
window.L = (o) => { window.LESSONS[o.id] = o; return o; };
