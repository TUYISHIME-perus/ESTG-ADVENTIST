# ESTG SDA church programs

A church programs website served by a small Node.js server that stores all
content in a SQLite database (via the built-in `node:sqlite` module). Program
entries, weekly studies, home page messages/photos/video and the admin password
record are all persisted server-side.

## Requirements

- Node.js 22.5 or newer (for the built-in `node:sqlite` module).
- No npm dependencies; everything uses the Node standard library.

## Run locally

Create a `.env` file (already git-ignored):

```text
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-long-unique-password
PORT=4010
```

Then run `npm run dev` (uses `node --env-file=.env`) and open
`http://localhost:<PORT>`.

On first start the server creates the database, stores the administrator
credentials (as a salted `scrypt` hash) and prints the port it is listening on.
`ADMIN_PASSWORD` is only required the first time; after that the saved hash is
used and the password can be changed from `admin.html`.

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `ADMIN_EMAIL` | Administrator login email (required). | - |
| `ADMIN_PASSWORD` | Initial password, used only when the database has no credentials yet. | - |
| `PORT` | Port to listen on. | `4010` |
| `DATABASE_PATH` | Path to the SQLite database file. | `data/church.db` |
| `COOKIE_SECURE` | Set to `true` behind HTTPS to add the `Secure` cookie flag. | `false` |
| `TRUST_PROXY` | Set to `true` when running behind a reverse proxy. | `false` |

## Database

The SQLite database is created automatically. Its schema is:

- `auth` - a single row holding the administrator email and the `scrypt` salt/hash.
- `content` - the dashboard state as JSON under the key `dashboard` (title,
  section names, weekly studies, home messages, home photos, and program entries).
- `media` - binary assets keyed by name (currently `homeVideo` with its content type).

Back up the `data/` directory (or the file at `DATABASE_PATH`) to preserve the
site content. `*.db`, `*.db-wal` and `*.db-shm` are git-ignored.

## Deploy

The site now needs a Node host with a persistent disk (Render, Railway, Heroku,
Fly.io, a VPS, etc.) because the content lives in the database, not in the
browser. Configure `ADMIN_EMAIL` and (on first start) `ADMIN_PASSWORD` as
environment variables, run `npm start`, and set `PORT` to the port the host
assigns. Persist the database file across restarts.

For a public deployment, serve the site behind HTTPS and set
`COOKIE_SECURE=true`. Add `TRUST_PROXY=true` when running behind a reverse
proxy.

The `vercel.json` / `netlify.toml` files only publish the static `public/`
folder and cannot run the database or the write APIs; they are useful for a
read-only preview only.

## API

- `GET /api/home` - public; returns the home page messages, photos and a
  `hasVideo` flag.
- `GET /api/media/video` - public; streams the stored home video (supports
  range requests).
- `GET /api/content` - administrator only; returns the full dashboard state.
- `PUT /api/content` - administrator only; saves the dashboard state.
- `PUT` / `DELETE /api/media/video` - administrator only; upload or remove the
  home video.
- `POST /api/login`, `POST /api/logout`, `POST /api/change-password`,
  `GET /api/session` - authentication.

## Security notes

- The administrator password is stored only as a salted `scrypt` hash.
- The dashboard (`program-dashboard.html`) and preachers (`preachers.html`)
  pages are protected server-side; unauthenticated visitors are redirected to
  `admin.html`.
- Program content is only returned by `GET /api/content` to authenticated
  administrators. The public `GET /api/home` endpoint exposes only the home
  page messages and photos.

## Tests

```text
npm test
```

## Pages

- `index.html` - home page with rotating messages, photos and video.
- `morning.html` - morning program.
- `school sabbath.html` - Sabbath School program and weekly studies.
- `preachers.html` - worshipping program (admin only).
- `admin.html` - login and password change.
- `program-dashboard.html` - add/edit program entries and home media (admin only).
