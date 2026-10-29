"""Seslendirme uçları (Faz 8; bkz. `tts.py`).

- `GET /speech/status`: seslendirme açık mı (kapalıysa arayüz tarayıcı sesini kullanır).
- `POST /monuments/{id}/speech {text}`: cümle eserin onaylı anlatımına aitse ses dosyasının adresi (yoksa üretilir).
- `GET /speech/audio/{file}`: önbellekteki ses dosyası.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from .public_catalog import MonumentId
from .tts import MAX_TEXT, TtsError, narration_texts

router = APIRouter(tags=["speech"])


class SpeechRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(min_length=1, max_length=MAX_TEXT)]


def _speech(request: Request):
    return request.app.state.speech


@router.get("/speech/status")
def speech_status(request: Request):
    return _speech(request).status()


@router.post("/monuments/{monument_id}/speech")
def speak(request: Request, body: SpeechRequest, monument_id: Annotated[MonumentId, Path()]):
    service = _speech(request)
    if not service.enabled:
        raise HTTPException(status_code=503, detail="Seslendirme kapalı.")
    m = request.app.state.monuments.get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Eser bulunamadı veya henüz yayımlanmadı.")
    if body.text not in narration_texts(m):
        raise HTTPException(status_code=422, detail="Yalnızca eserin onaylı anlatımı seslendirilir.")
    if service.path(service.file_for(body.text)) is None:
        # Yalnızca yeni üretim sınırlanır; önbellekteki ses serbest.
        client = request.client.host if request.client else "unknown"
        retry = request.app.state.speech_limiter.check(client)
        if retry is not None:
            raise HTTPException(status_code=429, detail="Çok sık istek; biraz sonra deneyin.", headers={"Retry-After": str(retry)})
    try:
        file, _ = service.ensure(body.text)
    except TtsError as e:
        raise HTTPException(status_code=503, detail=f"Seslendirme şu anda yapılamıyor ({e.kind}).") from e
    return {"url": f"/speech/audio/{file}"}


@router.get("/speech/audio/{file}")
def audio(request: Request, file: Annotated[str, Path(pattern=r"^[0-9a-f]{64}\.mp3$")]):
    path = _speech(request).path(file)
    if path is None:
        raise HTTPException(status_code=404, detail="Ses bulunamadı.")
    return FileResponse(path, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})
