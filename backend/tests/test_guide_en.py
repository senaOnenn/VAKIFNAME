"""İngilizce rehber (Faz 11): yalnızca eserin onaylı İngilizce kayıtları; her cümle kayıt kimliği taşır, kayıtta geçmeyen
sayı içeren ya da kimliksiz cümle atılır; İngilizce kayıt yoksa dürüst cevap; sağlayıcı yoksa uydurma yok."""

import json
from pathlib import Path

from app.ask.service import AskService
from app.guide.budget import DailyBudget
from app.guide.provider import MockProvider, ProviderError
from app.guide.service import GuideService, GuideSettings
from app.public_catalog import PublicCatalogRepository

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
DEC = "DEC-" + "e" * 16


def catalog_with_english(tmp_path: Path) -> Path:
    raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    for m in raw["monuments"]:
        if m["monument_id"] != "BUR-0001":
            continue
        m["name_en"] = "Grand Mosque of Bursa"
        f = m["facts"][0]
        f.update(title_en="Built by Bayezid", text_en="Sultan Yildirim Bayezid commissioned the mosque; it was completed in 1399.",
                 en_page=20, en_decision_id=DEC)
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    return path


def service(tmp_path, responder=None, fail=None):
    ask = AskService(PublicCatalogRepository(catalog_with_english(tmp_path)), background=False)
    provider = MockProvider(responder or (lambda m, msgs: "{}"), fail=fail)
    return GuideService(ask, provider, DailyBudget(None, 100, 1_000_000), GuideSettings()), provider


def reply(*sentences):
    return json.dumps({"sentences": [{"text": t, "sources": s} for t, s in sentences]})


def test_answers_only_from_approved_english_records(tmp_path):
    svc, provider = service(tmp_path, lambda m, msgs: reply(
        ("Sultan Yildirim Bayezid commissioned this mosque, completed in 1399.", ["BUR-0001-F001"]),
        ("It has twenty domes.", []),  # kaynaksız: atılır
        ("It was restored in 1855.", ["BUR-0001-F001"]),  # kayıtta olmayan sayı: atılır
        ("Made up record.", ["BUR-0001-F999"]),  # verilmemiş kimlik: atılır
    ))
    r = svc.ask("Who built it?", "BUR-0001", lang="en")
    assert r["status"] == "answered" and r["monument"] == {"monument_id": "BUR-0001", "name": "Grand Mosque of Bursa"}
    assert [s["text"] for s in r["sentences"]] == ["Sultan Yildirim Bayezid commissioned this mosque, completed in 1399."]
    assert r["removed_claims"] == 3
    assert r["facts"][0]["text"].startswith("Sultan Yildirim Bayezid") and r["facts"][0]["certainty_label"] == "Documented in the sources"
    prompt = provider.calls[0]["messages"][-1]["content"]
    assert "[BUR-0001-F001]" in prompt and "BUR-0001-F002" not in prompt  # yalnızca İngilizcesi onaylı kayıtlar
    assert r["notice"].startswith("The guide is a character")


def test_no_english_records_is_honest_and_calls_no_model(tmp_path):
    svc, provider = service(tmp_path)
    r = svc.ask("Who built it?", "BUR-0019", lang="en")
    assert r["status"] == "insufficient_evidence" and "don't have approved English records" in r["message"]
    assert provider.calls == [] and r["sentences"] == []


def test_not_found_and_provider_failure(tmp_path):
    svc, _ = service(tmp_path, lambda m, msgs: reply())
    assert svc.ask("What colour is the carpet?", "BUR-0001", lang="en")["status"] == "not_found"
    svc, _ = service(tmp_path, fail=ProviderError("quota"))
    r = svc.ask("Who built it?", "BUR-0001", lang="en")
    assert r["status"] == "unavailable" and r["sentences"] == [] and r["fallback_reason"] == "quota"
    svc, _ = service(tmp_path)
    assert svc.ask("Who built it?", None, lang="en")["status"] == "monument_not_identified"
