"""Yazım hatalarına dayanıklı arama (Görev 25): sorgu düzeltme, açıklama sorusu, rehberin yedek araması ve tekrar deneme.

Ağsız: sahte sağlayıcı ve kelime araması. Gerçek NVIDIA çağrısı yapılmaz.
"""

import hashlib
import json
import sys
from pathlib import Path

import pytest

from app.ask.engine import Corpus, Engine
from app.guide.budget import DailyBudget
from app.guide.provider import ProviderError
from app.guide.retrieval import gather
from app.guide.service import GuideSettings
from app.public_catalog import PublicCatalog

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from eval_typos import run, summary  # noqa: E402

from tests.test_guide import VISION_MODELS, answer, make_service  # noqa: E402

EVAL = Path(__file__).parent / "ask_eval"
CATALOG = EVAL / "catalog_snapshot.json"
KOZA_ARCHITECT = "BUR-0009-F004"
TYPO_BLIND_SHA = "e625137fa014f99ff792dbfa40ba00d9b2ec116b332196c9ae5c7f4edb9bb4af"


def _catalog():
    return PublicCatalog.model_validate(json.loads(CATALOG.read_text(encoding="utf-8")))


@pytest.fixture(scope="module")
def lexicon(turkish_lexicon):
    if turkish_lexicon is None:
        pytest.skip("zeyrek sözlüğü yüklenemedi")
    return turkish_lexicon


@pytest.fixture(scope="module")
def engine():
    return Engine(Corpus(_catalog()))


@pytest.fixture(scope="module")
def engine_lex(lexicon):
    return Engine(Corpus(_catalog(), lexicon.is_word))


def _items(name):
    return json.loads((EVAL / name).read_text(encoding="utf-8"))["items"]


# --- Sorgu düzeltme -------------------------------------------------------------------------------------------------

def test_reported_question_is_corrected_but_not_trusted(engine):
    fix = engine.corpus.correct("kza ahnn nmari ne")
    assert fix.text == "koza han mimari ne" and fix.display == "Koza Han mimarı ne"
    # Üç içerik sözcüğünün üçü de tahmin: cevap doğrudan gösterilmez, açıklama sorusu sorulur.
    assert not fix.confident()


def test_correctly_spelled_question_is_not_changed(engine):
    for q in ("Koza Han'ın mimarı kim?", "koza hanın mimarı", "Ulu Cami'yi kim yaptırdı?"):
        assert not engine.corpus.correct(q).changed, q


@pytest.mark.parametrize("q,gold", [(i["q"], i["gold"]) for i in _items("typo_set.json")
                                    if i["group"] == "task_examples" and i["q"] != "kza ahnn nmari ne"])
def test_task_examples_are_answered_with_the_right_fact(engine, q, gold):
    r = engine.ask(q)
    assert r["status"] == "answered" and r["answer"]["fact_id"] in gold, (q, r["status"], r.get("answer"))


@pytest.mark.parametrize("ctx", [None, "BUR-0009"])
def test_reported_question_asks_did_you_mean_with_the_architect_record(engine, ctx):
    r = engine.ask("kza ahnn nmari ne", ctx)
    assert r["status"] == "clarification_required" and r["answer"] is None
    assert "mı demek istediniz" in r["message"] and r["interpreted_question"] == "Koza Han mimarı ne"
    assert [s["fact_id"] for s in r["suggestions"]] == [KOZA_ARCHITECT]
    # Onaylanınca sorulan düzeltilmiş soru doğrudan cevaplanır.
    again = engine.ask(r["suggestions"][0]["question"], r["suggestions"][0]["monument_id"])
    assert again["status"] == "answered" and again["answer"]["fact_id"] == KOZA_ARCHITECT


def test_guide_evidence_for_reported_question_is_koza_han(engine):
    ev = gather(engine, "kza ahnn nmari ne")
    assert ev.status == "ok" and [m.monument_id for m in ev.monuments] == ["BUR-0009"]
    assert KOZA_ARCHITECT in [d.fact_id for d in ev.docs[:5]] and ev.interpreted == "Koza Han mimarı ne"


# --- Genel Türkçe sözlük: doğru sözcük düzeltilmez -------------------------------------------------------------------

@pytest.mark.parametrize("q,word", [("Koza Han'ın mimarı nereli?", "nereli"),
                                    ("Cem Sultan'ın naaşı hangi şehirden getirildi?", "sehirden")])
def test_real_turkish_words_outside_the_catalog_are_kept(engine_lex, q, word):
    fix = engine_lex.corpus.correct(q)
    assert word in fix.text.split()
    # Soru anlamı değişmediği için ilgisiz bir olgu cevap diye gösterilmez (kör setlerdeki iki hata).
    assert engine_lex.ask(q)["status"] != "answered"


@pytest.mark.parametrize("q,fixed", [("cem sutlan türbesinin kubbesinde ne yazıyor", "sultan"),
                                     ("koza hab ne zaman yapildi", "han"), ("pirinc hanin mimari kin", "kim"),
                                     ("pirinc hnin eski adi ne", "hanin")])
def test_typo_that_is_also_a_word_is_fixed_towards_a_name_or_question_word(engine_lex, q, fixed):
    assert fixed in engine_lex.corpus.correct(q).text.split()


def test_lexicon_ignores_abbreviation_and_guessed_proper_noun_parses(lexicon):
    assert lexicon.is_word("şehirden") and lexicon.is_word("nereli")
    assert not lexicon.is_word("hnin") and not lexicon.is_word("nmari") and not lexicon.is_word("kza")


