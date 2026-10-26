"""OpenRouter / NVIDIA Nemotron bağlantı aracı (yalnızca operatör için; anahtarı hiçbir zaman yazdırmaz).

Kullanım (anahtar dosyasını okuyabilen hesapla, backend klasöründe):
  .venv/bin/python scripts/openrouter_check.py status                  # anahtar, kota, model ve yüz taraması (token harcamaz)
  .venv/bin/python scripts/openrouter_check.py smoke --yes             # 8 senaryo, 10 gerçek çağrı (üst sınır 12)
  .venv/bin/python scripts/openrouter_check.py smoke --yes --only 2_koza_han,7_yanlis_varsayim

Anahtar `VAKIFNAME_OPENROUTER_KEY_FILE` (varsayılan /etc/vakifname/secrets/openrouter_api_key) dosyasından okunur. Hesap
açma, şart kabulü veya kredi yükleme bu araçla yapılmaz; bunlar yetkili proje sorumlusunun işidir.

`smoke` her senaryoyu bir kez çalıştırır; 429 veya kota hatasında yeniden denemez ve kalan senaryoları atlar. Ardından kota
aşımı davranışı sağlayıcıyı çağırmadan, sıfır bütçeyle yerelde denenir. Görsel senaryolar yalnızca katalogda lisansı ve
yayın kararı kayıtlı, insan içermediği elle denetlenmiş fotoğrafları kullanır (görsel kimlikleri aşağıda sabit).

Değerlendirme: `checks` otomatik denetimdir. Ayrıca her cümle için atıf yapılan onaylı olguların metni yanına yazılır ve
cümledeki içerik sözcüklerinin bu metinlerde geçme oranı (`support`) hesaplanır; 0,6'nın altı `elle incele` işaretlenir.
Kaynak kimliğinin geçerli olması yeterli değildir: her işaretli cümle olgu metniyle elle karşılaştırılmalıdır.
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ask.service import AskService  # noqa: E402
from app.guide.budget import DailyBudget  # noqa: E402
from app.guide.privacy import FaceScreen  # noqa: E402
from app.guide.provider import DEFAULT_BASE_URL, DEFAULT_MODEL, OpenRouterProvider, ProviderError  # noqa: E402
from app.guide.secret import key_path, load_key  # noqa: E402
from app.guide.service import GuideService, GuideSettings, budget_from_env  # noqa: E402
from app.public_catalog import PublicCatalogRepository  # noqa: E402

CATALOG = ROOT.parent / "data" / "public_catalog" / "catalog.json"
MEDIA = ROOT.parent / "data" / "public_catalog" / "media"
MAX_SMOKE_CALLS = 12


def _provider() -> OpenRouterProvider:
    return OpenRouterProvider(DEFAULT_BASE_URL)


def cmd_status(_):
    key, st = load_key()
    print(f"Anahtar dosyası: {key_path()} → {st}")
    print("Yüz taraması:", "hazır" if FaceScreen().available else "KULLANILAMIYOR (fotoğraf analizi kapalı kalır)")
    if key is None:
        return 1
    p = _provider()
    try:
        info = p.key_info()
        # `label` anahtarın bir parçasını içerebildiği için yazdırılmaz.
        print("Anahtar bilgisi:", json.dumps({k: info.get(k) for k in ("free_model_daily_requests", "is_free_tier", "limit",
                                                                         "limit_remaining", "usage_daily")},
                                             ensure_ascii=False))
    except ProviderError as e:
        print("Anahtar bilgisi okunamadı:", e.kind, e.status)
    try:
        m = next((m for m in p.models() if m["id"] == DEFAULT_MODEL), None)
    except ProviderError as e:
        print("Model listesi okunamadı:", e.kind, e.status)
        return 1
    if m is None:
        print(f"Model bulunamadı: {DEFAULT_MODEL}")
        return 1
    print(f"Model: {m['id']} · girdi={m.get('architecture', {}).get('input_modalities')} · bağlam={m.get('context_length')} "
          f"· fiyat={m.get('pricing', {}).get('prompt')}/{m.get('pricing', {}).get('completion')} "
          f"· response_format={'response_format' in (m.get('supported_parameters') or [])}")
    return 0


# Elle denetlendi: insan veya yüz yok; Wikimedia Commons, CC lisanslı, hak ve yayın kararı kayıtlı.
TEST_PHOTOS = {
    "KOZA_HAN_GIRIS": ("BUR-0009", "commons/BUR-0009/6d934f8e20d3a72f"),   # giriş cephesi, F. Bini, CC BY-SA 4.0
    "ULU_CAMI_KUBBE": ("BUR-0001", "commons/BUR-0001/a95f5166c6ce2420"),   # kubbe ve hat, A. Vyshnevska, CC BY-SA 4.0
}
ALLOWED_LICENSES = ("CC-BY-", "CC-BY-SA-", "CC0", "PD")


def _photo(key: str) -> bytes:
    monument_id, image_id = TEST_PHOTOS[key]
    cat = json.loads(CATALOG.read_text(encoding="utf-8"))
    m = next(m for m in cat["monuments"] if m["monument_id"] == monument_id)
    img = next(i for i in m["images"] if i["image_id"] == image_id)
    if not img.get("license", "").startswith(ALLOWED_LICENSES) or not img.get("publication_decision_id"):
        raise SystemExit(f"{image_id}: lisans veya yayın kararı uygun değil")
    return (MEDIA / (img.get("card_file") or img["file"])).read_bytes()


# (ad, soru, açık eser, test fotoğrafı, beklenen durumlar, cevapta geçmesi beklenen ifadeler, geçmemesi gerekenler)
SCENARIOS = [
    ("1_basit_sohbet", "Merhaba! Bursa'daki türbeler hakkında bana kısaca bilgi verir misin?", None, None,
     {"answered"}, [], []),
    ("2_koza_han", "Koza Han'ı kim yaptırdı ve avlusunun ortasında ne bulunuyor?", None, None, {"answered"}, ["Bayezid"], []),
    ("3_ulu_cami_mimari", "Ulu Cami'nin mimari özellikleri nelerdir?", None, None, {"answered"}, ["kubbe"], []),
    ("4_katalogda_yok", "Ulu Cami'nin yapımında kaç işçi çalıştı ve inşaat kaç altına mal oldu?", None, None,
     {"insufficient_evidence"}, [], ["işçi çalış", "altına mal"]),
    ("5_gorsel_mimari", "Bu fotoğrafta hangi mimari özellikler görülüyor?", None, "KOZA_HAN_GIRIS",
     {"answered", "clarification_required", "monument_not_identified"}, [], []),
    ("6_fotograf_kaynakli", "Bu yapıyı kim yaptırdı?", None, "ULU_CAMI_KUBBE",
     {"answered", "clarification_required", "monument_not_identified"}, [], []),
    ("7_yanlis_varsayim", "Ulu Cami'yi Mimar Sinan 1550'de yaptı, değil mi?", None, None, {"answered"}, ["Bayezid"],
     ["1550"]),
    ("8_yapilandirilmis", "Muradiye Camii'ni kim yaptırdı ve yapının özellikleri nelerdir? Her bilgiyi kaynağıyla ver.",
     None, None, {"answered"}, ["Murad"], []),
]
SUPPORT_REVIEW_BELOW = 0.6


def _support(sentence: str, texts: list[str]) -> float:
    """Cümledeki içerik sözcüklerinin (≥4 harf) atıf yapılan olgu metinlerinde kök olarak geçme oranı."""
    from app.ask.text import fold, stem
    words = [stem(w) for w in fold(sentence).split() if len(w) >= 4]
    pool = {stem(w) for t in texts for w in fold(t).split()}
    return round(sum(w in pool for w in words) / len(words), 2) if words else 1.0


def _review(r: dict, docs_by_id: dict) -> list[dict]:
    out = []
    for s in r["sentences"]:
        texts = [docs_by_id[i] for i in s["sources"] if i in docs_by_id]
        score = _support(s["text"], texts) if texts else None
        out.append({"text": s["text"], "sources": s["sources"], "cited_texts": texts, "support": score,
                    "flag": "fotoğraf gözlemi" if s["sources"] == ["FOTOGRAF"] else
                            ("elle incele" if score is None or score < SUPPORT_REVIEW_BELOW else "")})
    return out


def _checks(name: str, r: dict, expected: set, must: list[str], forbidden: list[str], review: list[dict]) -> dict:
    text = " ".join(s["text"] for s in r["sentences"])
    cited = {f["fact_id"] for f in r["facts"]} | {i["id"] for i in r["identities"]} | {"FOTOGRAF"}
    return {
        "generative": r["mode"] == "generative",
        "expected_status": r["status"] in expected,
        "structured_json_parsed": r["fallback_reason"] != "parse_error",
        "every_sentence_cited": all(s["sources"] and set(s["sources"]) <= cited for s in r["sentences"]),
        "cited_facts_have_independent_sources": all(f["sources"] for f in r["facts"]),
        "contains_expected": all(m in text for m in must),
        "no_unsupported_premise": not any(f in text for f in forbidden),
        "sentences_needing_manual_review": sum(1 for x in review if x["flag"] == "elle incele"),
    }


def cmd_smoke(args):
    if not args.yes:
        print(f"Gerçek çağrılar yapılır (en çok {MAX_SMOKE_CALLS}); yetkili sorumlunun onayıyla --yes ekleyin.")
        return 1
    key, st = load_key()
    if key is None:
        print(f"Anahtar yok veya güvensiz: {st}")
        return 1
    only = set(args.only.split(",")) if args.only else None
    ask = AskService(PublicCatalogRepository(CATALOG), background=False)
    p = _provider()
    # Test çağrıları uygulamanın kalıcı kota sayacına da yazılır (aynı dosya); bu çalıştırma en çok MAX_SMOKE_CALLS harcar.
    app_budget = budget_from_env()
    used, left = app_budget.status()["calls"], app_budget.status()["remaining_calls"]
    allowed = min(MAX_SMOKE_CALLS, left)
    print(f"Uygulama kotası bugün: {used} kullanıldı, {left} kaldı · bu çalıştırmaya izin: {allowed}")
    if allowed < 10:
        print("Bütün senaryolar için en az 10 çağrı gerekir; yarın (UTC) yeniden deneyin veya --only kullanın.")
        if not only:
            return 1
    budget = DailyBudget(app_budget.path, used + allowed, app_budget.max_tokens, max_per_minute=app_budget.max_per_minute)
    svc = GuideService(ask, p, budget, GuideSettings.from_env(), face_screen=FaceScreen())
    print("Görsel model:", svc.vision_model(), "· yüz taraması:", svc.photo_enabled())
    out, stop = {}, None
    docs_by_id = {d.fact_id: f"{d.monument_name}. {d.title}. {d.text}" for d in ask.engine().corpus.docs}
    docs_by_id |= {f"{m.monument_id}-KIMLIK": f"{m.name} {' '.join(m.alternative_names)} {m.type} {m.district} {m.city}"
                   for m in ask.engine().corpus.monuments.values()}
    for name, q, mid, photo_of, expected, must, forbidden in SCENARIOS:
        if only and name not in only:
            continue
        if stop:
            out[name] = {"skipped": stop}
            continue
        r = svc.ask(q, mid, image_bytes=_photo(photo_of) if photo_of else None)
        if r["fallback_reason"] in ("quota", "rate_limited", "busy", "budget", "circuit_open"):
            stop = f"önceki senaryoda {r['fallback_reason']}; yeniden deneme yapılmadı"
        review = _review(r, docs_by_id)
        out[name] = {"q": q, "photo": TEST_PHOTOS[photo_of][1] if photo_of else None, "mode": r["mode"],
                     "status": r["status"], "fallback": r["fallback_reason"], "message": r["message"],
                     "review": review, "missing": r["missing"],
                     "cited_facts": [{"id": f["fact_id"], "certainty": f["certainty"],
                                      "sources": [s.get("url") for s in f["sources"]]} for f in r["facts"]],
                     "removed": r.get("_removed"), "photo_observation": r.get("photo"), "options": r["options"],
                     "usage": r["usage"], "models": r["models"],
                     "checks": _checks(name, r, expected, must, forbidden, review)}
        print(f"\n== {name}: {q}\n" + json.dumps(out[name], ensure_ascii=False, indent=1))
    if not only or "kota_asimi" in only:
        # Kota aşımı: sıfır bütçeli servis sağlayıcıyı çağırmadan kaynaklı aramaya dönmeli.
        empty = GuideService(ask, p, DailyBudget(None, 0, 0), GuideSettings.from_env(), face_screen=FaceScreen())
        r = empty.ask("Koza Han'ı kim yaptırdı?")
        out["kota_asimi"] = {"mode": r["mode"], "fallback": r["fallback_reason"], "message": r["message"],
                               "provider_calls": r["usage"]["calls"],
                               "checks": {"fallback_search": r["mode"] == "fallback_search" and r["usage"]["calls"] == 0}}
        print("\n== kota_asimi (yerel, çağrısız)\n" + json.dumps(out["kota_asimi"], ensure_ascii=False, indent=1))
    out["budget_after"] = svc.budget.status()
    print("\nBu çalıştırmadaki kullanım:", json.dumps(out["budget_after"], ensure_ascii=False))
    if args.out:
        Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    s = sub.add_parser("smoke")
    s.add_argument("--yes", action="store_true")
    s.add_argument("--only", help="virgülle ayrılmış senaryo adları")
    s.add_argument("--out")
    args = ap.parse_args()
    return {"status": cmd_status, "smoke": cmd_smoke}[args.cmd](args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
