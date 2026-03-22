# First steps: Git → GitHub → Railway

## Done locally

- **`git init`** in the project root (monorepo).
- **`frontend/`** used to be its own repo; **`frontend/.git` was removed** so the whole app is one repository (needed for Vercel + Railway).
- **Stronger `.gitignore`** (env files, `node_modules`, `.next`, OAuth/token JSON patterns, `neon-feat*.json`).
- **Your `neon-feat-…json` service account file is NOT in Git** — keep it only on your machine or in Railway/Vercel secrets.

## 1. GitHub (you do this in the browser + terminal)

1. Create a **new empty repository** on GitHub (no README if you already have commits).
2. In the project folder:

```bash
cd "/Users/anes/Documents/Vibe Coding stuff/Performance Tracker"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

3. Optional: set your name/email for commits:

```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## 2. Railway service from GitHub

1. **New project** → **Deploy from GitHub repo** → choose this repo.
2. Railway will ask what to run — for **scrapers only** you’ll later set:
   - **Root directory:** repo root (or leave default).
   - **Build / start:** install Python from `scraper/requirements.txt`, then cron or manual run `bash scripts/nightly-scrape.sh` (see `DEPLOYMENT.md`).
3. Add **variables** in Railway (same as `scraper/.env`): `GOOGLE_APPLICATION_CREDENTIALS` path or JSON, `YOUTUBE_API_KEY`, etc. **Do not** commit `.env`.

## 3. Vercel (after GitHub exists)

1. Import **the same GitHub repo**.
2. Set **Root directory** to `frontend`.
3. If the build can’t find `channels.config.json`, see **“Vercel + config path”** in `DEPLOYMENT.md`.

---

**Order:** Push to GitHub → connect **Railway** (cron/worker) and **Vercel** (site) to the **same** repo.
