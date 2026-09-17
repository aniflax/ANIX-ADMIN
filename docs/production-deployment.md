# anix HRMS Production Deployment

## Stack

- Frontend: Cloudflare Pages
- Backend: Leapcell running FastAPI
- Database: Neon or Supabase PostgreSQL
- Private documents: Cloudflare R2
- Email: Brevo or SMTP provider
- DNS/SSL: Cloudflare

## Required Backend Environment

```env
DATABASE_URL=postgresql://...
SECRET_KEY=change-me
ENVIRONMENT=production
FRONTEND_URL=https://hrms.example.com
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=anix-hrms-documents
R2_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
DB_POOL_SIZE=2
DB_MAX_OVERFLOW=3
SMTP_SERVER=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
```

## Backend Deploy

Install dependencies:

```bash
pip install -r requirements.txt
```

Run migrations before each release:

```bash
alembic upgrade head
```

Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

## Frontend Deploy

Set the production API URL:

```env
VITE_API_BASE_URL=https://api-hrms.example.com
```

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

## Backups

Run from a trusted machine or scheduled job with `pg_dump` installed:

```bash
python backend/scripts/backup_postgres_to_r2.py
```

Retention target:

- 14 daily backups
- 8 weekly backups
- 12 monthly backups

Before every production release:

1. Create a manual DB backup.
2. Record current git tag/commit.
3. Record current Alembic revision.
4. Deploy backend.
5. Smoke test production.

## Rollback

- Frontend: promote previous Cloudflare Pages deployment.
- Backend: redeploy previous git tag.
- Database: restore backup into a new database, verify, then switch `DATABASE_URL`.
- R2 documents: never overwrite in place; old objects remain valid unless explicitly deleted.

## Smoke Test

- Login/logout.
- Onboarding upload with PDF/JPG/PNG.
- Activation link on mobile.
- Attendance mark and duplicate-tap rejection.
- Leave apply/approve/reject.
- Employee profile document preview/download.
- Month-end report/export.
