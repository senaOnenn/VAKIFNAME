"""Gerçek oyun döngüsü API'si.

**R6.7 ürün kararı:** oyuncu bir eseri seçer ve doğrudan bilgi görevini (5 soru, en az 4 doğru) oynar. Anlatımı
dinlemek ve rehbere soru sormak **isteğe bağlıdır** (öğrenme deneyimi; doğrulanınca bir kez XP verir) ve sınavın şartı
değildir. Eser kilidi yoktur (`route_routes.monument_locked` her zaman False). Gerçek ziyaret, bilgi mühründen sonra
ayrı bir bonus görevdir; mesafe kuralı, simülasyon işareti ve konumun saklanmaması aynen sürer. Durum yanıtındaki
alanlar korunur: `guide_required` artık her zaman False, `ready_for_quiz` bilgi mührü yoksa ve soru üretilebiliyorsa True.

(Aşağıdaki kademe açıklaması R6.7 öncesi kuraldır; kayıt için.)

Kademeler (ekip kararı, CLAUDE.md §2.6; soru kuralları için bkz. `game.py`):
1. **Dinle ve konuş**: anlatım sonuna kadar dinlendi (`listened`) ve rehbere en az bir soru soruldu (`asked`). Rehber
   herkese açık değilse (`VAKIFNAME_GUIDE_MODE` `on` değil ya da sağlayıcı girişi/anahtarı yok) soru şartı aranmaz:
   ziyaretçiden kullanamayacağı bir adım istenmez. Olaylar istemciden gelir ve bir kez kaydedilir.
2. **Rozeti Al**: yalnızca 1. kademe bitmişse ve eser kullanıcı için açıksa (rota kilidi, bkz.
   `route_routes.monument_locked`). 5 soru; en az 4 doğru bilgi mührü verir. Doğru cevaplar sunucuda kalır ve ancak
   gönderimden sonra açıklanır. Her sınav bir kez gönderilir ve `game.QUIZ_TTL` sonra geçersizdir. Kalınca yeni sınav
   açılabilir (önceki sınavda sorulmamış kayıtlar önceliklidir).
3. **Ziyaret**: yalnızca bilgi mühründen sonra. Bildirilen konum eserin onaylı noktasıyla karşılaştırılır (yarıçap:
   katalogdaki check-in noktası ve yarıçapı, yoksa harita konumu ve `VAKIFNAME_VISIT_RADIUS_M`). Sunum modunda
   (`VAKIFNAME_VISIT_SIMULATION=on`) istemci `simulate: true` ile mesafe denetimini atlayabilir (jüri sunumu); bu mühür
   `simulated` işaretiyle saklanır ve her yanıtta simülasyon olarak bildirilir. Konum yalnızca istek süresince
   kullanılır; hiçbir yerde saklanmaz veya loglanmaz.

API alan adlarında "demo" sözcüğü kullanılmaz (genel arayüz paketinin denetimi bu sözcüğü yasaklar); karşılığı
"simulation / simulated" ve arayüzde "sunum modu / simülasyon"dur.

Bütün uçlar ilerleme uçlarıyla aynı erişim kuralına uyar (`require_progress_access`) ve kullanıcı durumunu
`Cache-Control: no-store` ile döndürür.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from . import game
from .auth_routes import require_progress_access
from .models import Latitude, Longitude, UserId
from .progress import MonumentProgressStore
from .public_catalog import MonumentId, PublicMonument
from .route_routes import monument_locked

router = APIRouter(tags=["game"])

NOT_FOUND = "Eser bulunamadı veya henüz yayımlanmadı."
LOCKED = "Bu eser henüz kilitli. Rotadaki açık eserlerden birinin bilgi mührünü alınca sıradaki kilit açılır."
NEEDS_LISTEN = "Rozet için önce anlatımı sonuna kadar dinleyin."
NEEDS_LISTEN_AND_ASK = "Rozet için önce anlatımı sonuna kadar dinleyin ve rehbere en az bir soru sorun."
ALREADY_EARNED = "Bu eserin bilgi mührünü zaten aldınız."
NOT_ENOUGH = "Bu eser için henüz yeterli sayıda onaylı soru yok."
QUIZ_NOT_FOUND = "Sorular bulunamadı. Rozeti yeniden dene."
QUIZ_NOT_YOURS = "Bu sorular sana ait değil."
QUIZ_SUBMITTED = "Bu cevaplar zaten gönderildi."
QUIZ_EXPIRED = "Süre doldu. Rozeti yeniden dene."
ANSWERS_MISMATCH = "Her soruya tam olarak bir cevap gönderilmelidir."
BAD_CHOICE = "Geçersiz seçenek."
NO_LOCATION = "Bu eserin onaylı konumu olmadığı için ziyaret doğrulanamaz."
LOCATION_REQUIRED = "Ziyaret doğrulaması için enlem ve boylam birlikte gönderilmelidir."

QuizId = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{32}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EngagementRequest(_Strict):
    user_id: UserId
    event: Literal["listened", "asked"]


class QuizRequest(_Strict):
    user_id: UserId
    # en: yalnızca İngilizcesi onaylı kayıtlardan; yetmezse Türkçe sorular verilir ve yanıttaki `lang` bunu söyler.
    lang: Literal["tr", "en"] = "tr"


class QuizAnswer(_Strict):
    qid: Annotated[str, StringConstraints(pattern=r"^q[1-9]$")]
    # Doğru/yanlış sorusunda 1 = Doğru, 0 = Yanlış; diğerlerinde şık sırası (0 tabanlı).
    choice: int = Field(strict=True, ge=0, le=9)


class SubmitRequest(_Strict):
    user_id: UserId
    answers: list[QuizAnswer] = Field(min_length=1, max_length=game.QUIZ_SIZE)


class VisitRequest(_Strict):
    user_id: UserId
    latitude: Optional[Latitude] = None
    longitude: Optional[Longitude] = None
    simulate: bool = Field(default=False, strict=True)


def _progress(request: Request) -> MonumentProgressStore:
    return request.app.state.monument_progress


def _settings(request: Request) -> game.GameSettings:
    return request.app.state.game_settings


def _now(request: Request) -> datetime:
    return request.app.state.game_clock()


def _iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds")


def _monument(request: Request, monument_id: str) -> PublicMonument:
    m = request.app.state.monuments.get(monument_id)
    if m is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return m


def guide_required(request: Request) -> bool:
    """Rehber herkese açık ve sağlayıcısı kullanılabilir durumdaysa 1. kademede soru şartı aranır.

    Test modunda (`testers`) rehberi yalnızca test anahtarı olanlar kullanabildiği için genel ziyaretçiden istenmez.
    """
    if request.app.state.guide_mode != "on":
        return False
    provider = request.app.state.guide.provider
    return provider is not None and bool(provider.available()[0])


def seal_view(record: dict) -> dict:
    """Mühür kaydının genel görünümü: ziyaret mührü `simulated` (bool) taşır, bilgi mührü taşımaz."""
    out = {k: v for k, v in record.items() if k != "simulated"}
    if record["kind"] == "visit":
        out["simulated"] = bool(record.get("simulated"))
    return out


def _state(request: Request, m: PublicMonument, user_id: str) -> dict:
    store, settings = _progress(request), _settings(request)
    knowledge = store.seal(user_id, m.monument_id, "knowledge")
    visit = store.seal(user_id, m.monument_id, "visit")
    locked = knowledge is None and monument_locked(request, m, user_id)
    events = store.engagement(user_id, m.monument_id)
    listened, asked = "listened" in events, "asked" in events
    required = False  # R6.7: dinleme ve soru sorma isteğe bağlı; sınavın şartı değil
    # R6.8: içerik durumu ayrı bildirilir: onaylı kayıtlardan 5 soruluk sınav kurulabiliyor mu (arayüz "soru yok" ile
    # "başka bir neden"i karıştırmasın).
    available = game.quiz_capacity(request.app.state.monuments.catalog, m) >= game.QUIZ_SIZE
    ready = not locked and knowledge is None and available
    return {
        "monument_id": m.monument_id,
        "locked": locked,
        "listened": listened,
        "asked": asked,
        # R6.7: göreve başlandı mı (anlatım, rehbere soru ya da açılmış bir bilgi görevi); "Göreve Devam Et" için.
        "started": m.monument_id in store.started(user_id),
        "guide_required": required,
        "ready_for_quiz": ready,
        "quiz_available": available,
        "quiz_size": game.QUIZ_SIZE,
        "pass_mark": game.PASS_MARK,
        "knowledge": {"earned_at": knowledge["earned_at"]} if knowledge else None,
        "visit": {"earned_at": visit["earned_at"], "simulated": bool(visit["simulated"])} if visit else None,
        "visit_radius_m": game.visit_radius(m, settings),
        "simulated_visit_allowed": settings.visit_simulation,
        "site_notice": m.site_notice,
    }


@router.get("/monuments/{monument_id}/game")
def get_game(request: Request, response: Response, monument_id: Annotated[MonumentId, Path()], user_id: UserId):
    require_progress_access(request, user_id)
    m = _monument(request, monument_id)
    response.headers["Cache-Control"] = "no-store"
    return _state(request, m, user_id)


@router.post("/monuments/{monument_id}/engagement")
def post_engagement(request: Request, response: Response, body: EngagementRequest,
                    monument_id: Annotated[MonumentId, Path()]):
    """Kademe 1 olayı (tekrar gönderilirse durum değişmez). Anlatım ve sohbet kilitli eserde de açıktır."""
    require_progress_access(request, body.user_id)
    m = _monument(request, monument_id)
    _progress(request).record_engagement(body.user_id, m.monument_id, body.event)
    response.headers["Cache-Control"] = "no-store"
    # XP (dinleme 10, rehbere soru 20; eser başına birer kez) olay kaydıyla aynı anda depoda türetilir (bkz. xp.py).
    return _state(request, m, body.user_id)


class _NotEnoughQuestions(Exception):
    pass


@router.post("/monuments/{monument_id}/quiz", status_code=201)
def start_quiz(request: Request, response: Response, body: QuizRequest, monument_id: Annotated[MonumentId, Path()]):
    require_progress_access(request, body.user_id)
    m = _monument(request, monument_id)
    state = _state(request, m, body.user_id)
    if state["knowledge"] is not None:
        raise HTTPException(status_code=409, detail=ALREADY_EARNED)
    if state["locked"]:
        raise HTTPException(status_code=403, detail=LOCKED)
    catalog = request.app.state.monuments.catalog
    rng = request.app.state.game_rng
    lang = "en" if body.lang == "en" and game.english_ready(catalog, m) else "tr"

    def compose(previous: list[dict]) -> list[dict]:
        items = game.compose_quiz(catalog, m, rng, previous, lang)
        if len(items) < game.QUIZ_SIZE:
            raise _NotEnoughQuestions()
        return items

    now = _now(request)
    quiz_id, expires_at = uuid.uuid4().hex, _iso(now + game.QUIZ_TTL)
    try:
        items = _progress(request).start_quiz(quiz_id, body.user_id, m.monument_id, _iso(now), expires_at, compose)
    except _NotEnoughQuestions:
        raise HTTPException(status_code=409, detail=NOT_ENOUGH) from None
    response.headers["Cache-Control"] = "no-store"
    return {"quiz_id": quiz_id, "expires_at": expires_at, "lang": lang,
            "questions": [game.public_question(i) for i in items]}


@router.post("/quiz/{quiz_id}/submit")
def submit_quiz(request: Request, response: Response, body: SubmitRequest, quiz_id: Annotated[QuizId, Path()]):
    require_progress_access(request, body.user_id)
    store = _progress(request)
    quiz = store.quiz(quiz_id)
    if quiz is None:
        raise HTTPException(status_code=404, detail=QUIZ_NOT_FOUND)
    if quiz["user_id"] != body.user_id:
        raise HTTPException(status_code=403, detail=QUIZ_NOT_YOURS)
    if quiz["submitted_at"] is not None:
        raise HTTPException(status_code=409, detail=QUIZ_SUBMITTED)
    now = _now(request)
    if datetime.fromisoformat(quiz["expires_at"]) <= now:
        raise HTTPException(status_code=410, detail=QUIZ_EXPIRED)
    items = quiz["items"]
    answers = {a.qid: a.choice for a in body.answers}
    if len(answers) != len(body.answers) or set(answers) != {i["qid"] for i in items}:
        raise HTTPException(status_code=422, detail=ANSWERS_MISMATCH)
    if any(answers[i["qid"]] >= game.option_count(i) for i in items):
        raise HTTPException(status_code=422, detail=BAD_CHOICE)
    m = _monument(request, quiz["monument_id"])
    score, results = game.grade(items, answers)
    if not store.close_quiz(quiz_id, _iso(now), score):
        raise HTTPException(status_code=409, detail=QUIZ_SUBMITTED)
    passed = score >= game.PASS_MARK
    seal = None
    if passed:
        record, created = store.add_seal(body.user_id, m.monument_id, m.name, "knowledge")
        seal = {**seal_view(record), "new": created}
    response.headers["Cache-Control"] = "no-store"
    return {"score": score, "total": len(items), "passed": passed, "results": results, "knowledge_seal": seal}


@router.post("/monuments/{monument_id}/visit")
def visit(request: Request, response: Response, body: VisitRequest, monument_id: Annotated[MonumentId, Path()]):
    require_progress_access(request, body.user_id)
    m = _monument(request, monument_id)
    if (body.latitude is None) != (body.longitude is None):
        raise HTTPException(status_code=422, detail=LOCATION_REQUIRED)
    settings, store = _settings(request), _progress(request)
    target = game.visit_target(m, settings)
    if target is None:
        raise HTTPException(status_code=409, detail=NO_LOCATION)
    radius = game.visit_radius(m, settings)
    response.headers["Cache-Control"] = "no-store"

    def result(status: str, distance: Optional[float] = None, seal: Optional[dict] = None) -> dict:
        return {"status": status, "distance_m": None if distance is None else round(distance), "radius_m": radius,
                "visit_seal": seal}

    if store.seal(body.user_id, m.monument_id, "knowledge") is None:
        return result("needs_knowledge")
    existing = store.seal(body.user_id, m.monument_id, "visit")
    # Gerçek ziyaret mührü her durumda yeterlidir; simülasyon mührü yalnızca yeni bir gerçek ziyaretle gerçeğe döner.
    if existing is not None and (not existing["simulated"] or body.simulate):
        return result("already", seal={**seal_view(existing), "new": False})
    if body.simulate:
        if not settings.visit_simulation:
            return result("simulation_disabled")
        record, created = store.add_seal(body.user_id, m.monument_id, m.name, "visit", simulated=True)
        return result("gold", seal={**seal_view(record), "new": created})
    if body.latitude is None:
        raise HTTPException(status_code=422, detail=LOCATION_REQUIRED)
    distance = game.distance_m(target, body.latitude, body.longitude)
    if distance > target.radius_m:
        return result("out_of_range", distance)
    record, created = store.add_seal(body.user_id, m.monument_id, m.name, "visit")
    return result("gold", distance, {**seal_view(record), "new": created})
