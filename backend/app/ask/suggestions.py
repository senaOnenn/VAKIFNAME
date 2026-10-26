"""Eser başına örnek sorular. Yalnızca motorun o anki katalogda gerçekten o eserin bir olgusuyla cevapladığı adaylar
gösterilir; bir olgu yayından kalkarsa ona dayanan öneri kendiliğinden düşer."""

from functools import lru_cache

_CANDIDATES: dict[str, tuple[str, ...]] = {
    "BUR-0001": ("Ulu Cami'yi kim yaptırdı?", "Ulu Cami'de kaç kubbe var?", "Minberi kim yaptı?", "Caminin mimarı kim?",
                 "Ortadaki kubbe neden açık?"),
    "BUR-0003": ("Muradiye Camii'ni kim yaptırdı?", "Tabhaneler ne işe yarıyordu?", "Mihrap özgün mü?",
                 "Duvarları nasıl örülmüş?"),
    "BUR-0005": ("Medrese bugün ne olarak kullanılıyor?", "Avlusu nasıl?", "1855 depremi medreseyi etkiledi mi?"),
    "BUR-0007": ("II. Murad Türbesi'nin kubbesi neden açık?", "Türbeyi kim yaptırdı?", "Sütunlar nereden geldi?",
                 "Planı nasıl?"),
    "BUR-0008": ("Cem Sultan Türbesi kimin için yapıldı?", "Türbede kimler gömülü?", "Cem Sultan kimin kardeşidir?",
                 "Kubbede ne yazıyor?"),
    "BUR-0009": ("Koza Han'ı kim yaptırdı?", "Koza Han ne zaman inşa edildi?", "Avludaki mescidin altında ne var?",
                 "Hanın mimarı kim?"),
    "BUR-0013": ("Pirinç Han'ın eski adı ne?", "Pirinç Han'ı kim yaptırdı?", "Hanın mimarı kim?",
                 "Restorasyon kaç yıl sürdü?"),
    "BUR-0014": ("Bedestende kaç kubbe var?", "Bedesteni kim yaptırdı?", "Bedesten bugün ne olarak kullanılıyor?"),
    "BUR-0019": ("Osman Gazi nereye gömülmek istemişti?", "Türbede kaç sanduka var?", "Türbeyi kim yeniden yaptırdı?"),
    "BUR-0020": ("Orhan Gazi Türbesi ne zaman yeniden yapıldı?", "Türbenin planı nasıl?", "Türbe depremde yıkıldı mı?"),
}


def suggestions_for(engine, monument_id: str, limit: int = 4) -> list[str]:
    return list(_cached(engine, monument_id))[:limit]


@lru_cache(maxsize=64)
def _cached(engine, monument_id: str) -> tuple[str, ...]:
    out = []
    for q in _CANDIDATES.get(monument_id, ()):
        r = engine.ask(q, monument_id)
        a = r.get("answer") or {}
        if r["status"] == "answered" and a.get("monument_id") == monument_id and a.get("fact_id"):
            out.append(q)
    return tuple(out)
