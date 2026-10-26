"""Gerçek Bursa eserleri için genel API. Yalnızca yayın onaylı anlık görüntüyü sunar (bkz. `public_catalog.py`).

Demo oyununun `/places`, check-in ve pasaport uçlarından ayrıdır: gerçek eser mühürleri ayrı bir ilerleme deposunda tutulur
ve demo pasaportuna karışmaz. Yayımlanmamış ve bilinmeyen eser aynı 404 yanıtını alır; yayın dışı kayıtların varlığı
sızdırılmaz.

Keşif soruları yalnızca yayın ve oyun onaylı olgulardan gelir; doğru cevap istemciye gönderilmez, sunucuda denetlenir.
Bilgi mührü uzaktan kazanılır; ziyaret mührü yalnızca GPS check-in onaylı eserde, yarıçap içindeki check-in ile verilir.
"""

from dataclasses import dataclass
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from . import services
from .models import CheckInRequest, CheckInResponse, Passport, UserId
from .progress import MonumentProgressStore
from .public_catalog import (
    MediaFile, MonumentId, PublicCatalogRepository, monument_detail, monument_summary, quest_view, quests_of,
)

router = APIRouter(tags=["monuments"])

NOT_FOUND = "Eser bulunamadı veya henüz yayımlanmadı."


@dataclass(frozen=True)
class _CheckInTarget:
    """`services.check_in` için gerçek eserin onaylı check-in noktası."""

    id: str
    name: str
    latitude: float
    longitude: float
    check_in_radius_m: float


def _catalog(request: Request) -> PublicCatalogRepository:
    return request.app.state.monuments


@router.get("/monuments")
def list_monuments(request: Request):
    # Tek anlık görüntü: yanıt yeniden yükleme sırasında bile tutarlı kalır.
    snapshot = _catalog(request).catalog
    monuments = [monument_summary(m) for m in snapshot.monuments]
    return {
        "published_count": len(monuments),
        "data_version": snapshot.data_version,
        "generated_at": snapshot.generated_at,
        "monuments": monuments,
    }


@router.get("/monuments/media/{file}")
def get_media(request: Request, file: Annotated[MediaFile, Path()]):
    path = _catalog(request).media_path(file)
    if path is None:
        raise HTTPException(status_code=404, detail="Görsel bulunamadı veya yayımlanmadı.")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/monuments/{monument_id}")
def get_monument(request: Request, monument_id: Annotated[MonumentId, Path()]):
    repo = _catalog(request)
    m = repo.get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return monument_detail(m, repo.archive(monument_id))


@router.post("/monuments/{monument_id}/check-in", response_model=CheckInResponse)
def check_in(request: Request, body: CheckInRequest, monument_id: Annotated[MonumentId, Path()]):
    """Gerçek eserde konum görevi. Yalnızca `gps_checkin` kararıyla onaylı giriş noktası varsa açılır.

    Harita konumunun doğrulanmış olması check-in izni değildir. Koordinatlar istemciden gelir ve doğrulanmaz.
    """
    m = _catalog(request).get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    if m.checkin is None:
        raise HTTPException(status_code=409, detail="Bu eser için konum tabanlı görev açılmadı.")
    target = _CheckInTarget(m.monument_id, m.name, m.checkin.latitude, m.checkin.longitude, m.checkin.radius_m)
    return services.check_in(target, body.user_id, body.latitude, body.longitude, request.app.state.monument_progress)


class AnswerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: UserId
    choice_index: int = Field(ge=0, le=9)


def _progress(request: Request) -> MonumentProgressStore:
    return request.app.state.monument_progress


def _quest_progress(m, solved: set[str]) -> dict:
    quests = quests_of(m)
    done = [f.fact_id for f in quests if f.fact_id in solved]
    return {"total": len(quests), "solved": len(done), "solved_ids": done}


@router.get("/monuments/{monument_id}/quests")
def get_quests(request: Request, monument_id: Annotated[MonumentId, Path()], user_id: Optional[UserId] = None):
    m = _catalog(request).get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    solved = _progress(request).solved(user_id, monument_id) if user_id else set()
    return {"monument_id": m.monument_id, "quests": [quest_view(f) for f in quests_of(m)],
            "progress": _quest_progress(m, solved)}


@router.post("/monuments/{monument_id}/quests/{quest_id}/answer")
def answer_quest(request: Request, body: AnswerRequest, monument_id: Annotated[MonumentId, Path()],
                 quest_id: Annotated[str, Path(pattern=r"^BUR-\d{4}-F\d{3}$")]):
    m = _catalog(request).get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    fact = next((f for f in quests_of(m) if f.fact_id == quest_id), None)
    if fact is None:
        raise HTTPException(status_code=404, detail="Bu eser için böyle bir keşif sorusu yok.")
    if body.choice_index >= len(fact.quest.choices):
        raise HTTPException(status_code=422, detail="Geçersiz seçenek.")
    store = _progress(request)
    correct = body.choice_index == fact.quest.answer_index
    already = store.record_answer(body.user_id, m.monument_id, quest_id, correct)
    progress = _quest_progress(m, store.solved(body.user_id, m.monument_id))
    seal = None
    if progress["total"] and progress["solved"] == progress["total"]:
        record, created = store.add_seal(body.user_id, m.monument_id, m.name, "knowledge")
        seal = {**record, "new": created}
    return {
        "correct": correct,
        "already_solved": already,
        # Yanlış cevapta doğru seçenek açıklanmaz; ziyaretçi yeniden deneyebilir.
        "explanation": fact.quest.explanation if correct else None,
        "fact": {"title": fact.title, "text": fact.text} if correct else None,
        "progress": progress,
        "knowledge_seal": seal,
    }


@router.get("/users/{user_id}/monument-passport", response_model=Passport)
def get_monument_passport(request: Request, user_id: Annotated[UserId, Path()]):
    return services.get_passport(user_id, request.app.state.monument_progress)


@router.get("/users/{user_id}/seals")
def get_seals(request: Request, user_id: Annotated[UserId, Path()]):
    """Kalıcı dijital pasaport: bilgi mühürleri (uzaktan) ve ziyaret mühürleri (GPS) ayrı listelenir."""
    seals = _progress(request).seals(user_id)
    catalog = _catalog(request)
    solved = _progress(request).solved(user_id)
    monuments = []
    for m in catalog.catalog.monuments:
        p = _quest_progress(m, solved)
        monuments.append({"monument_id": m.monument_id, "name": m.name, "quests": p["total"], "solved": p["solved"],
                          "checkin_available": m.checkin is not None})
    return {
        "user_id": user_id,
        "knowledge_seals": [s for s in seals if s["kind"] == "knowledge"],
        "visit_seals": [s for s in seals if s["kind"] == "visit"],
        "monuments": monuments,
    }
