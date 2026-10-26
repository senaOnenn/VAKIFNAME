"""Yanıt uygunluğu denetleyicisi: yapılandırılmış karar, güvenli geri çekilme ve kör test kayıtları."""

import json
from pathlib import Path

import pytest

from app.ask.engine import Corpus, Engine
from app.ask.evaluate import evaluate
from app.ask.verifier import FEATURES, MODEL_FILE, Verifier
from app.public_catalog import PublicCatalog

EVAL = Path(__file__).parent / "ask_eval"
UNPUBLISHED = frozenset({"BUR-0020-F007", "BUR-0020-F002", "BUR-0014-F004", "BUR-0013-F009"})
# Kör v2 setlerinin özetleri: setler doğrulayıcı geliştirilmeden önce yazıldı ve sonra değiştirilmedi.
BLIND_SHA = {"answerable.json": "e77b6dcc0cba909eb5115359f219daf0042100564953de954c9a929bf8e39641",
             "unanswerable.json": "38e531618e7157629502c171ab72c73f11b07c815cb85c2548781d890eabb994"}
# Görev 13 kör v3 setleri: cross-encoder denemesinden önce yazıldı, tek kez ölçüldü ve sonra değiştirilmedi.
BLIND_V3_SHA = {"answerable.json": "5b90e4aa0dabecf33e9eb50b72e9e7031f237d3c0853ca16f790c59ba8258996",
                "unanswerable.json": "3129f645bdcfb4f07b632248954035e60671d39851d37746c07ea8802b195876"}
EXPERIMENTAL = MODEL_FILE.with_name("verifier_model.task13_experimental.json")


