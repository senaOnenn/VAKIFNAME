"""Kayıp Vakfiye belgesinin TEK ve sabit yerleşimi (R6.9).

Her eserin belgede değişmez bir parça yuvası (slot) vardır; parçalar kazanılma sırasıyla değil, bu yuvaya göre çizilir.
Arayüzdeki bütün ekranlar (Vakfiye Odası, Mühür Defteri) yerleşimi `GET /vakfiye/layout` ucundan alır; böylece aynı
oyuncu için dolu/boş yuvalar her ekranda birebir aynıdır. Kimlikler sunucudadır (arayüz kaynağında katalog kimliği
bulunmaz; bkz. tests/test_internal_api.py).

Bursa pilotu: 10 yuva, katalog kimliği sırasıyla. Yeni şehir için kendi listesi yazılır. Listede olmayan (sonradan
yayımlanan) eser, listedekilerden sonra kimlik sırasıyla yer alır: var olan yuvalar hiç kaymaz.
"""

from typing import Iterable

LAYOUT: dict[str, tuple[str, ...]] = {
    "bursa": ("BUR-0001", "BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008",
              "BUR-0009", "BUR-0013", "BUR-0014", "BUR-0019", "BUR-0020"),
}


def slots(city: str, published_ids: Iterable[str]) -> list[str]:
    """Şehrin yayımlanmış (rotadaki) eserleri yuva sırasıyla."""
    published = set(published_ids)
    fixed = [mid for mid in LAYOUT.get(city, ()) if mid in published]
    return fixed + sorted(published - set(fixed))
