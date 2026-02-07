# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AREDIT ("راية الفرسان") is an Arabic-language Reddit-style community forum. Server-rendered with Node.js/Express, SQLite database, EJS templates. All UI text is Arabic with full RTL support.

## Commands

- **Install dependencies:** `npm install`
- **Start server:** `npm start` (runs `node server.js`, serves at http://localhost:3000)
- **Seed database:** `npm run seed` (deletes existing DB, creates 100 users, 10 communities, 100 posts with comments/votes. Login: any Arabic username + password `123456`)
- **Production (PM2):** `pm2 start ecosystem.config.js --env production`
- **Docker:** `docker-compose up -d`

There are no tests, linter, or build step.

## Architecture

### Request flow

`server.js` is the entry point. It sets up middleware (Helmet, rate limiting, session, morgan logging) and mounts five route modules all at `/`:

- `routes/auth.js` — registration, login, logout, password reset flow, user profile (`/u/:username`), settings, notifications
- `routes/communities.js` — community CRUD, admin panel, follow/unfollow, community RSS feeds
- `routes/posts.js` — post CRUD, voting, bookmarks, reporting, media uploads
- `routes/comments.js` — comment CRUD, nested replies, voting, reporting
- `routes/api.js` — JSON endpoints (`/api/share/:id`, `/api/notifications/count`)

Home page (`/`), search (`/search`), communities list (`/communities`), RSS feed (`/feed.xml`), and health check (`/health`) are defined directly in `server.js`.

### Database

`db.js` initializes SQLite with `better-sqlite3`, creates all tables, runs migrations (ALTER TABLE wrapped in try/catch for idempotency), and sets up FTS5 triggers for full-text search on posts.

Key tables: `users`, `communities`, `community_follows`, `posts`, `comments`, `votes` (polymorphic via `votable_type`/`votable_id`), `community_admins`, `bookmarks`, `reports`, `notifications`, `password_resets`. Virtual table `posts_fts` for search.

All queries use `better-sqlite3`'s synchronous API with parameterized statements. The database file is `aredit.db` in the project root.

### Templates

EJS templates in `views/`. **Important:** `layout.ejs` exists but is unused — each page (`home.ejs`, `post.ejs`, etc.) is a standalone full HTML document that includes `partials/header.ejs` directly. Shared partials: `header.ejs`, `post-card.ejs`, `comment.ejs`, `pagination.ejs`.

### Frontend

No build tooling. Static files served from `public/`:
- `style.css` — single CSS file, dark theme, RTL, responsive (breakpoint at 768px)
- `app.js` — voting (delegated click handler), bookmark toggle, report modal, inline comment editing, toast notifications, clipboard copy
- `embed.js` — auto-embeds YouTube/Twitter/Facebook links found in post bodies

### User-uploaded files

Stored in `uploads/` directory, served at `/uploads/`. Three separate multer configs exist in different route files:
- `routes/auth.js` — avatar upload (2MB, images only)
- `routes/communities.js` — banner upload (5MB, images only)
- `routes/posts.js` — post media (configurable via `UPLOAD_MAX_SIZE_MB` env var, images + video)

### Auth & sessions

Sessions use `express-session` with cookie-based storage (no persistent session store configured). User lookup happens in global middleware (`server.js`) that sets `res.locals.currentUser` and `res.locals.unreadNotifications` on every request. Auth checks in routes are manual (`if (!res.locals.currentUser) return res.redirect('/login')`).

### Voting system

Polymorphic votes table: `votable_type` is `'post'` or `'comment'`, `votable_id` references the item. Score is cached directly on the post/comment row and updated inline with vote operations. Frontend uses fetch API for async voting.

### Community admin system

`community_admins` table with `role` of `'creator'` or `'admin'`. Creator can add/remove admins, both roles can manage community settings and moderate reports.

## Key Patterns

- Route param `:id` for communities and posts is the integer primary key, not a slug
- Arabic username validation: `[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF_]+` (Arabic Unicode blocks + underscore)
- Community names allow Arabic + spaces + digits
- Sort options for community feeds use a whitelist map (`SORT_MAP` in `communities.js`) to prevent SQL injection in ORDER BY clauses
- Password reset uses crypto-secure token + 6-digit code with max 5 attempts and 15-minute expiry
- `timeAgo()` helper is defined as `res.locals.timeAgo` in server.js middleware, available in all templates
- Comment trees are built in-memory in `routes/posts.js` (view post handler) from flat query results

## Known Gaps

- `csurf` is a dependency but CSRF protection is not wired up — no middleware, no tokens in forms
- `better-sqlite3-session-store`, `cookie-parser`, `marked`, `dompurify`, `jsdom` are in `package.json` but never used in code
- Uploaded files are never cleaned up when replaced or when posts/users are deleted
- No test suite exists
