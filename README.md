<h1 align="center">anix HRMS</h1>

<p align="center">
  A modern Attendance, Leave and Workforce Management System for anix
  <br/>
  <em>Full-stack HRMS built with FastAPI + React</em>
</p>

---

## Overview

**anix HRMS** is a web-based Human Resource Management System purpose-built for anix
(an organization of sevaks — selfless service workers). It digitizes the complete
employee lifecycle, from onboarding a new sevak to tracking daily attendance,
managing leave, and scaling sevaks up to Ashramites.

The system provides role-based dashboards for sevaks, HODs, HR admins, and
super admins, with geo-verified attendance, configurable leave policies,
week-off management, and secure document storage.

### Highlights

- **Geo-verified check-in / check-out** — attendance is tied to registered
  office locations with a configurable proximity threshold.
- **Multi-step leave approval** — sevak → HOD → HR with half-day support,
  cancellation, and full audit trail.
- **Self-service onboarding** — new sevaks register, upload documents, and get
  activated via email links.
- **Cloud document vault** — ID proof, PAN card, bank passbook uploaded to
  Cloudflare R2, not the database.
- **Email-first communication** — Brevo (or SMTP) powers verification, password
  resets, leave notifications and reminders.
- **Attendance reminders** — an in-app background worker nudges sevaks who
  haven't marked attendance.

---

## Features

### Onboarding & Sevak Management
- Self-registration with document upload (ID proof, PAN, passbook)
- Email verification and activation links
- Admin account management — lock/unlock, role assignment, activation
- "Delete request" workflow with admin resolution
- Seamless promotion path from Sevak → Ashramite

### Attendance
- Web-based check-in / check-out with GPS coordinate capture
- Geo-fence validation against configured office locations
- Automatic status derivation (Present / Absent / Half-day / On Leave / Holiday / Week-off)
- Manual corrections by HR (flagged, with audit trail)
- Duplicate-tap rejection per day

### Leave Management
- Configurable leave types with annual quota and max consecutive days
- Multi-level approval (HOD first, HR final)
- Half-day leaves with period selection
- Leave balance tracking per year, cancellation flow
- Calendar and request-history views

### Communications
- Official announcements to sevaks or groups
- Leave notification reminders with retry tracking
- Onboarding / policy / news updates

### Administration
- **Super Admin**: locations, system config, global settings
- **HR Admin**: departments, sevak directory, attendance reports, leave admin
- **HOD**: department oversight, pending approvals
- Role-based dashboards and Excel report exports

---

## Roles

| Role | Scope |
| --- | --- |
| `SUPER_ADMIN` | Full system control: locations, settings, config |
| `ADMIN` | System administration and user management |
| `HR` | Departments, sevak records, attendance & leave administration |
| `HOD` | Head of Department — approval and department views |
| `SEVAK` | Personal attendance, leave requests, profile management |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, Vite, Material UI, React Router, Leaflet (geo map) |
| **Backend** | Python 3, FastAPI, SQLAlchemy 2.0, Pydantic, Alembic |
| **Database** | PostgreSQL (Aiven / Render / Neon) |
| **Storage** | Cloudflare R2 (private documents) |
| **Email** | Brevo API or SMTP |
| **Auth** | JWT (python-jose) + bcrypt, email verification |
| **Tests** | PyTest (backend), Vitest + Testing Library (frontend) |

---

## Project Structure

```text
anix-hrms/
├── backend/
│   ├── alembic/                 # Database migrations
│   ├── app/
│   │   ├── api/                 # Route handlers (auth, sevak, leave, attendance…)
│   │   ├── core/                # Config, DB, security, seeding
│   │   ├── models/              # SQLAlchemy models
│   │   ├── schemas/             # Pydantic request/response schemas
│   │   ├── services/            # Business logic (attendance, leave, storage…)
│   │   ├── utils/               # Email, geo helpers
│   │   └── main.py              # FastAPI app entry point
│   ├── scripts/                 # Backups, data fixes
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/                 # Axios client
│   │   ├── components/          # Reusable UI (layout, leave, dialogs)
│   │   ├── context/             # Auth context
│   │   ├── pages/               # Role-based pages
│   │   └── utils/               # date, geo, attendance sync helpers
│   └── package.json
├── docs/                        # Deployment, API and data-model docs
└── tests/                       # Backend + frontend tests
```

