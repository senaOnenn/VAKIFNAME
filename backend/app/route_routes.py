"""Rota API'si: şehirdeki onaylı eserlerin yürüyüş önerisi ve kilit durumu (kurallar için bkz. `route_engine.py`).

Rota yönlendirmedir, ziyaret kilidi değildir. Eksik kilitler yalnızca bu uçta, okuma sırasında açılır ve kalıcı yazılır;
bilgi mührü kazanıldıktan sonraki ilk çağrı sınırı yeniden doldurur. Koordinatı olmayan eser rotaya girmez. İlerleme
uçlarındaki gibi hesap kimliğiyle (`u-…`) yalnızca o hesabın oturumuyla okunur (`require_progress_access`).
"""

from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response

from . import route_engine
from .auth_routes import require_progress_access
from .models import Latitude, Longitude, UserId
from .progress import MonumentProgressStore
from .route_engine import Completion, Point, RoutePlan

router = APIRouter(tags=["route"])

CITY_NOT_FOUND = "Bu şehir için rota bulunamadı."
LOCATION_PAIR = "Konum için enlem ve boylam birlikte gönderilmelidir."


def _city_points(request: Request, slug: str) -> list[Point]:
    catalog = request.app.state.monuments.catalog
    return [Point(m.monument_id, m.name, m.type, m.location.latitude, m.location.longitude)
            for m in catalog.monuments if m.location is not None and route_engine.city_slug(m.city) == slug]


@router.get("/route")
def get_route(request: Request, response: Response, city: Annotated[str, Query(max_length=64)], user_id: UserId,
              lat: Optional[Latitude] = None, lng: Optional[Longitude] = None):
    require_progress_access(request, user_id)
    if (lat is None) != (lng is None):
        raise HTTPException(status_code=422, detail=LOCATION_PAIR)
    slug = route_engine.city_slug(city)
    points = _city_points(request, slug) if slug else []
    if not points:
        raise HTTPException(status_code=404, detail=CITY_NOT_FOUND)
    location = (lat, lng) if lat is not None else None

    def planner(completions: list[dict], unlocked: set[str]) -> tuple[RoutePlan, tuple[str, ...]]:
        done = [Completion(c["monument_id"], c["earned_at"], c["visit"]) for c in completions]
        plan = route_engine.plan_route(points, done, unlocked, location)
        return plan, plan.new_unlocks

    store: MonumentProgressStore = request.app.state.monument_progress
    plan = store.plan_unlocks(user_id, planner)
    response.headers["Cache-Control"] = "no-store"
    return {
        "city": slug,
        "total": len(points),
        "completed_count": len(plan.completed),
        "start": {"source": plan.start.source, "latitude": round(plan.start.latitude, 6),
                  "longitude": round(plan.start.longitude, 6)},
        "next": plan.next,
        "stops": [{"monument_id": s.point.monument_id, "name": s.point.name, "type": s.point.type,
                   "latitude": s.point.latitude, "longitude": s.point.longitude,
                   "state": "unlocked" if s.unlocked else "locked", "distance_m": round(s.distance_m), "order": s.order}
                  for s in plan.stops],
        "completed": [{"monument_id": p.monument_id, "name": p.name, "earned_at": c.earned_at, "visit": c.visit}
                      for p, c in plan.completed],
    }
