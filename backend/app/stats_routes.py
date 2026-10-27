"""İstatistik uçları: `POST /stats/hit` (herkese açık, anonim) ve `GET /admin/stats` (yalnızca yönetici).

Yönetici: oturum açmış ve e-postası `VAKIFNAME_ADMIN_EMAILS` listesinde olan hesap. Liste boşsa yönetici yoktur.
"""

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints

from .admin import is_admin
from .auth_routes import current_user
from .stats import PAGES

router = APIRouter(tags=["stats"])

Page = Literal[PAGES]  # type: ignore[valid-type]


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Oturum açık değil.")
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Bu sayfa yalnızca yöneticilere açıktır.")
    return user


class Hit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: Page
    monument_id: Optional[Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}-\d{4}$")]] = None


@router.post("/stats/hit", status_code=204)
def hit(body: Hit, request: Request):
    client = request.client.host if request.client else "unknown"
    if request.app.state.stats_limiter.check(client) is not None:
        return Response(status_code=204)  # sınırı aşan sayım sessizce düşer; ziyaretçiye hata gösterilmez
    monument = body.monument_id if body.monument_id and request.app.state.monuments.get(body.monument_id) else None
    request.app.state.stats.record(body.page, monument, f"{client}|{request.headers.get('user-agent', '')[:200]}")
    return Response(status_code=204)


@router.get("/admin/stats")
def admin_stats(request: Request, response: Response, days: Annotated[int, Query(ge=1, le=365)] = 30):
    require_admin(request)
    data = request.app.state.stats.summary(days)
    names = {m.monument_id: m.name for m in request.app.state.monuments.catalog.monuments}
    for m in data["monuments"]:
        m["name"] = names.get(m["monument_id"], m["monument_id"])
    data["game"] = request.app.state.monument_progress.funnel()  # tüm zamanlar; tarih aralığından bağımsız
    response.headers["Cache-Control"] = "no-store"
    return data
