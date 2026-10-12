from fastapi import APIRouter, HTTPException, Path, Request

from . import services
from .models import CheckInRequest, CheckInResponse, Passport, Place, PlaceId, UserId

router = APIRouter()


def _places(request: Request) -> services.PlaceRepository:
    return request.app.state.places


def _progress(request: Request) -> services.ProgressStore:
    return request.app.state.progress


def _get_place_or_404(request: Request, place_id: str) -> Place:
    place = _places(request).get(place_id)
    if place is None:
        raise HTTPException(status_code=404, detail=f"'{place_id}' ID'li eser bulunamadı.")
    return place


@router.get("/places", response_model=list[Place], tags=["places"])
def list_places(request: Request):
    return _places(request).list()


@router.get("/places/{place_id}", response_model=Place, tags=["places"])
def get_place(request: Request, place_id: PlaceId = Path()):
    return _get_place_or_404(request, place_id)


@router.post("/quests/{place_id}/check-in", response_model=CheckInResponse, tags=["quests"])
def check_in(request: Request, body: CheckInRequest, place_id: PlaceId = Path()):
    """Konum tabanlı görev check-in'i (MVP simülasyonu).

    Koordinatlar istemciden geldiği gibi kabul edilir ve doğrulanmaz; bu endpoint
    kullanıcının eseri gerçekten ziyaret ettiğini kanıtlamaz.
    Yarıçap dışındaki denemeler HTTP 200 ile `success=false`, `status=out_of_range` döner.
    """
    place = _get_place_or_404(request, place_id)
    return services.check_in(place, body.user_id, body.latitude, body.longitude, _progress(request))


@router.get("/users/{user_id}/passport", response_model=Passport, tags=["users"])
def get_passport(request: Request, user_id: UserId = Path()):
    return services.get_passport(user_id, _progress(request))
