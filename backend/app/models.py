from datetime import datetime
from enum import Enum
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl, StringConstraints

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False, description="Enlem (WGS84)")]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False, description="Boylam (WGS84)")]
PlaceId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


def _not_real_monument_id(value: str) -> str:
    # Gerçek eser kimlikleri (BUR-xxxx) yalnızca dahili katalogda kullanılır; demo kaydı bu önekle başlayamaz.
    if value.upper().startswith("BUR-"):
        raise ValueError("BUR- öneki gerçek eserlere ayrılmıştır; demo mekânı bu kimliği kullanamaz.")
    return value


DemoPlaceId = Annotated[PlaceId, AfterValidator(_not_real_monument_id)]
UserId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class DemoPlace(BaseModel):
    """Demo keşif oyununun kurgusal mekânı. Genel API (`/places`, check-in, pasaport) yalnızca bunu sunar.

    Gerçek eserler (`app.internal.catalog.RealMonument`) bu modele çevrilemez; onaylı gerçek eserler için
    ileride ayrı bir yayın modeli eklenecek.
    """

    model_config = ConfigDict(extra="forbid")

    id: DemoPlaceId
    name: str = Field(min_length=1)
    city: str = Field(min_length=1)
    description: str
    latitude: Latitude
    longitude: Longitude
    check_in_radius_m: float = Field(gt=0, description="Check-in için izin verilen yarıçap (metre)")
    source_title: Optional[str] = None
    source_url: Optional[HttpUrl] = None
    is_demo: Literal[True]


# Mevcut check-in ve pasaport kodu `Place` adını kullanır; genel API'deki her mekân bir demo mekânıdır.
Place = DemoPlace


class CheckInRequest(BaseModel):
    user_id: UserId
    latitude: Latitude
    longitude: Longitude


class CheckInStatus(str, Enum):
    COMPLETED = "completed"
    ALREADY_COMPLETED = "already_completed"
    OUT_OF_RANGE = "out_of_range"


class Stamp(BaseModel):
    place_id: str
    place_name: str
    earned_at: datetime


class CheckInResponse(BaseModel):
    success: bool
    status: CheckInStatus
    message: str
    place_id: str
    distance_m: float
    allowed_radius_m: float
    stamp: Optional[Stamp] = None


class Passport(BaseModel):
    user_id: str
    total_stamps: int
    stamps: list[Stamp]
