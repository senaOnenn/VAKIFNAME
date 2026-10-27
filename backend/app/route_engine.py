"""Rota motoru (saf fonksiyonlar, HTTP'den bağımsız): başlangıç noktası, açık eser sınırı (kilitler) ve yürüyüş sırası.

Kurallar (ekip kararı, CLAUDE.md §2.7):
- Kullanıcının o eserde **bilgi mührü** varsa eser tamamlanmıştır. Tamamlanan eser her zaman açık sayılır.
- Kullanıcının her an `min(3, kalan)` tane açık ve tamamlanmamış eseri olur. İlk açılışta başlangıç noktasına en yakın 3
  eser açılır; bilgi mührü kazanıldıkça sınır yeniden doldurulur, yani her bilgi mührü bir kilit daha açar. Açılan kilit
  kalıcıdır (`progress.unlocks`); kullanıcı yer değiştirince hiçbir eser yeniden kilitlenmez.
- Başlangıç noktası önceliği: (1) şehir merkezine 30 km içindeyse kullanıcının konumu, (2) o şehirde en son tamamlanan
  eser, (3) şehir merkezi (şehrin katalog koordinatlarının ortalaması). Sınır doldurma da aynı noktayı kullanır; konum
  verilmezse bir eser tamamlanınca açılan kilit, ona en yakın kilitli eserdir.
- Yürüyüş sırası bir öneridir, kilit değildir: tamamlanmamış eserler üzerinde başlangıçtan en yakın komşu turu. Eşit
  uzaklıkta kimliği (`monument_id`) küçük olan önce gelir; sonuç girdinin sırasına bağlı değildir (Muradiye'de 100 m içinde
  dört eser var).
"""

import unicodedata
from dataclasses import dataclass
from statistics import fmean
from typing import Iterable, Literal, Optional, Sequence

from .geo import haversine_m

FRONTIER_SIZE = 3
USER_START_MAX_M = 30_000

StartSource = Literal["user", "last_completed", "city_center"]

# "İ" küçültülmeden önce "i" yapılır (Python "İ".lower() → "i̇"); ayrık yazılmış noktalar (U+0307) da atılır.
_FOLD = str.maketrans({"ı": "i", "ş": "s", "ğ": "g", "ü": "u", "ö": "o", "ç": "c", "̇": None})


def city_slug(name: str) -> str:
    """Şehir adını kısa ada çevirir: küçük harf, Türkçe harfler katlanır (`İ/ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c`)."""
    return unicodedata.normalize("NFC", name).strip().replace("İ", "i").lower().translate(_FOLD)


@dataclass(frozen=True)
class Point:
    monument_id: str
    name: str
    type: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Completion:
    """Bilgi mührü (eser tamamlandı); `visit` aynı eserde ziyaret mührü de var mı (altın mühür)."""

    monument_id: str
    earned_at: str
    visit: bool


@dataclass(frozen=True)
class Start:
    source: StartSource
    latitude: float
    longitude: float


@dataclass(frozen=True)
class Stop:
    point: Point
    unlocked: bool
    distance_m: float  # başlangıç noktasından
    order: int  # 1'den başlar


@dataclass(frozen=True)
class RoutePlan:
    start: Start
    stops: tuple[Stop, ...]  # yalnızca tamamlanmamış eserler, yürüyüş sırasıyla
    completed: tuple[tuple[Point, Completion], ...]  # en son tamamlanan önce
    next: Optional[str]  # sıradaki ilk açık eser
    new_unlocks: tuple[str, ...]  # bu planda açılan (kalıcı yazılacak) eserler


def _distance(lat: float, lng: float, p: Point) -> float:
    return haversine_m(lat, lng, p.latitude, p.longitude)


def city_center(points: Sequence[Point]) -> tuple[float, float]:
    """Şehrin katalog koordinatlarının ortalaması (şehir ölçeğinde düzlem ortalaması yeterlidir)."""
    if not points:
        raise ValueError("Şehir merkezi için en az bir eser gerekir.")
    return fmean(p.latitude for p in points), fmean(p.longitude for p in points)


def choose_start(points: Sequence[Point], completions: Iterable[Completion],
                 user_location: Optional[tuple[float, float]] = None) -> Start:
    """Başlangıç noktası. `completions` en son tamamlanan önce sıralı olmalıdır; başka şehirdeki eserler atlanır."""
    center = city_center(points)
    if user_location is not None and haversine_m(*user_location, *center) <= USER_START_MAX_M:
        return Start("user", *user_location)
    by_id = {p.monument_id: p for p in points}
    last = next((by_id[c.monument_id] for c in completions if c.monument_id in by_id), None)
    if last is not None:
        return Start("last_completed", last.latitude, last.longitude)
    return Start("city_center", *center)


def _by_distance(lat: float, lng: float, points: Iterable[Point]) -> list[Point]:
    return sorted(points, key=lambda p: (_distance(lat, lng, p), p.monument_id))


def greedy_tour(lat: float, lng: float, points: Iterable[Point]) -> list[Point]:
    """En yakın komşu turu: her adımda bulunulan noktaya en yakın, henüz sıraya girmemiş eser (eşitlikte küçük kimlik)."""
    remaining = {p.monument_id: p for p in points}
    tour: list[Point] = []
    while remaining:
        nearest = min(remaining.values(), key=lambda p: (_distance(lat, lng, p), p.monument_id))
        tour.append(remaining.pop(nearest.monument_id))
        lat, lng = nearest.latitude, nearest.longitude
    return tour


def frontier_top_up(start: Start, points: Sequence[Point], completed_ids: set[str], unlocked_ids: set[str],
                    size: int = FRONTIER_SIZE) -> list[str]:
    """Açık ve tamamlanmamış eser sayısını `min(size, kalan)`'a tamamlamak için açılacak eserler (başlangıca en yakın).

    Hiçbir eseri kilitlemez: sınır doluysa veya taşmışsa (ör. misafir ve hesap ilerlemesi birleşince) boş liste döner.
    """
    open_points = [p for p in points if p.monument_id not in completed_ids]
    active = sum(p.monument_id in unlocked_ids for p in open_points)
    need = min(size, len(open_points)) - active
    if need <= 0:
        return []
    locked = [p for p in open_points if p.monument_id not in unlocked_ids]
    return [p.monument_id for p in _by_distance(start.latitude, start.longitude, locked)[:need]]


def plan_route(points: Sequence[Point], completions: Sequence[Completion], unlocked_ids: Iterable[str],
               user_location: Optional[tuple[float, float]] = None) -> RoutePlan:
    """Bir şehrin rotası. `completions` kullanıcının bütün bilgi mühürleri, en son kazanılan önce; `unlocked_ids` kalıcı
    açılmış eserler (başka şehirlerinkiler de olabilir, yok sayılır)."""
    by_id = {p.monument_id: p for p in points}
    done = tuple((by_id[c.monument_id], c) for c in completions if c.monument_id in by_id)
    completed_ids = {p.monument_id for p, _ in done}
    start = choose_start(points, completions, user_location)
    unlocked = set(unlocked_ids)
    new = frontier_top_up(start, points, completed_ids, unlocked)
    unlocked.update(new)
    tour = greedy_tour(start.latitude, start.longitude, (p for p in points if p.monument_id not in completed_ids))
    stops = tuple(Stop(p, p.monument_id in unlocked, _distance(start.latitude, start.longitude, p), i)
                  for i, p in enumerate(tour, 1))
    first_open = next((s.point.monument_id for s in stops if s.unlocked), None)
    return RoutePlan(start, stops, done, first_open, tuple(new))