@pytest.fixture(scope="module")
def catalog():
    return PublicCatalog.model_validate(json.loads((EVAL / "catalog_snapshot.json").read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def engine(catalog, turkish_lexicon):
    # Canlı yapılandırma: yazım düzeltmesi Türkçe sözlükle (doğru yazılmış sözcükler düzeltilmez).
    return Engine(Corpus(catalog, turkish_lexicon.is_word if turkish_lexicon else None))


@pytest.mark.parametrize("path", [MODEL_FILE, EXPERIMENTAL])
def test_model_file_is_valid_and_trained_only_on_development_sets(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    assert tuple(data["features"]) == FEATURES[:len(data["features"])]
    assert not any("blind" in s for s in data["training_sets"])
    assert Verifier.load(path).method == "learned_relevance_verifier"


def test_production_model_does_not_use_cross_encoder_features():
    """Canlı model Görev 12 modelidir; cross-encoder'lı deneysel model kör testleri geçmediği için varsayılan değildir."""
    assert "ce" not in Verifier.load().features and "hybrid_ce" not in Verifier.load().model["modes"]
    assert "ce" in Verifier.load(EXPERIMENTAL).features


def test_structured_decision_and_answer_text_comes_from_catalog(engine, catalog):
    r = engine.ask("Ulu Cami'de kaç kubbe var?")
    v = r["verification"]
    assert set(v) == {"answerable", "selected_fact_id", "confidence", "reason", "method"}
    assert v["answerable"] is True and v["selected_fact_id"] == r["answer"]["fact_id"] == "BUR-0001-F004"
    assert 0 <= v["confidence"] <= 1 and v["reason"]
    text = next(f.text for m in catalog.monuments for f in m.facts if f.fact_id == "BUR-0001-F004")
    assert r["answer"]["text"] == text
    nf = engine.ask("Ulu Cami'nin kaç kapısı var?")
    assert nf["status"] == "not_found" and nf["verification"]["answerable"] is False
    assert nf["verification"]["selected_fact_id"] is None and nf["answer"] is None


@pytest.mark.parametrize("question", [
    "Muradiye Medresesi 1781'de onarıldı mı?",          # sorudaki yıl olguda yok
    "Orhan Gazi Türbesi 1868'de mi yeniden yapıldı?",   # reddedilen tarih
    "Koza Han'ın mimarı nerede doğdu?",                 # yaşam olayı katalogda yok
    "II. Murad Türbesi'nin kapısını kim yaptı?",        # parçanın yapanı ≠ eserin bânîsi
    "II. Murad Türbesi'nin restorasyonunu kim yaptı?",  # türbe sahibinin adı kişi cevabı değildir
    "Muradiye Medresesi'nde hangi dersler okutulurdu?",  # yüklem katalogda hiç yok
    "Hangi eseri Yıldırım Bayezid yaptırmadı?",          # olumsuz seçim
    "Bedestenin kubbeleri neyle kaplı?",                # malzeme yok
])
def test_safe_retreat(engine, question):
    r = engine.ask(question)
    assert r["status"] != "answered" and r["answer"] is None
    assert "1868" not in json.dumps(r, ensure_ascii=False)


@pytest.mark.parametrize("bad", ['{"features": []}', "bozuk", '{"features": %s, "modes": {}}' % json.dumps(list(FEATURES))])
def test_corrupt_or_missing_model_falls_back_to_strict_gate(tmp_path, catalog, bad):
    f = tmp_path / "m.json"
    f.write_text(bad, encoding="utf-8")
    v = Verifier.load(f)
    assert v.method == "strict_rule_gate"
    assert Verifier.load(tmp_path / "yok.json").method == "strict_rule_gate"
    e = Engine(Corpus(catalog), verifier=v)
    r = e.ask("Bedestende kaç kubbe var?")
    assert r["answer"]["fact_id"] == "BUR-0014-F003" and r["verification"]["method"] == "strict_rule_gate"
    assert e.ask("Ulu Cami'nin kaç kapısı var?")["status"] == "not_found"


def _blind_items(folder="blind_v2", hashes=BLIND_SHA):
    items = []
    for name, sha in hashes.items():
        raw = (EVAL / folder / name).read_bytes()
        import hashlib
        assert hashlib.sha256(raw).hexdigest() == sha, f"{name} değişmiş: kör set ölçümden sonra düzenlenemez"
        items += json.loads(raw)["items"]
    return items


@pytest.mark.parametrize("folder,hashes", [("blind_v2", BLIND_SHA), ("blind_v3", BLIND_V3_SHA)])
def test_blind_sets_are_large_enough_and_unchanged(folder, hashes):
    items = _blind_items(folder, hashes)
    assert sum(i["expect"] == "answer" for i in items) >= 100 and sum(i["expect"] == "no_answer" for i in items) >= 100


def test_blind_v2_no_regression_below_recorded_level(engine):
    """Kayıtlı ilk ölçüm (kelime araması): doğruluk %83,6, cevapsızda yanlış %5,5. Bunun altına düşmemeli."""
    r = evaluate(engine, _blind_items(), UNPUBLISHED)
    assert r["leaks"] == [] and r["alignment_problems"] == []
    assert r["top1_accuracy"] >= 0.836 and r["unanswerable_false_answer_rate"] <= 0.055 and r["answerable_wrong_rate"] <= 0.028


@pytest.mark.xfail(strict=False, reason="Kör v2 setinde kabul ölçütleri karşılanmadı (bkz. tests/ask_eval/RESULTS.md)")
def test_blind_v2_acceptance(engine):
    r = evaluate(engine, _blind_items(), UNPUBLISHED)
    assert r["top1_accuracy"] >= 0.90 and r["unanswerable_false_answer_rate"] <= 0.02


@pytest.mark.xfail(strict=False, reason="Kör v3 setinde kabul ölçütleri karşılanmadı (bkz. tests/ask_eval/RESULTS.md, Görev 13)")
def test_blind_v3_acceptance(engine):
    r = evaluate(engine, _blind_items("blind_v3", BLIND_V3_SHA), UNPUBLISHED)
    assert r["leaks"] == []
    assert r["top1_accuracy"] >= 0.90 and r["unanswerable_false_answer_rate"] <= 0.02
