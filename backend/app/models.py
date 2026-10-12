from datetime import datetime
from enum import Enum
from typing import Annotated, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, StringConstraints

Latitude = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False, description="Enlem (WGS84)")]
Longitude = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False, description="Boylam (WGS84)")]
PlaceId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
UserId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class Place(BaseModel):
    """Eser kaydı. Resmî veri aktarımında da aynı şema kullanılır."""

    model_config = ConfigDict(extra="forbid")

    id: PlaceId
    name: str = Field(min_length=1)
    city: str = Field(min_length=1)
    description: str
    latitude: Latitude
    longitude: Longitude
    check_in_radius_m: float = Field(gt=0, description="Check-in için izin verilen yarıçap (metre)")
    source_title: Optional[str] = None
    source_url: Optional[HttpUrl] = None
    is_demo: bool


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
