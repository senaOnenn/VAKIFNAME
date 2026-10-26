"""Dahili RAG paketi: erişim, karantina, kaynak sayfaları, çelişki ve kanıtsız sorular.

Gerçek RAG paketi ve `faiss` / `sentence_transformers` kurulu değilse atlanır
(bkz. requirements-internal.txt). Embedding modeli indirilmez: testler ya hiç çağrılmayan
bir "guard" encoder ya da sabit vektör üreten bir encoder kullanır. Gerçek model testleri
yalnızca `VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR` yerel bir model klasörünü gösteriyorsa çalışır.
"""

import importlib.util
import os
import secrets
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.internal.catalog import load_catalog
from app.internal.rag import InternalRag, RagIntegrityError
from app.internal.server import create_internal_app
from tests.conftest import temp_review_db
from tests.test_internal_catalog import REAL_DATA_DIR

RUNTIME = REAL_DATA_DIR / "rag" / "runtime"
pytestmark = pytest.mark.skipif(
    not (RUNTIME / "handoff_manifest.json").is_file()
    or importlib.util.find_spec("faiss") is None
    or importlib.util.find_spec("sentence_transformers") is None,
    reason="Dahili RAG paketi veya bağımlılıkları bu ortamda yok.",
)

MODEL_DIR = os.environ.get("VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR")
needs_model = pytest.mark.skipif(
    not MODEL_DIR or not Path(MODEL_DIR).is_dir(),
    reason="Yerel embedding modeli (VAKIFNAME_INTERNAL_EMBEDDING_MODEL_DIR) yok.",
)

TOKEN = secrets.token_urlsafe(32)
AUTH = {"X-Internal-Token": TOKEN}


class GuardEncoder:
    """Embedding gerektiren yola girilirse testi başarısız kılar."""

    def encode(self, *args, **kwargs):
        raise AssertionError("Bu soru embedding modeli gerektirmemeliydi.")


class ConstantEncoder:
    """Hiçbir belgeye benzemeyen sabit vektör: anlamsal arama düşük güven döndürmeli."""

    def encode(self, texts, **kwargs):
        import numpy as np

        v = np.zeros((len(texts), 384), dtype=np.float32)
        v[:, 0] = 1.0
        return v


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(REAL_DATA_DIR)


def _freeze_sha():
    import json

    return json.loads((REAL_DATA_DIR / "v20" / "vakifname_v20_freeze_manifest_v1_dev.json").read_text())["base_database_sha256"]


@pytest.fixture(scope="module")
def rag(catalog):
    return InternalRag(RUNTIME, catalog, _freeze_sha(), encoder=GuardEncoder())


def client(encoder):
    app = create_internal_app(REAL_DATA_DIR, TOKEN, rag_encoder=encoder, allowed_client_hosts=frozenset({"testclient"}),
                              review_db=temp_review_db())
    return TestClient(app)


def ask(c, question):
    r = c.post("/internal/rag/ask", headers=AUTH, json={"question": question})
    assert r.status_code == 200, r.text
    return r.json()


def test_index_contains_exactly_the_80_facts_and_no_drafts(rag, catalog):
    ids = rag.indexed_fact_ids
    assert len(ids) == 80 and set(ids) == set(catalog.facts)
    assert not set(ids) & set(catalog.drafts)


def test_unauthorized_rag_access_rejected():
    with client(GuardEncoder()) as c:
        assert c.post("/internal/rag/ask", json={"question": "Ulucami"}).status_code == 401
        assert c.post("/internal/rag/ask", headers={"X-Internal-Token": "x" * 40}, json={"question": "Ulucami"}).status_code == 401


def test_orhan_gazi_conflict_not_collapsed():
    with client(GuardEncoder()) as c:
        body = ask(c, "Orhan Gazi Türbesi yeniden ne zaman inşa edildi?")
    assert body["status"] == "unresolved_source_conflict"
    assert "1863" in body["answer"] and "1868" in body["answer"]
    cites = {x["fact_id"]: x for x in body["citations"]}
    assert set(cites) == {"BUR-0020-F004", "BUR-0020-F007"}
    assert (cites["BUR-0020-F004"]["pdf_page"], cites["BUR-0020-F007"]["pdf_page"]) == (116, 117)
    assert all(x["pdf_page_kind"] == "physical" for x in body["citations"])
    assert all("BUR-0020-ISSUE-001" in x["open_issue_ids"] for x in body["citations"])
    assert body["public_answer_eligible"] is False and body["publication_status"] == "blocked"


def test_citation_keeps_source_id_and_page():
    with client(GuardEncoder()) as c:
        body = ask(c, "Ulucaminin kaç kubbesi vardır?")
    assert body["status"] == "source_extracted_count"
    assert [x["fact_id"] for x in body["citations"]] == ["BUR-0001-F004"]
    assert body["citations"][0]["pdf_file"] == "bursa-envanteri-cilt-1.pdf"


