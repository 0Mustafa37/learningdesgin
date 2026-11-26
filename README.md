# Backend Atlas

Revision site for backend interviews. Every topic is a step-by-step **3D animated walkthrough** (drag to rotate) with deep-dive notes, interview tips and sources.

- **System Design**: 40 lessons in 9 modules (foundations, scaling, data & storage, communication, reliability, architecture, security, shipping, whole-system designs).
- **Interview Problems**: 27 problems. 14 classics: dual write, duplicate requests, lost update, exactly-once, distributed locks, stale reads, clocks, split brain, thundering herd, hot partitions, retry storms, poison messages, backpressure, pagination. Plus senior (zero-downtime migrations, rollback safety, noisy neighbours, tail latency), team-lead (incidents, canaries and flags, error budgets, strangler migrations) and CTO problems (build vs buy, disaster recovery, cells, Conway's law, cloud costs).
- **Senior Django**: 30 questions, each with a 3D walkthrough, model answer, code, follow-ups and links to the official docs, plus a Q&A list with filters and a mock-interview drill.

No build step, but the 3D engine is an ES module, so serve the folder rather than opening `index.html` from disk:

```bash
python3 -m http.server 8000
```

## 3D engine

`engine3d.js` renders every walkthrough with [three.js](https://threejs.org) (vendored in `vendor/`, MIT). Units are drawn from their `kind`, connections become pipes, and each step's flows play as packets in order, with a trace underneath. Steps can opt into richer scenes: custom event timelines (`ev`), live instruments through an `fx(t, S)` function (metrics, ground tags, a worker pool, countdown rings, a circuit-breaker gate), plus `setup`, `code` and `note` for the side panel. `data/dsl.js` documents the fields; `timeouts-retries` in `data/sd-comm-reliability.js` uses all of them.

## Adding content

- `data/dsl.js` documents the compact lesson format.
- System design lessons: `data/sd-*.js`. Interview problems: `data/interview-problems.js` and `data/ip-leadership.js`. Course order: `data/curriculum.js`.
- Django questions: `data/django.js`. Their 3D scenes and references: `data/django-scenes.js`.
