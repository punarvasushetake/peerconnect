# Deploy Guide (Render + Vercel)

This project is deployed as:

- `backend` -> Render Web Service
- `ai-service` -> Render Web Service
- `frontend` -> Vercel (Next.js)
- `database/auth/storage` -> Supabase

---

## 1. Push Latest Code

From repo root:

```powershell
git add .
git commit -m "chore: add deployment blueprint and docs"
git push origin main
```

If you also use another remote:

```powershell
git push codewithezid main
```

---

## 2. Deploy Backend + AI on Render

1. Open one of these (based on which repo you want to deploy):
   - `https://dashboard.render.com/blueprint/new?repo=https://github.com/MeGhAbadarLI/peer-connect`
   - `https://dashboard.render.com/blueprint/new?repo=https://github.com/Codewithezid/peer-learning-platform`
2. Render will detect `render.yaml`.
3. Create Blueprint.

Render creates:
- `peer-connect-backend`
- `peer-connect-ai`

### Set backend env vars in Render

In `peer-connect-backend` service, fill these:

- `FRONTEND_URL` = `https://<your-vercel-domain>`
- `FRONTEND_URLS` = `https://<your-vercel-domain>,https://<your-vercel-preview-domain>`
- `ADMIN_USER_IDS` = `<your-supabase-user-uuid>`
- `SUPABASE_URL` = `https://ezwizxrrakjfmmfbjivj.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = `<your-supabase-secret-key>`
- `SUPABASE_JWT_SECRET` = `<your-supabase-jwt-secret-if-used>`
- `MISTRAL_API_KEY` = `<your-mistral-key>`
- `AI_SERVICE_URL` = `https://<peer-connect-ai-service-url>`
- `JITSI_DOMAIN` = `<your-jitsi-service-domain>` such as `8x8.vc` or your self-hosted Jitsi domain
- `JITSI_APP_ID` = `<your-jaas-app-id>` if your Jitsi provider requires a room prefix

`MISTRAL_MODEL`, `AI_SERVICE_TIMEOUT_MS`, bucket names are already set in `render.yaml`.

### Verify Render services

- Backend health: `https://<backend-url>/health`
- AI health: `https://<ai-url>/health`

Both should return `status: ok`.

---

## 3. Deploy Frontend on Vercel

1. Open Vercel dashboard -> **Add New Project**.
2. Import this GitHub repo.
3. Set **Root Directory** to `frontend`.
4. Framework: Next.js (auto-detected).

### Set frontend env vars in Vercel

- `NEXT_PUBLIC_API_URL` = `https://<render-backend-url>/api/v1`
- `NEXT_PUBLIC_SOCKET_URL` = `https://<render-backend-url>`
- `NEXT_PUBLIC_SUPABASE_URL` = `https://ezwizxrrakjfmmfbjivj.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<your-supabase-publishable-key>`
- `NEXT_PUBLIC_JITSI_DOMAIN` = same value as backend `JITSI_DOMAIN`
- `NEXT_PUBLIC_JITSI_APP_ID` = same value as backend `JITSI_APP_ID`, if used

Deploy.

---

## 4. Final Wiring (Important)

After Vercel deploy gives your final domain:

1. Go back to Render backend service.
2. Update:
   - `FRONTEND_URL`
   - `FRONTEND_URLS`
3. Redeploy backend.

This ensures CORS + Socket.IO allow your Vercel domain.

---

## 5. Smoke Tests

1. Open frontend URL.
2. Login.
3. Check dashboard loads.
4. Open peers/chat.
5. Create one video request.
6. Confirm no CORS errors in browser console.

---

## 6. If You See Errors

- `CORS blocked`:
  - Fix `FRONTEND_URL` / `FRONTEND_URLS` in Render backend.
- `Cannot connect socket`:
  - Ensure `NEXT_PUBLIC_SOCKET_URL` is exactly backend base URL (no `/api/v1`).
- `AI features not working`:
  - Ensure `AI_SERVICE_URL` points to Render AI service URL.
- Jitsi says the room is only a 5-minute demo:
  - Set `JITSI_DOMAIN` and `NEXT_PUBLIC_JITSI_DOMAIN` to a real Jitsi service or self-hosted domain, not `meet.jit.si`.
  - If using Jitsi-as-a-Service, also set `JITSI_APP_ID` and `NEXT_PUBLIC_JITSI_APP_ID`.
- `Supabase auth/data errors`:
  - Re-check Supabase URL + keys in both Render and Vercel env vars.