@pytest.mark.parametrize(
    "question",
    ["Koza Hanı kaça kadar açık?", "Ulucami giriş ücreti ne kadar?", "Pirinç Hanı ziyaret saatleri nedir?"],
)
def test_current_information_not_answered(question):
    with client(GuardEncoder()) as c:
        body = ask(c, question)
    assert body["status"] == "current_information_unavailable"
    assert body["citations"] == []


def test_unknown_monument_not_answered():
    with client(GuardEncoder()) as c:
        body = ask(c, "Ayasofya'yı kim yaptırdı?")
    assert body["status"] == "monument_not_identified"
    assert body["citations"] == []


def test_unsupported_question_without_model_returns_no_sources():
    # Yerel model yoksa anlamsal arama yapılmaz; kaynak uydurulmaz.
    with client(None) as c:
        body = ask(c, "Koza Hanı'nın avlusunda kaç ağaç vardır?")
    assert body["status"] == "retrieval_unavailable"
    assert body["citations"] == []


def test_unsupported_question_with_low_similarity_returns_no_sources():
    with client(ConstantEncoder()) as c:
        body = ask(c, "Koza Hanı'nın avlusunda kaç ağaç vardır?")
    assert body["status"] in {"low_retrieval_confidence", "insufficient_evidence"}
    assert body["citations"] == []


def test_tampered_rag_package_rejected(tmp_path, catalog):
    copy = tmp_path / "runtime"
    shutil.copytree(RUNTIME, copy)
    core = copy / "vakifname_rag_core_v3_dev.py"
    core.write_text(core.read_text(encoding="utf-8") + "\n# değiştirildi\n", encoding="utf-8")
    with pytest.raises(RagIntegrityError):
        InternalRag(copy, catalog, _freeze_sha(), encoder=GuardEncoder())


def test_semantic_answer_reports_index_mismatch():
    # Sabit vektör üreten encoder indeksle uyumsuzdur; anlamsal yol bunu her cevapta bildirmeli.
    with client(ConstantEncoder()) as c:
        body = ask(c, "Koza Hanı'nın avlusunda kaç ağaç vardır?")
        status = c.get("/internal/status", headers=AUTH).json()
    assert body["retrieval_reliable"] is False
    assert "embedding_index_mismatch" in body["warnings"]
    assert status["rag_index_compatibility"]["compatible"] is False


def test_rule_based_answer_skips_index_check():
    with client(GuardEncoder()) as c:
        body = ask(c, "Orhan Gazi Türbesi yeniden ne zaman inşa edildi?")
    assert "retrieval_reliable" not in body
    assert "embedding_index_mismatch" not in body["warnings"]


@pytest.fixture(scope="module")
def model_client():
    from app.internal.rag import OfflineEncoder

    with client(OfflineEncoder(MODEL_DIR)) as c:
        yield c


@needs_model
@pytest.mark.parametrize(
    "question,expected_fact",
    [
        ("Ulucami ne zaman tamamlandı?", "BUR-0001-F001"),
        ("Koza Hanı'nı kim yaptırdı?", "BUR-0009-F001"),
        ("Koza Hanı'nın mimarı kimdir?", "BUR-0009-F004"),
        ("Osman Gazi Türbesi'nin yeniden inşası hakkında ne biliniyor?", "BUR-0019-F004"),
    ],
)
def test_real_model_retrieves_source_backed_fact(model_client, catalog, question, expected_fact):
    body = ask(model_client, question)
    assert body["status"] == "source_record_preview"
    assert [x["fact_id"] for x in body["citations"]] == [expected_fact]
    src = catalog.facts[expected_fact].source
    assert (body["citations"][0]["pdf_file"], body["citations"][0]["pdf_page"]) == (src.source_file, src.pdf_physical_page)
    # Uyumsuzluk varsa cevap güvenilir olarak işaretlenmemeli.
    compat = model_client.get("/internal/status", headers=AUTH).json()["rag_index_compatibility"]
    assert body["retrieval_reliable"] is compat["compatible"]
    assert ("embedding_index_mismatch" in body["warnings"]) is (not compat["compatible"])


@needs_model
def test_real_model_index_built_from_same_documents(model_client):
    ask(model_client, "Ulucami ne zaman tamamlandı?")
    compat = model_client.get("/internal/status", headers=AUTH).json()["rag_index_compatibility"]
    # Her belge, indeksteki kendi vektörünü en yakın komşu olarak bulmalı.
    assert compat["self_match"] == compat["documents"] == 80


@needs_model
@pytest.mark.parametrize(
    "question",
    [
        "Ulucami'nin ziyaret saatleri ve giriş ücreti nedir?",
        "Orhan Gazi Türbesi yeniden ne zaman inşa edildi?",
        "Koza Hanı'nın avlusunda kaç ağaç vardır?",
        "Muradiye Medresesi'nin bugünkü kullanımı nedir?",
    ],
)
def test_real_model_never_cites_quarantined_drafts(model_client, catalog, question):
    body = ask(model_client, question)
    ids = {x["fact_id"] for x in body["citations"]}
    assert ids <= set(catalog.facts)
    assert not ids & set(catalog.drafts)
    assert body["public_answer_eligible"] is False and body["publication_status"] == "blocked"
