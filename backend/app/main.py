"""Martian Map backend.

M0: only a health check. The DEM, routes and point info arrive in M3 and M4
(see README sections 6 and 8).
"""

from fastapi import FastAPI

app = FastAPI(
    title="Martian Map API",
    description="Calculations for the Jezero Marswalk planner: elevation, slope and routes.",
    version="0.1.0",
)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Answer 'ok' when the backend is running."""
    return {"status": "ok", "service": "martian-map-backend"}
