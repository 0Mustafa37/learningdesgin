/* Tiny helpers so lesson files stay compact.
   Lesson: { id, title, sub, level, min, learn[], deep[], iv[], refs[[label,url]], mk[], nodes[], steps[] }
   Step:   { t: tag (problem|concept|case|recap), s: short label, h: heading, b: body (paragraphs split by blank line),
             k: key idea, f: "a>b:req, b>a:res" flows (req|res|sync|fail), a: "ids active", v: "ids visible" (default all), m: {metric: value} }
   Node kinds: client, user, server, worker, db, cache, queue, lb, edge, ext (guessed from id when omitted). */
window.LESSONS = window.LESSONS || {};
window.N = (id, label, x, y, kind) => ({ id, label, x, y, kind });
window.L = (o) => { window.LESSONS[o.id] = o; return o; };
