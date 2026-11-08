"""Oyuncu profili (R6.3): karakter seçimi.

- Yalnızca oturumu açık hesap okur ve yazar; kimlik istekten değil **oturumdan** alınır (başkasının profili istenemez,
  misafir karakter seçemez: 401).
- Karakterler yalnızca görünüştür: oyunda güç, avantaj veya farklı kural sağlamaz (belgelerde böyle bir mekanik yoktur).
- Seçim yapılmadan profil boştur (`character: null`); sunucu varsayılan karakter atamaz.
- Profil mühür, vakfiye ve rota ilerlemesinden ayrı tutulur; seçim veya değişiklik ilerlemeye dokunmaz.
- XP ve seviye (R6.4, `xp.py`): yalnızca sunucudaki doğrulanmış kayıtlardan türetilir; istemci gönderemez (gövde
  yalnızca `character_id` kabul eder). Profil okunurken eski kayıtlardan eksik XP geriye dönük türetilir (eski oyuncular
  sıfıra düşmez). Seviye toplam XP'den hesaplanır; görünüm aşaması yalnızca kozmetiktir.
- `GET /player/xp`: hesabın XP kazanımları ve nedenleri (denetlenebilir; yalnızca kendi kaydı).
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict

from .auth_routes import GAME_SIGN_IN, current_user
from .progress import MonumentProgressStore
from .xp import progression

router = APIRouter(tags=["player"])

# Kâşif kimlikleri (8 Kasım: Buse'nin çizimleri, kadın ve erkek kâşif). Adlar ve görseller arayüzdedir. 8 Kasım öncesi
# kimlikler (gezgin, nakkas, katip) kayıtlarda kalabilir; okunurken olduğu gibi döner, arayüz erkek kâşif olarak gösterir.
# Yeni seçimde yalnızca güncel kimlikler kabul edilir.
CHARACTERS = ("kadin", "erkek")
CharacterId = Literal["kadin", "erkek"]


class CharacterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    character_id: CharacterId


def _store(request: Request) -> MonumentProgressStore:
    return request.app.state.monument_progress


def _account(request: Request) -> dict:
    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail=GAME_SIGN_IN)
    return user


def _public(request: Request, user_id: str, profile: dict | None) -> dict:
    store = _store(request)
    store.sync_xp(user_id, "backfill")
    character = None if profile is None else {"id": profile["character_id"], "chosen_at": profile["chosen_at"]}
    recent = [{k: e[k] for k in ("source", "monument_id", "amount", "earned_at")} for e in store.xp_events(user_id, 3)]
    return {"character": character, "progress": {**progression(store.xp_total(user_id)), "recent": recent}}


@router.get("/player/profile")
def get_profile(request: Request, response: Response):
    user = _account(request)
    response.headers["Cache-Control"] = "no-store"
    return _public(request, user["id"], _store(request).profile(user["id"]))


@router.get("/player/xp")
def get_xp(request: Request, response: Response):
    user = _account(request)
    response.headers["Cache-Control"] = "no-store"
    store = _store(request)
    store.sync_xp(user["id"], "backfill")
    return {"total": store.xp_total(user["id"]), "events": store.xp_events(user["id"])}


@router.put("/player/character")
def put_character(body: CharacterRequest, request: Request, response: Response):
    user = _account(request)
    response.headers["Cache-Control"] = "no-store"
    store = _store(request)
    return _public(request, user["id"], store.set_character(user["id"], body.character_id))
