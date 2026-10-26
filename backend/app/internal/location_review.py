"""Koordinat adaylarının karşılaştırmalı inceleme tablosu (yalnızca okuma).

Bu modül hiçbir koordinatı doğrulamaz ve hiçbir karar üretmez; yalnızca konum incelemecisinin görmesi gereken
belirsizlikleri adaylardan türetir:

- Aynı eser için birbiriyle çelişen adaylar (araştırmadaki bir tutarsızlık kaydı iki adayın kaynağını birden içeriyorsa),
- adayın neyi temsil ettiği (bina izi merkezi, kullanım alanı merkezi, nokta nesnesi) ve bunun bir giriş noktası olmadığı,
- yalnızca çapraz kontrol amaçlı kaynaklar (Wikidata),
- aynı külliyede/çarşıda başka bir esere çok yakın düşen adaylar (check-in karışması),
- ibadet veya kabir alanı olan eserler.

GPS check-in için güvenli giriş noktası araştırmada hiçbir eser için yoktur; `checkin_entry_point` her zaman `None`'dır.
"""

from itertools import combinations
from typing import Optional

from ..geo import haversine_m
from .research import CoordinateCandidate, MonumentResearch, ResearchCatalog

# Başka bir eserin adayına bu mesafeden yakın aday, check-in yarıçapında karışabilir.
NEAR_OTHER_MONUMENT_M = 60.0

FLAG_LABELS = {
    "competing_candidate": "Aynı eser için çelişen aday; hangi yapının işaretleneceği çözülmeden kullanılamaz.",
    "area_not_building": "Kullanım alanının merkezi; bina sınırı değildir.",
    "centroid_not_entrance": "Bina/alan merkezi; güvenli giriş noktası değildir.",
    "point_without_footprint": "Yapı izi olmayan nokta nesnesi; konumu düşük güvenle temsil eder.",
    "crosscheck_only": "Kaynağı belirtilmemiş açık bilgi tabanı değeri; yalnızca çapraz kontrol içindir.",
    "candidates_disagree": "Adaylar arası mesafe adayların tahmini doğruluğundan büyük.",
    "near_other_monument": "Başka bir eserin adayına çok yakın; check-in yarıçapları çakışabilir.",
    "worship_site": "Aktif ibadet mekânı; check-in noktası avlu/harim dışında seçilmeli.",
    "burial_site": "Kabir/türbe alanı; check-in noktası kabir alanı dışında seçilmeli.",
}


def _competing(r: MonumentResearch) -> dict[str, list[str]]:
    """Aday kimliği -> onunla çelişen adaylar ve ilgili tutarsızlık kimlikleri."""
    out: dict[str, list[str]] = {}
    for a, b in combinations(r.location_candidates, 2):
        if a.source_id == b.source_id:
            continue
        shared = [d.discrepancy_id for d in r.discrepancies if {a.source_id, b.source_id} <= set(d.source_ids)]
        if shared:
            out.setdefault(a.candidate_id, []).extend(shared)
            out.setdefault(b.candidate_id, []).extend(shared)
    return {k: sorted(set(v)) for k, v in out.items()}


def candidate_rows(research: ResearchCatalog, location_status: dict[str, str]) -> list[dict]:
    all_candidates: list[tuple[str, CoordinateCandidate]] = [
        (mid, c) for mid, r in research.monuments.items() for c in r.location_candidates
    ]
    rows = []
    for mid, r in research.monuments.items():
        competing = _competing(r)
        for c in r.location_candidates:
            source = r.source(c.source_id)
            others = [
                {"candidate_id": o.candidate_id,
                 "distance_m": round(haversine_m(c.latitude, c.longitude, o.latitude, o.longitude), 1)}
                for o in r.location_candidates if o.candidate_id != c.candidate_id
            ]
            nearest: Optional[dict] = None
            for omid, o in all_candidates:
                if omid == mid:
                    continue
                d = haversine_m(c.latitude, c.longitude, o.latitude, o.longitude)
                if nearest is None or d < nearest["distance_m"]:
                    nearest = {"monument_id": omid, "candidate_id": o.candidate_id, "distance_m": round(d, 1)}

            flags = []
            if c.candidate_id in competing:
                flags.append("competing_candidate")
            if c.represents == "area_centroid":
                flags.append("area_not_building")
            if c.represents != "entrance":
                flags.append("centroid_not_entrance")
            if c.represents == "point_feature" and source.kind == "open_map_data":
                flags.append("point_without_footprint")
            if source.kind == "open_knowledge_base":
                flags.append("crosscheck_only")
            others_by_id = {o.candidate_id: o for o in r.location_candidates}
            if any(o["distance_m"] > max(c.estimated_accuracy_m, others_by_id[o["candidate_id"]].estimated_accuracy_m)
                   for o in others):
                flags.append("candidates_disagree")
            if nearest is not None and nearest["distance_m"] < NEAR_OTHER_MONUMENT_M:
                flags.append("near_other_monument")
            if r.site_context.active_place_of_worship:
                flags.append("worship_site")
            if r.site_context.burial_site:
                flags.append("burial_site")

            rows.append({
                "monument_id": mid,
                "monument_name": r.full_name,
                "candidate_id": c.candidate_id,
                "latitude": c.latitude,
                "longitude": c.longitude,
                "represents": c.represents,
                "estimated_accuracy_m": c.estimated_accuracy_m,
                "source_id": c.source_id,
                "source_kind": source.kind,
                "source_object": c.source_object,
                "status": c.status,
                "monument_location_status": location_status.get(mid, "missing"),
                "notes": c.notes,
                "other_candidates": others,
                "nearest_other_monument": nearest,
                "competing_discrepancy_ids": competing.get(c.candidate_id, []),
                "flags": flags,
                "checkin_entry_point": None,
            })
    return rows