# --- Ölçüm setleri ---------------------------------------------------------------------------------------------------

def test_typo_set_thresholds(engine_lex):
    s = summary(run(engine_lex, _items("typo_set.json"))["groups"])
    t = s["typo_answerable"]
    assert t["n"] == 119 and t["top5"] >= 0.98 and t["correct"] >= 0.95 and t["wrong"] <= 0.01, t
    assert s["unanswerable"]["safe"] == 1.0 and s["alignment_problems"] == 0


def test_typo_blind_set_recorded_level(engine_lex):
    """Kör set (bir kez çalıştırıldı, sonradan değiştirilmez): yazım hatalı 47 soruda ilk 5 %100, ilk cevap doğru %91,5,
    yanlış %2,1; cevapsız 20 soruda güvenli %85 (3 hata görev öncesiyle aynı, yazım düzeltmesinden bağımsız)."""
    raw = (EVAL / "typo_blind.json").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == TYPO_BLIND_SHA, "kör set ölçümden sonra düzenlenemez"
    s = summary(run(engine_lex, json.loads(raw)["items"])["groups"])
    t = s["typo_answerable"]
    assert t["n"] == 47 and t["top5"] >= 0.97 and t["correct"] >= 0.89 and t["wrong"] <= 0.025, t
    assert s["unanswerable"]["safe"] >= 0.85 and s["alignment_problems"] == 0


# --- Rehber: yedek arama ve tekrar deneme ----------------------------------------------------------------------------

FAST = GuideSettings(retry_backoff_s=0)


def test_guide_fallback_finds_the_architect_record_for_the_reported_question():
    calls = []

    def responder(model, messages):
        calls.append(1)
        raise ProviderError("unavailable", 502, code="502", upstream="Nvidia")
    budget = DailyBudget(None, 40, 1_000_000)
    svc, _ = make_service(responder, models=VISION_MODELS, budget=budget, settings=FAST)
    r = svc.ask("kza ahnn nmari ne")
    assert r["mode"] == "fallback_search" and r["fallback_reason"] == "unavailable"
    assert r["search"]["status"] == "clarification_required"
    assert [s["fact_id"] for s in r["search"]["suggestions"]] == [KOZA_ARCHITECT]
    # Olgu gösterilmediği için "aşağıdaki bilgi özgün metindir" denmez; teknik ayrıntı gösterilmez.
    assert "özgün metni" not in r["message"] and "502" not in r["message"] and "Nvidia" not in r["message"]
    assert len(calls) == 2 and budget.status()["calls"] == 2  # bir kez yeniden denendi, ikisi de kotadan düştü


def test_guide_fallback_shows_original_record_when_the_search_answers():
    svc, _ = make_service(lambda m, msgs: (_ for _ in ()).throw(ProviderError("unavailable", 502)),
                          models=VISION_MODELS, settings=FAST)
    r = svc.ask("koza han mimari kim")
    assert r["mode"] == "fallback_search" and r["search"]["answer"]["fact_id"] == KOZA_ARCHITECT
    assert "yapay zekâ tarafından üretilmedi" in r["message"]


def test_transient_upstream_error_is_retried_once_and_answer_is_generative():
    calls = []

    def responder(model, messages):
        calls.append(messages)
        if len(calls) == 1:
            raise ProviderError("unavailable", 502, code="502", upstream="Nvidia")
        prompt = messages[-1]["content"]
        assert KOZA_ARCHITECT in prompt and "<<<Koza Han mimarı ne>>>" in prompt  # düzeltilmiş okuma ipucu
        return answer(("Koza Han'ın mimarı Pulad Şah oğlu Abdülûlâ'dır.", [KOZA_ARCHITECT]))
    budget = DailyBudget(None, 40, 1_000_000)
    svc, _ = make_service(responder, models=VISION_MODELS, budget=budget, settings=FAST)
    r = svc.ask("kza ahnn nmari ne")
    assert r["mode"] == "generative" and r["status"] == "answered" and r["sentences"][0]["sources"] == [KOZA_ARCHITECT]
    assert len(calls) == 2 and budget.status()["calls"] == 2 and r["usage"]["calls"] == 1


@pytest.mark.parametrize("err", [ProviderError("rate_limited", 429), ProviderError("timeout"),
                                 ProviderError("quota", 429), ProviderError("bad_request", 400),
                                 ProviderError("unavailable", None, code="transport:ConnectError")])
def test_other_errors_are_not_retried(err):
    calls = []

    def responder(model, messages):
        calls.append(1)
        raise err
    svc, _ = make_service(responder, models=VISION_MODELS, settings=FAST)
    assert svc.ask("Ulu Cami'yi kim yaptırdı?")["mode"] == "fallback_search" and len(calls) == 1


def test_retry_respects_deadline():
    calls = []

    def responder(model, messages):
        calls.append(1)
        raise ProviderError("unavailable", 502)
    # İlk çağrı yapılır (kalan ~10 sn ≥ 9,5); beklemeden sonra kalan süre 9,5 sn'nin altına iner: ikinci deneme yapılmaz.
    svc, _ = make_service(responder, models=VISION_MODELS,
                          settings=GuideSettings(retry_backoff_s=0.6, deadline_s=10.0, min_call_s=9.5))
    assert svc.ask("Ulu Cami'yi kim yaptırdı?")["fallback_reason"] == "unavailable" and len(calls) == 1
