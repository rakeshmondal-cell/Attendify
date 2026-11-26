# Temporary dummy Project Control data

**Delete after final development.**

## What it is
- Sample projects/tasks injected into `GET /me/projects` when `ATTENDIFY_DUMMY_PM=true`
- Local demo web page: `http://127.0.0.1:4000/dummy-project-control.html`
- Emulator “Open Project Control” URL: `http://10.0.2.2:4000/dummy-project-control.html`

## Files to remove later
1. `backend/src/dummyPmData.ts`
2. `backend/public/dummy-project-control.html`
3. Dummy branches in `backend/src/domain.ts` (`myProjects`) and static serve in `backend/src/server.ts`
4. `ATTENDIFY_DUMMY_PM*` keys from `.env` / `.env.example`
5. This note

## Turn off without deleting
Set `ATTENDIFY_DUMMY_PM=false` in `backend/.env` and restart the API.
