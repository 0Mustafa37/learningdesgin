# Backend Atlas

Revision site for backend interviews, with a home page, a timed practice mode (`#/practice`) and offline support. Every topic is a step-by-step **3D animated walkthrough** (drag to rotate) with deep-dive notes, interview tips and sources.

- **System Design**: 45 lessons in 11 modules (foundations, scaling, data & storage, communication, reliability, architecture, security, shipping, whole-system designs, data-intensive patterns, designs from the field).
- **Interview Problems**: 27 problems. 14 classics: dual write, duplicate requests, lost update, exactly-once, distributed locks, stale reads, clocks, split brain, thundering herd, hot partitions, retry storms, poison messages, backpressure, pagination. Plus senior (zero-downtime migrations, rollback safety, noisy neighbours, tail latency), team-lead (incidents, canaries and flags, error budgets, strangler migrations) and CTO problems (build vs buy, disaster recovery, cells, Conway's law, cloud costs).
- **Senior Django**: 30 questions, each with a 3D walkthrough, model answer, code, follow-ups and links to the official docs, plus a Q&A list with filters and a mock-interview drill.
- **Try it labs** on 10 lessons: Timeouts & Retries, Rate Limiting, Caching, Load Balancing, Sharding, Message Queues, Retry Storms, Indexes (a PostgreSQL `EXPLAIN ANALYZE` lab), Django N+1 and connection pooling. Change the setup and a small simulation replays the scene with your settings. `data/labs.js`, `data/labs2.js`.
- **Draw it yourself** (`#/draw`): 9 design problems on a board, checked against a rubric of required parts, connections and red flags, with a model answer to compare. `draw.js`.
- **Today** (`#/today`): spaced-repetition review of finished lessons, weak practice answers and Django questions marked "review later" (Leitner boxes: 1, 2, 4, 8, 16, 32 days).
- **Listen and Play as video**: every step can be read aloud (🔊), and "Play as video" runs the lesson by itself with captions. Audio comes from Gemini TTS when generated (see below), otherwise from the browser's voice. `voice.js`.
- **Voice answers** in Practice: answer out loud, see the transcript, and the checklist points you covered are ticked for you (Chrome, Edge, Safari).
- **Clips**: short captioned MP4s of showcase lessons, rendered from the live scene by `tools/make_clips.py`.
- **Arabic key ideas** for every System Design step (toggle "عربي" on the key idea). `data/ar-keys.js`.
- **Progress sync** (optional): a Django + DRF service in `sync-api/`. Off until the `atlas-sync` meta tag in `index.html` points at a deployed copy.

No build step, but the 3D engine is an ES module, so serve the folder rather than opening `index.html` from disk:

```bash
python3 -m http.server 8000
```

## Narration (Gemini voices)

1. Create a key at [Google AI Studio](https://aistudio.google.com/apikey).
2. In the repo: Settings → Secrets and variables → Actions → New repository secret, name `GEMINI_API_KEY`.
3. Actions → **voices** → Run workflow (pick a voice such as Kore, Charon, Puck or Aoede).

`tools/make_voices.py` reads the narration text from the site, calls `gemini-3.1-flash-tts-preview`, saves MP3s in `assets/voice/` with a hash of the text, and commits them. It resumes where it stopped and runs daily, so free-tier quotas are fine. Edited steps are re-voiced automatically. After voices exist, re-run `tools/make_clips.py` to put narration into the clips.

## Checks

`.github/workflows/checks.yml` runs on every pull request: syntax, `node tests/data.test.js` (every lab with every control combination, every draw model against its rubric), `python tests/sweep.py` (opens every lesson step in headless Chrome and fails on any console error) and the sync-api tests.

## 3D engine

`engine3d.js` renders every walkthrough with [three.js](https://threejs.org) (vendored in `vendor/`, MIT). Units are drawn from their `kind`, connections become pipes, and each step's flows play as packets in order, with a trace underneath. Steps can opt into richer scenes: custom event timelines (`ev`), live instruments through an `fx(t, S)` function (metrics, ground tags, a worker pool, countdown rings, a circuit-breaker gate), plus `setup`, `code` and `note` for the side panel. `data/dsl.js` documents the fields; `timeouts-retries` in `data/sd-comm-reliability.js` uses all of them.

## Adding content

- `data/dsl.js` documents the compact lesson format. `data/labs.js` documents the lab format.
- System design lessons: `data/sd-*.js`. Interview problems: `data/interview-problems.js` and `data/ip-leadership.js`. Course order: `data/curriculum.js`.
- Django questions: `data/django.js`. Their 3D scenes and references: `data/django-scenes.js`.
