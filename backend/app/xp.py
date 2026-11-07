"""XP ve seviye kuralları (R6.4, ürün kararı). Saf hesaplar; veri `progress.py` içindeki `xp_events` tablosundadır.

Ödüller (her biri **bir kez**; tekrar eden görev ikinci kez XP vermez):

| Kaynak (`source`)  | XP  | Kapsam (`scope`)     | Doğrulanmış kayıt                                                   |
|--------------------|-----|----------------------|---------------------------------------------------------------------|
| `first_discovery`  | 25  | hesap başına bir kez | hesabın ilk "dinledi" olayı ya da (eski oyuncularda) ilk mührü      |
| `listened`         | 10  | eser başına bir kez  | `engagement.listened`                                               |
| `listen_and_ask`   | 20  | eser başına bir kez  | R6.7: rehbere soru sordu (isteğe bağlı). R6.4'te "I. kademe tamam" |
| `knowledge`        | 50  | eser başına bir kez  | bilgi mührü (= vakfiye parçası; ayrıca ödül yok)                    |
| `visit`            | 100 | eser başına bir kez  | **gerçek** ziyaret mührü; sunum modundaki simülasyon ziyaret 0 XP   |

İlk keşif ile dinleme ayrı ödüllerdir: hesabın ilk dinlediği eserde ikisi birlikte verilir (25 + 10), sonraki eserlerde
yalnızca dinleme (10). İkisi de kendi anahtarıyla tekildir; biri ötekini ikinci kez tetiklemez.

10 eserlik pilotta azami toplam: 25 + 10 × (10 + 20 + 50 + 100) = **1825 XP**. Yalnızca çevrim içi (ziyaretsiz) azami
825 XP → seviye 6; seviye 7 en az 3, seviye 8 en az 7 gerçek ziyaret ister ("ziyaret en değerli adım", CLAUDE.md §2.6).

Seviye toplam XP'den deterministik hesaplanır (saklanmaz). Görünüm aşaması yalnızca kozmetiktir.

R6.7: dinleme ve rehbere soru isteğe bağlıdır; bilgi görevi (sınav) doğrudan oynanır. Kaynak adları ve miktarlar aynı
kaldı (azami toplam yine 1825): `listened` gerçekten dinlenince, `listen_and_ask` (adı geriye uyum için korunur) rehbere
gerçekten soru sorulunca verilir. Daha önce verilmiş satırlar silinmez ve ikinci kez verilmez.
"""

from typing import Literal

XpSource = Literal["first_discovery", "listened", "listen_and_ask", "knowledge", "visit"]

XP_RULES: dict[str, int] = {
    "first_discovery": 25,
    "listened": 10,
    "listen_and_ask": 20,
    "knowledge": 50,
    "visit": 100,
}

# Seviye n'e ulaşmak için gereken toplam XP (indis 0 = seviye 1).
LEVEL_THRESHOLDS: tuple[int, ...] = (0, 50, 150, 300, 500, 750, 1100, 1500)

Stage = Literal["baslangic", "gezginlik", "arastirmaci", "muhafiz"]


def level_for(xp: int) -> int:
    level = 1
    for i, need in enumerate(LEVEL_THRESHOLDS):
        if xp >= need:
            level = i + 1
    return level


def stage_for(level: int) -> Stage:
    """Kozmetik görünüm aşaması: 1–2 Başlangıç, 3–4 Gezginlik, 5–6 Araştırmacı, 7+ Vakfiye Muhafızı."""
    if level >= 7:
        return "muhafiz"
    if level >= 5:
        return "arastirmaci"
    if level >= 3:
        return "gezginlik"
    return "baslangic"


def progression(xp: int) -> dict:
    """Toplam XP → seviye, bulunulan seviyenin tabanı, sonraki seviyenin eşiği (en üst seviyede None) ve aşama."""
    level = level_for(xp)
    floor = LEVEL_THRESHOLDS[level - 1]
    nxt = LEVEL_THRESHOLDS[level] if level < len(LEVEL_THRESHOLDS) else None
    return {"xp": xp, "level": level, "level_xp": floor, "next_level_xp": nxt, "stage": stage_for(level),
            "max_level": len(LEVEL_THRESHOLDS)}
