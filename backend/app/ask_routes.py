"""“Esere Sor” genel API'si: yayımlanmış olgulardan kaynaklı soru-cevap.

- Yalnızca genel katalog kullanılır (bkz. `app/ask`); dahili RAG, V20 kayıtları ve kaynak kitap metinleri bu uca bağlı
  değildir.
- Soru metni kaydedilmez ve loglanmaz. İstek sıklığı sınırı için istemci adresi yalnızca bellekte, birkaç dakika tutulur.
- Cevap LLM ile üretilmez; onaylı olgu metni, olgu kimliği, yayın kararı ve bağımsız kaynak bağlantılarıyla döner.
"""

import re
import threading
import time
from collections import deque
from typing import Annotated, Optional

from fastapi import APIRouter, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .ask.suggestions import suggestions_for
from .public_catalog import MonumentId

router = APIRouter(tags=["ask"])

MAX_QUESTION = 300
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=2, max_length=MAX_QUESTION)
    monument_id: Optional[MonumentId] = None

    @field_validator("question")
    @classmethod
    def _clean(cls, v: str) -> str:
        if _CONTROL.search(v):
            raise ValueError("Soru kontrol karakteri içeremez.")
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("Soru çok kısa.")
        return v


class RateLimiter:
    """İstemci başına kayan pencere sınırı ve genel üst sınır (yalnızca bellekte)."""

    def __init__(self, per_minute: int = 30, per_hour: int = 600, global_per_minute: int = 300, clock=time.monotonic,
                 max_clients: int = 10_000):
        self.per_minute, self.per_hour, self.global_per_minute = per_minute, per_hour, global_per_minute
        self.clock, self.max_clients = clock, max_clients
        self._clients: dict[str, deque] = {}
        self._global: deque = deque()
        self._lock = threading.Lock()

    def check(self, client: str) -> Optional[int]:
        """İzin verilirse None; aşıldıysa kaç saniye sonra yeniden denenebileceği."""
        now = self.clock()
        with self._lock:
            while self._global and now - self._global[0] > 60:
                self._global.popleft()
            if len(self._global) >= self.global_per_minute:
                return max(1, int(60 - (now - self._global[0])) + 1)
            q = self._clients.get(client)
            if q is None:
                if len(self._clients) >= self.max_clients:
                    self._clients.pop(next(iter(self._clients)))
                q = self._clients[client] = deque()
            while q and now - q[0] > 3600:
                q.popleft()
            last_minute = sum(1 for t in q if now - t <= 60)
            if last_minute >= self.per_minute:
                return max(1, int(60 - (now - q[-self.per_minute])) + 1)
            if len(q) >= self.per_hour:
                return max(1, int(3600 - (now - q[0])) + 1)
            q.append(now)
            self._global.append(now)
            return None


def _service(request: Request):
    # `VAKIFNAME_ASK_ENABLED=off` özelliği tamamen kapatır; arayüz bu durumda bölümü göstermez.
    if not request.app.state.ask_enabled:
        raise HTTPException(status_code=503, detail="Esere Sor şu anda kapalı.")
    return request.app.state.ask


@router.post("/monuments/ask")
def ask(body: AskRequest, request: Request, response: Response):
    service = _service(request)
    client = request.client.host if request.client else "unknown"
    retry = request.app.state.ask_limiter.check(client)
    if retry is not None:
        raise HTTPException(status_code=429, detail="Çok fazla soru gönderildi; lütfen biraz sonra tekrar deneyin.",
                            headers={"Retry-After": str(retry)})
    engine = service.engine()
    if body.monument_id and body.monument_id not in engine.corpus.monuments:
        raise HTTPException(status_code=404, detail="Eser bulunamadı veya henüz yayımlanmadı.")
    result = engine.ask(body.question, body.monument_id)
    response.headers["Cache-Control"] = "no-store"
    return {"question": body.question, **result}


@router.get("/monuments/ask/status")
def ask_status(request: Request):
    return _service(request).status()


@router.get("/monuments/{monument_id}/ask/suggestions")
def ask_suggestions(request: Request, monument_id: Annotated[MonumentId, Path()]):
    engine = _service(request).engine()
    m = engine.corpus.monuments.get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Eser bulunamadı veya henüz yayımlanmadı.")
    return {"monument_id": monument_id, "suggestions": suggestions_for(engine, monument_id)}
