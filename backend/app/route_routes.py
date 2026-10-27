"""Rota API'si: şehirdeki onaylı eserlerin yürüyüş önerisi ve kilit durumu (kurallar için bkz. `route_engine.py`).

Rota yönlendirmedir, ziyaret kilidi değildir. Eksik kilitler bu uçta, okuma sırasında açılır ve kalıcı yazılır; bilgi
mührü kazanıldıktan sonraki ilk çağrı sınırı yeniden doldurur. Tek istisna: rotayı hiç açmamış kullanıcı doğrudan bir
eserin oyun ucuna gelirse ilk sınır orada, bu uçla aynı kuralla doldurulur (`monument_locked`). Koordinatı olmayan eser
rotaya girmez. İlerleme uçlarındaki gibi hesap kimliğiyle (`u-…`) yalnızca o hesabın oturumuyla okunur
(`require_progress_access`).
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


def city_points(catalog, slug: str) -> list[Point]:
    """Şehrin rotaya giren eserleri: koordinatı olan onaylı eserler."""
    return [Point(m.monument_id, m.name, m.type, m.location.latitude, m.location.longitude)
            for m in catalog.monuments if m.location is not None and route_engine.city_slug(m.city) == slug]


def _city_points(request: Request, slug: str) -> list[Point]:
    return city_points(request.app.state.monuments.catalog, slug)


def plan_city(points: list[Point], completions: list[dict], unlocked: set[str],
              location: Optional[tuple[float, float]] = None) -> RoutePlan:
    """`MonumentProgressStore.plan_unlocks` içinde çağrılır: depodaki tamamlananlarla şehrin rotası."""
    done = [Completion(c["monument_id"], c["earned_at"], c["visit"]) for c in completions]
    return route_engine.plan_route(points, done, unlocked, location)


def monument_locked(request: Request, monument, user_id: str) -> bool:
    """Eser bu kullanıcı için kilitli mi (sınav ve soru cevaplama kapısı)?

    Açık sayılır: bilgi mührü kazanılmış (tamamlanmış) ya da rotada kilidi açılmış eser. Kullanıcının o şehirde hiç açık
    eseri yoksa (rotayı henüz hiç açmamışsa) sınır, `GET /route`'un konumsuz çağrısıyla aynı biçimde burada ilk kez
    doldurulur ve kalıcı yazılır; aksi halde sınır yalnızca rota ucunda doldurulur. Koordinatı olmayan eser rotaya
    girmediği için kilitlenmez.
    """
    if monument.location is None:
        return False
    store: MonumentProgressStore = request.app.state.monument_progress
    if monument.monument_id in store.unlocked(user_id):
        return False
    points = _city_points(request, route_engine.city_slug(monument.city))
    city_ids = {p.monument_id for p in points}

    def planner(completions: list[dict], unlocked: set[str]) -> tuple[bool, tuple[str, ...]]:
        if monument.monument_id in unlocked or any(c["monument_id"] == monument.monument_id for c in completions):
            return False, ()
        if unlocked & city_ids:
            return True, ()
        plan = plan_city(points, completions, unlocked)
        return monument.monument_id not in plan.new_unlocks, plan.new_unlocks

    return store.plan_unlocks(user_id, planner)


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
        plan = plan_city(points, completions, unlocked, location)
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
