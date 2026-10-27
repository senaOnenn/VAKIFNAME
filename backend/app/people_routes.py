"""Eserle ilgili tarihî kişi kartları (`GET /monuments/{id}/people`).

Anlatıcı her eserde yerel rehberdir (K4); tarihî kişi (eserin banisi, burada yatan, yeniden yaptıran) yalnızca bir kartla
gösterilir ve kişi adına konuşulmaz. Eşleme `data/real_catalog/people.json` dosyasındadır; her kart yayımlanmış bir
kayda bağlıdır, kartın metni o kaydın metnidir. Kayıt yayında yoksa ya da `match` kaydın metninde geçmiyorsa kart
gösterilmez (yanlış eşleme kesin bilgi gibi sunulmaz).
"""

import json
import logging
from pathlib import Path
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Path as PathParam, Request, Response

from .public_catalog import MonumentId

router = APIRouter(tags=["monuments"])
log = logging.getLogger("vakifname.people")

DEFAULT_PEOPLE_FILE = Path(__file__).resolve().parents[2] / "data" / "real_catalog" / "people.json"
ROLE_LABEL = {"bani": "Eserin banisi", "medfun": "Burada yatıyor", "yeniden_yaptiran": "Yeniden yaptıran"}
ROLE_ORDER = {"medfun": 0, "bani": 1, "yeniden_yaptiran": 2}


def load_people(path: Optional[Path] = None) -> list[dict]:
    try:
        data = json.loads(Path(path or DEFAULT_PEOPLE_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        log.warning("kişi eşleme dosyası okunamadı; kişi kartları gösterilmeyecek")
        return []
    out = []
    for p in data.get("people", []):
        if isinstance(p, dict) and p.get("role") in ROLE_LABEL and all(isinstance(p.get(k), str) and p[k] for k in
                                                                         ("monument_id", "person", "fact_id", "match")):
            out.append(p)
    return out


def people_for(monument, mapping: list[dict]) -> list[dict]:
    facts = {f.fact_id: f for f in monument.facts}
    cards = []
    for p in mapping:
        if p["monument_id"] != monument.monument_id:
            continue
        f = facts.get(p["fact_id"])
        if f is None or p["match"] not in f.text:
            log.warning("kişi kartı atlandı: %s %s (kayıt yayında değil veya eşleşmiyor)", p["monument_id"], p["fact_id"])
            continue
        cards.append({"name": p["person"], "role": p["role"], "role_label": ROLE_LABEL[p["role"]], "fact_id": f.fact_id,
                      "text": f.text, "certainty": f.certainty,
                      "source": f"{f.source.title}, s. {f.source.pdf_physical_page}"})
    return sorted(cards, key=lambda c: ROLE_ORDER[c["role"]])


@router.get("/monuments/{monument_id}/people")
def get_people(request: Request, response: Response, monument_id: Annotated[MonumentId, PathParam()]):
    m = request.app.state.monuments.get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Eser bulunamadı veya henüz yayımlanmadı.")
    mapping = getattr(request.app.state, "people", None)
    if mapping is None:
        mapping = request.app.state.people = load_people()
    response.headers["Cache-Control"] = "no-cache"
    return {"monument_id": monument_id, "people": people_for(m, mapping)}
