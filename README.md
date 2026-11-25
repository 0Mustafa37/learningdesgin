# Backend Atlas

Revision site for backend interviews. Every topic is a step-by-step **3D animated walkthrough** (drag to rotate) with deep-dive notes, interview tips and sources.

- **System Design**: 40 lessons in 9 modules (foundations, scaling, data & storage, communication, reliability, architecture, security, shipping, whole-system designs).
- **Interview Problems**: 14 classic problems: dual write, duplicate requests, lost update, exactly-once, distributed locks, stale reads, clocks, split brain, thundering herd, hot partitions, retry storms, poison messages, backpressure, pagination.
- **Senior Django**: 30 questions, each with a 3D walkthrough, model answer, code, follow-ups and links to the official docs, plus a Q&A list with filters and a mock-interview drill.

No build step. Open `index.html` or serve the folder:

```bash
python3 -m http.server 8000
```

## Adding content

- `data/dsl.js` documents the compact lesson format.
- System design lessons: `data/sd-*.js`. Interview problems: `data/interview-problems.js`. Course order: `data/curriculum.js`.
- Django questions: `data/django.js`. Their 3D scenes and references: `data/django-scenes.js`.
