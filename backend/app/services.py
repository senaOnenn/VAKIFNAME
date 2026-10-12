import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from pydantic import TypeAdapter

from .geo import haversine_m
from .models import CheckInResponse, CheckInStatus, Passport, Place, Stamp


class PlaceRepository:
    """Eser verisini bir JSON dosyasından okur ve bellekte tutar."""

    def __init__(self, places_file: Path):
        raw = json.loads(Path(places_file).read_text(encoding="utf-8"))
        places = TypeAdapter(list[Place]).validate_python(raw)
        ids = [p.id for p in places]
        duplicates = {i for i in ids if ids.count(i) > 1}
        if duplicates:
            raise ValueError(f"Yinelenen eser ID'leri: {sorted(duplicates)}")
        self._places = {p.id: p for p in places}

    def list(self) -> list[Place]:
        return list(self._places.values())

    def get(self, place_id: str) -> Optional[Place]:
        return self._places.get(place_id)


class ProgressStore:
    """Bellek içi kullanıcı ilerlemesi. Sunucu yeniden başlatılınca sıfırlanır."""

    def __init__(self):
        self._stamps: dict[str, dict[str, Stamp]] = {}
        self._lock = threading.Lock()

    def add_stamp(self, user_id: str, place: Place) -> tuple[Stamp, bool]:
        """Mühür ekler; zaten varsa mevcut mührü ve False döndürür."""
        with self._lock:
            user_stamps = self._stamps.setdefault(user_id, {})
            existing = user_stamps.get(place.id)
            if existing:
                return existing, False
            stamp = Stamp(place_id=place.id, place_name=place.name, earned_at=datetime.now(timezone.utc))
            user_stamps[place.id] = stamp
            return stamp, True

    def get_stamps(self, user_id: str) -> list[Stamp]:
        with self._lock:
            return list(self._stamps.get(user_id, {}).values())


def check_in(place: Place, user_id: str, latitude: float, longitude: float, progress: ProgressStore) -> CheckInResponse:
    """İstemcinin bildirdiği konumu eserin yarıçapıyla karşılaştırır.

    Koordinatlar doğrulanmaz; bu yalnızca MVP simülasyonudur ve GPS sahteciliğini engellemez.
    """
    # Karar yuvarlanmamış mesafeyle verilir; yalnızca yanıtta gösterilen değer yuvarlanır.
    distance = haversine_m(latitude, longitude, place.latitude, place.longitude)
    shown_distance = round(distance, 1)
    common = {"place_id": place.id, "distance_m": shown_distance, "allowed_radius_m": place.check_in_radius_m}

    if distance > place.check_in_radius_m:
        return CheckInResponse(
            success=False,
            status=CheckInStatus.OUT_OF_RANGE,
            message=f"Bildirilen konum eserin {place.check_in_radius_m:g} m yarıçapı dışında ({shown_distance:g} m).",
            **common,
        )

    stamp, created = progress.add_stamp(user_id, place)
    if not created:
        return CheckInResponse(
            success=True,
            status=CheckInStatus.ALREADY_COMPLETED,
            message="Bu görev daha önce tamamlanmış; yeni mühür eklenmedi.",
            stamp=stamp,
            **common,
        )
    return CheckInResponse(
        success=True,
        status=CheckInStatus.COMPLETED,
        message="Görev tamamlandı; pasaporta mühür eklendi.",
        stamp=stamp,
        **common,
    )


def get_passport(user_id: str, progress: ProgressStore) -> Passport:
    stamps = progress.get_stamps(user_id)
    return Passport(user_id=user_id, total_stamps=len(stamps), stamps=stamps)