---

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- PostgreSQL (local instance or a cloud database)

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # fill in your values
alembic upgrade head               # run migrations
uvicorn app.main:app --reload      # API at http://localhost:8000
```

> API docs are available at <http://localhost:8000/docs> (Swagger UI).

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local        # set VITE_API_BASE_URL if needed
npm run dev                       # app at http://localhost:5173
```

Vite proxies `/api` and `/static` to the backend at `127.0.0.1:8000`
automatically in development.

### Environment Variables (Backend)

The core variables (see `backend/.env.example`):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | JWT signing secret |
| `FRONTEND_URL` | Public frontend URL (used in email links, CORS) |
| `STORAGE_PROVIDER` | `local` (dev) or `r2` (production) |
| `EMAIL_PROVIDER` | `smtp` or `brevo` |
| `BREVO_API_KEY` | Brevo API key for email delivery |
| `SMTP_*` | SMTP server settings when `EMAIL_PROVIDER=smtp` |
| `R2_*` | Cloudflare R2 bucket credentials |
| `ENVIRONMENT` | `development` or `production` |

### Environment Variables (Frontend)

| Variable | Description |
| --- | --- |
| `VITE_API_BASE_URL` | Base URL of the backend API (empty in dev — uses proxy) |

---

## Running Tests

### Backend

```bash
cd backend
pytest
```

### Frontend

```bash
cd frontend
npm run lint
npm test
```

---

## Deployment

### Backend — Render

1. Push the repository to GitHub and create a new **Web Service** on Render.
2. Configure the service:

   | Setting | Value |
   | --- | --- |
   | **Root Directory** | `backend` |
   | **Build Command** | `pip install -r requirements.txt` |
   | **Start Command** | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |

3. Add the environment variables listed above (DATABASE_URL, SECRET_KEY,
   BREVO/R2 credentials, FRONTEND_URL, etc.).
4. Render handles `postgres://` → `postgresql://` URL normalization
   automatically in code — no env tweaks needed.

### Frontend — Cloudflare Pages

1. Connect the same GitHub repository as a new Pages project.
2. Configure the build:

   | Setting | Value |
   | --- | --- |
   | **Root Directory** | `frontend` |
   | **Build Command** | `npm run build` |
   | **Output Directory** | `dist` |

3. Set `VITE_API_BASE_URL` to the Render API URL (e.g. `https://your-api.onrender.com`).

> Full production notes (backups, rollback, smoke tests) are in
> [`docs/production-deployment.md`](docs/production-deployment.md).

---

## Local Network Access

To reach the app from another device on your LAN:

- Frontend already binds Vite to `0.0.0.0:5173` (`npm run dev`).
- Backend: run `python -m app.main` from `backend`, or set `HOST=0.0.0.0` and
  `PORT=8000` before launching uvicorn.
- For email links (verification/reset) to work from another device, set
  `FRONTEND_URL` in `backend/.env` to the LAN URL you actually use,
  e.g. `http://192.168.1.121:5173`.

---

## Backup & Maintenance

A script is included to back up PostgreSQL to Cloudflare R2:

```bash
python backend/scripts/backup_postgres_to_r2.py
```

Retention: 14 daily, 8 weekly and 12 monthly backups are kept automatically.

---

## Documentation

- [Production deployment](docs/production-deployment.md)
- [API reference](docs/api_reference.md)
- [Data model](docs/data_model.md)

---

## License

Released under the [MIT License](LICENSE).

© 2026 aniflax.
