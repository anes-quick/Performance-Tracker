# Deploy this repo on Vercel

The Next.js app lives in **`frontend/`**. Vercel must use that folder as the project root, or it won’t see `next` in the right `package.json`.

## Required: Root Directory

1. Vercel → your project → **Settings** → **Build & Deployment**
2. **Root Directory** → **Edit** → set to **`frontend`**
3. Save, then **Redeploy**

**Install Command** and **Build Command** must **not** use `cd frontend` when Root Directory is already `frontend` (that breaks with `frontend/frontend`).

- Prefer: leave them **empty** so **`frontend/vercel.json`** supplies `npm ci` / `npm run build`.
- If the UI still shows `cd frontend && npm ci` from an old deploy, **clear** Install and Build overrides (or redeploy after pulling the latest `frontend/vercel.json`, which forces the correct commands).

## If Root Directory is wrong

- **Root Directory = repo root (`.`)** → Vercel reads the root `package.json`, which is not the Next app → *“No Next.js version detected”*.
- **Root Directory = `frontend` but old `vercel.json` at repo root had `cd frontend && …`** → install runs from `frontend/` and tries `frontend/frontend` → broken build.

## Optional: deploy from repo root without changing Root Directory

Not recommended. You’d need a root `vercel.json` again with `installCommand` / `buildCommand` that `cd frontend && …`, and root `package.json` would need `next` listed for detection. The supported setup is **Root Directory = `frontend`**.
