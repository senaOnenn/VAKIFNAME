"""Hat: kitap sayfalarından aday kayıt çıkarma (yalnızca taslak üretir, hiçbir şeyi yayımlamaz).

Rehberin sağlayıcısı kullanılır (`VAKIFNAME_GUIDE_PROVIDER`; `claude-cli` ise abonelik). Model yalnızca öneri yapar;
her adayın kitaptan **birebir alıntısı** belirtilen sayfada (ya da bitişik sayfada; sayfa düzeltilir) bulunmalıdır, yoksa
aday düşer. Kalan adaylar `origin=pipeline` taslağıdır ve yönetici onaylamadan hiçbir yerde görünmez.
"""

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from ..guide.provider import ProviderError
from . import pdftext
from .store import CATEGORIES, CERTAINTY, ContentStore

logger = logging.getLogger("vakifname.content")

MAX_PAGES = 6
MAX_CANDIDATES = 8
PAGE_CHARS = 7000  # sayfa başına modele giden en fazla metin (iki dilli sayfalar ~4–5 bin karakter)
MIN_QUOTE_WORDS = 6

SYSTEM_PROMPT = f"""Sen Vakıf Eserleri Envanter Projesi için çalışan titiz bir araştırma yardımcısısın. Görevin, verilen kitap
sayfalarından YALNIZCA adı verilen esere ait ve sayfada AÇIKÇA yazan bilgileri kayıt adayı olarak çıkarmaktır.
Kurallar:
- Sayfada yazmayan hiçbir bilgiyi ekleme. Tahmin, yorum, genel kültür yok.
- Her aday için sayfadan BİREBİR alıntı ver: kelimeleri değiştirme, kısaltma ve "..." kullanma; en az {MIN_QUOTE_WORDS}, en fazla 60 kelime.
- "text": alıntıdaki bilgiyi aşmayan, sade Türkçe 1–2 cümle. Sayfa iki dilliyse Türkçe bölümü kullan.
- "title": en fazla 8 kelimelik kısa başlık.
- "certainty": kaynak bilgiyi kesin veriyorsa "documented"; "rivayete göre", "anlatılır" gibi ise "reported";
  "muhtemelen", "tahminen", "olabilir" gibi ise "uncertain".
- "category": şunlardan biri: {", ".join(CATEGORIES)}.
- "page": alıntının geçtiği sayfa numarası (verilen "=== Sayfa N ===" başlıklarındaki N).
- Başka bir esere ait bilgiyi alma. Aynı bilgiyi iki kez verme. En fazla {MAX_CANDIDATES} aday.
Yalnızca şu biçimde tek bir JSON nesnesi döndür:
{{"facts": [{{"title": "", "text": "", "quote": "", "page": 0, "category": "", "certainty": ""}}]}}"""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _json_object(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("JSON yok")
    obj = json.loads(text[start:end + 1])
    if not isinstance(obj, dict):
        raise ValueError("JSON nesnesi değil")
    return obj


def candidates(raw: dict, pages: list[str], page_from: int, page_to: int, known: set[str]) -> tuple[list[dict], int]:
    """Model çıktısını denetler: (kabul edilen adaylar, düşen aday sayısı)."""
    items = raw.get("facts") if isinstance(raw.get("facts"), list) else []
    accepted, dropped, seen = [], 0, set(known)
    for item in items[:MAX_CANDIDATES * 2]:
        if not isinstance(item, dict):
            dropped += 1
            continue
        title, text, quote = (str(item.get(k) or "").strip() for k in ("title", "text", "quote"))
        try:
            page = int(item.get("page"))
        except (TypeError, ValueError):
            page = page_from
        found = pdftext.quote_page(pages, page, quote) if len(quote.split()) >= MIN_QUOTE_WORDS else None
        if found is None or not page_from - 1 <= found <= page_to + 1 or not title or len(text) < 10:
            dropped += 1
            continue
        key, qkey = pdftext.squash(text), pdftext.squash(quote)
        if key in seen or qkey in seen:
            dropped += 1
            continue
        seen |= {key, qkey}
        accepted.append({
            "title": title[:120], "text": text[:1200], "quote": quote[:1500], "page": found,
            "category": item.get("category") if item.get("category") in CATEGORIES else "historical_event",
            "certainty": item.get("certainty") if item.get("certainty") in CERTAINTY else "uncertain",
        })
        if len(accepted) >= MAX_CANDIDATES:
            break
    return accepted, dropped + max(0, len(items) - MAX_CANDIDATES * 2)


class Pipeline:
    def __init__(self, store: ContentStore, provider, model: str, background: bool = True, timeout_s: float = 240.0):
        self.store, self.provider, self.model, self.timeout_s = store, provider, model, timeout_s
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="icerik-hatti") if background else None

    def available(self) -> tuple[bool, str]:
        if self.provider is None:
            return False, "Rehber modeli yapılandırılmadı (VAKIFNAME_GUIDE_PROVIDER)."
        ok, status = self.provider.available()
        return ok, "" if ok else f"Rehber modeli kullanılamıyor ({status})."

    def submit(self, source_id: str, monument_id: str, page_from: int, page_to: int, actor: str) -> dict:
        job = self.store.create_job(source_id, monument_id, page_from, page_to, actor)
        if self._pool is not None:
            self._pool.submit(self.run, job["job_id"], actor)
        else:
            self.run(job["job_id"], actor)
        return self.store.job(job["job_id"])

    def run(self, job_id: str, actor: str):
        store = self.store
        job = store.job(job_id)
        store.update_job(job_id, status="running")
        try:
            monument = store.monument(job["monument_id"])
            pages = store.pages(job["source_id"])
            chunk = "\n\n".join(f"=== Sayfa {p} ===\n{pages[p - 1][:PAGE_CHARS]}"
                                for p in range(job["page_from"], job["page_to"] + 1))
            user = (f"Eser: {monument['name']} ({monument['type']}, {monument['city']})\n"
                    f"Kaynak: {store.source(job['source_id'])['title']}\n\n{chunk}")
            result = self.provider.chat(self.model, [{"role": "system", "content": SYSTEM_PROMPT},
                                                     {"role": "user", "content": user}],
                                        max_tokens=4000, temperature=0.0, json_mode=True, timeout_s=self.timeout_s)
            raw = _json_object(result.text)
            accepted, dropped = candidates(raw, pages, job["page_from"], job["page_to"],
                                           store.known_fact_texts(job["monument_id"]))
            for c in accepted:
                store.create_fact(job["monument_id"], {**c, "source_id": job["source_id"], "game_use": False,
                                                       "quest": None}, "pipeline", False, actor)
            store.update_job(job_id, status="done", candidates=len(accepted), dropped=dropped, finished_at=_now())
            logger.info("İçerik hattı %s: %d aday taslak, %d düştü (eser %s, kaynak %s s.%d–%d)", job_id, len(accepted),
                        dropped, job["monument_id"], job["source_id"], job["page_from"], job["page_to"])
        except ProviderError as e:
            store.update_job(job_id, status="failed", finished_at=_now(),
                             error=f"Model çağrısı başarısız ({e.kind}). Biraz sonra yeniden deneyin.")
        except (ValueError, KeyError) as e:
            logger.warning("İçerik hattı %s: model çıktısı okunamadı: %s", job_id, type(e).__name__)
            store.update_job(job_id, status="failed", finished_at=_now(),
                             error="Model çıktısı okunamadı; yeniden deneyin.")
        except Exception:  # noqa: BLE001 — iş başarısız sayılır, sunucu düşmez
            logger.exception("İçerik hattı %s beklenmeyen hata", job_id)
            store.update_job(job_id, status="failed", finished_at=_now(), error="Beklenmeyen hata.")


def content_model(default: str) -> str:
    return os.environ.get("VAKIFNAME_CONTENT_MODEL", "").strip() or default


def content_dir_from_env() -> Optional[str]:
    return os.environ.get("VAKIFNAME_CONTENT_DIR", "").strip() or None
