# Backend Atlas sync API

A small Django + DRF service that lets the static site keep your progress in step across devices.
No accounts: turning sync on creates a random key; paste it on another device to link it.

## Endpoints

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/spaces` | Create a sync space. Returns `{"key": "atlas_…"}` once. Throttled to 10/hour per IP. |
| `GET` | `/api/progress` | `Authorization: Bearer <key>` → `{"data", "version"}` |
| `PUT` | `/api/progress` | Body `{"data": {...}}`. Merged into the stored copy under a row lock, returns the merged result. |
| `GET` | `/api/health` | Liveness check. |

## Design notes

- **Keys are hashed.** Only the SHA-256 of a key is stored, so a database dump can't be used to read anyone's progress.
- **Merging never loses work** (`progress/merge.py`): finished lessons are unioned, the newest practice grade wins by timestamp, and the device you just used wins for "known / review" marks. Theme and open folders stay per device.
- **Concurrent syncs** from two devices are safe: `PUT` runs in a transaction with `select_for_update()` on the row.
- **Limits:** 256 KB per body (`ATLAS_MAX_BYTES`), 120 requests/min per IP (`THROTTLE_RATE`).
- **CORS** is a 20-line middleware that only allows `ATLAS_ORIGINS`, instead of a dependency.

## Run it

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py test          # 11 tests: merge rules, auth, size limit, CORS
python manage.py runserver
```

## Deploy

Any container host works (Render, Fly.io, Railway). Set:

```
SECRET_KEY=…            ALLOWED_HOSTS=atlas-sync.example.com
ATLAS_ORIGINS=https://0mustafa37.github.io
POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST   # SQLite is used when these are unset
```

Then point the site at it in `index.html`:

```html
<meta name="atlas-sync" content="https://atlas-sync.example.com" />
```

With the meta tag empty (the default) the site never calls the API.
