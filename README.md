# ESTG SDA church programs

A static website with a browser-side admin dashboard. All program data, the
home page messages/photos/video, and the admin password are stored in the
visitor's own browser (localStorage / IndexedDB). There is no database and no
server required to view or edit the site.

## Deploy (Vercel or Netlify)

The site is published from the `public/` folder only. Configuration files are
already included:

- Vercel: `vercel.json` (`"outputDirectory": "public"`) and `.vercelignore`.
- Netlify: `netlify.toml` (`publish = "public"`).

Deploy the repository root as-is:

1. Vercel or Netlify -> **New site** -> import this repository.
2. Leave the build command empty. Publish/output directory is `public`.
3. Deploy. No environment variables are required for the static site.

Only files inside `public/` are exposed. `server.js`, `.env`,
`.admin-credentials.json`, `test/`, the PDFs and the screenshots are never
published.

### How the admin login works on static hosting

Because static hosting cannot run server-side code, the login is enforced in
the browser:

- The first time an admin page is opened, the password is the initial value
  `God is good` (stored only as a salted hash in the browser). Change it right
  away on the `admin.html` page.
- The dashboard and preachers pages redirect to `admin.html` until an admin
  session is active (sessions live in `sessionStorage` and expire after 8
  hours).

This is a convenience gate, not real security: the page markup is public and
the password lives in the visitor's browser. Do not store sensitive information
on these pages.

## Run locally (optional Node server)

A tiny Node server is included for local development and for hosts that can run
Node (Render, Railway, Heroku, a VPS, etc.). It serves `public/`, protects the
dashboard and preachers pages server-side, and provides the `/api/*` login
endpoints.

Use Node.js 20.6 or newer. Create a `.env` file (already git-ignored):

```text
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-long-unique-password
PORT=4010
```

Then run `npm run dev` and open `http://localhost:<PORT>`. On a Node host,
configure `ADMIN_EMAIL` and (on first start) `ADMIN_PASSWORD` as environment
variables and run `npm start`; set `PORT` to the port the host assigns.

For a public Node deployment, serve the site behind HTTPS and set
`COOKIE_SECURE=true`. Add `TRUST_PROXY=true` when running behind a reverse
proxy. Persist `.admin-credentials.json` across restarts so password changes
survive.

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
