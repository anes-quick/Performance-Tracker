# Deploy this repo on Vercel

The Next.js app lives in **`frontend/`**. Vercel must use that folder as the project root, or it won’t see `next` in the right `package.json`.

## Required: Root Directory

1. Vercel → your project → **Settings** → **Build & Deployment**
2. **Root Directory** → **Edit** → set to **`frontend`**
3. Save, then **Redeploy**

Leave **Install Command** and **Build Command** empty (defaults).  
Config is in **`frontend/vercel.json`**.

## If Root Directory is wrong

- **Root Directory = repo root (`.`)** → Vercel reads the root `package.json`, which is not the Next app → *“No Next.js version detected”*.
- **Root Directory = `frontend` but old `vercel.json` at repo root had `cd frontend && …`** → install runs from `frontend/` and tries `frontend/frontend` → broken build.

## Optional: deploy from repo root without changing Root Directory

Not recommended. You’d need a root `vercel.json` again with `installCommand` / `buildCommand` that `cd frontend && …`, and root `package.json` would need `next` listed for detection. The supported setup is **Root Directory = `frontend`**.
