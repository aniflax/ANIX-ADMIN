from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api import auth, sevak, leave, attendance, onboarding, department, dashboard, config, location, communications
from fastapi.staticfiles import StaticFiles
import os
from app.core.database import SessionLocal
from app.core.seed import seed_system_config
from app.services.notifications import start_attendance_reminder_worker

app = FastAPI(
    title="anix HRMS API",
    description="Attendance and Leave Management System for anix",
    version="1.0.0",
)

CORS_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|"
    r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3}|"
    r"([a-z0-9-]+\.)?anix-hrms\.pages\.dev"
    r")(:\d+)?$"
)

# CORS — allows React frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        settings.FRONTEND_URL,
    ],
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(sevak.router)
app.include_router(leave.router)
app.include_router(attendance.router)
app.include_router(onboarding.router)
app.include_router(department.router)
app.include_router(dashboard.router)
app.include_router(config.router)
app.include_router(location.router)
app.include_router(communications.router)

# Mount static files for uploads
if not os.path.exists("app/static/uploads"):
    os.makedirs("app/static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.on_event("startup")
def startup_tasks():
    db = SessionLocal()
    try:
        seed_system_config(db)
    finally:
        db.close()

    start_attendance_reminder_worker()


@app.get("/")
def health_check():
    return {
        "status": "healthy",
        "app": "anix HRMS API",
        "environment": settings.ENVIRONMENT
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload_enabled = os.getenv("RELOAD", "true").lower() == "true"

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_enabled,
    )
