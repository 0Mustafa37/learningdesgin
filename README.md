# Backend Atlas

A static learning site with two parts:

- **System Design**: animated, step-by-step lessons (request anatomy, latency and throughput, load balancing, caching, read replicas, sharding).
- **Senior Django Interview**: 30 senior/staff questions across 10 topics. Each has a one-line answer, a full explanation, code, likely follow-ups, "known / review" tracking and a mock-interview drill.

No build step. Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

To publish on GitHub Pages, go to Settings → Pages and deploy from the branch root.

## Adding content

- Lessons: `data/lessons.js` (nodes, steps, flows and metrics per step)
- Django questions: `data/django.js` (`DJANGO_CATEGORIES`, `DJANGO_QUESTIONS`)
