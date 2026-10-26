"""V20 veri katmanı: şema doğrulama, karantina, kaynak sayfaları, koordinatlar ve görseller."""

import json
import os
from pathlib import Path

import pytest

from app.internal.catalog import (
    CatalogError,
    LocationUnavailableError,
    SourceDocument,
    V20Catalog,
    load_catalog,
    load_source_registry,
    parse_coordinate,
    to_checkin_place,
)
from app.internal.images import ImageInventory, load_image_inventory
from app.models import Place
from tests.internal_fixtures import base_freeze, base_images, base_kb, base_sources, draft, fact, write_data_dir

REAL_DATA_DIR = Path(os.environ.get("VAKIFNAME_INTERNAL_DATA_DIR", "/var/lib/vakifname-internal"))
real_data = pytest.mark.skipif(
    not (REAL_DATA_DIR / "v20" / "vakifname_knowledge_base_v20_dev.json").is_file()
    or not (REAL_DATA_DIR / "manifests" / "source_registry.json").is_file(),
    reason="Korumalı V20 veri dizini bu ortamda yok.",
)

EXPECTED_MONUMENT_IDS = {
    "BUR-0001", "BUR-0003", "BUR-0005", "BUR-0007", "BUR-0008",
    "BUR-0009", "BUR-0013", "BUR-0014", "BUR-0019", "BUR-0020",
}


def build(kb=None, sources=None, freeze=None):
    return V20Catalog(kb or base_kb(), freeze or base_freeze(), [SourceDocument(**s) for s in sources or base_sources()])


# --- Kurgusal veriyle şema ve bütünlük kuralları ---------------------------------


def test_synthetic_catalog_loads_and_links_issues():
    c = build()
    assert set(c.monuments) == {"BUR-9001", "BUR-9002"}
    assert len(c.facts) == 3 and len(c.drafts) == 2
    assert c.facts["BUR-9001-F002"].open_issue_ids == ("TEST-ISSUE-1",)
    assert c.issues["TEST-ISSUE-1"].competing_years == (1700, 1705)
    assert c.issues["TEST-ISSUE-1"].chosen_value is None


def _mutate(fn):
    kb = base_kb()
    fn(kb)
    return kb


@pytest.mark.parametrize(
    "mutation",
    [
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(original_book="yok.pdf"), id="unknown_pdf"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(original_pdf_page=0), id="page_zero"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(original_pdf_page=99), id="page_beyond_pdf"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(original_pdf_page=3), id="page_not_in_v20_list"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(original_pdf_page="2"), id="page_as_string"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].pop("original_pdf_page"), id="page_missing"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].update(evidence_quote="  "), id="empty_quote"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["source"].pop("original_book"), id="source_file_missing"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0].pop("source"), id="source_missing"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["access"].pop("game_eligible"), id="flag_missing"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["access"].update(extra=True), id="unknown_flag"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"][0]["access"].update(game_eligible="false"), id="flag_as_string"),
        pytest.param(lambda kb: kb["monuments"][1]["historical_facts"].append(fact("BUR-9001", 1)), id="fact_wrong_monument"),
        pytest.param(lambda kb: kb["monuments"][0]["historical_facts"].append(fact("BUR-9001", 1)), id="duplicate_fact_id"),
        pytest.param(lambda kb: kb["monuments"].append(kb["monuments"][0]), id="duplicate_monument_id"),
        pytest.param(lambda kb: kb["monuments"][0].update(fact_count=7), id="fact_count_mismatch"),
        pytest.param(lambda kb: kb["monuments"][0]["research_fact_drafts"][0].update(rag_eligible=True), id="draft_rag_eligible"),
        pytest.param(lambda kb: kb["monuments"][0]["research_fact_drafts"][0].update(public_answer_eligible=True), id="draft_public"),
        pytest.param(lambda kb: kb["monuments"][0]["research_fact_drafts"][0].update(publication_status="published"), id="draft_published"),
        pytest.param(lambda kb: kb["monuments"][0]["research_fact_drafts"].append(draft("BUR-9001", 1)), id="duplicate_draft"),
        pytest.param(lambda kb: kb["monuments"][0]["research_fact_drafts"][0]["evidence"].update(pdf_page=50), id="draft_page_invalid"),
        pytest.param(lambda kb: kb["monuments"][0]["catalog_metadata"].update(latitude="40.1"), id="half_coordinate"),
        pytest.param(lambda kb: kb["monuments"][0]["catalog_metadata"].update(latitude="abc", longitude="1"), id="bad_coordinate"),
        pytest.param(lambda kb: kb["access_policy"].update(publication_status="published"), id="policy_not_blocked"),
        pytest.param(lambda kb: kb.update(schema_version="19.0-dev"), id="wrong_schema"),
    ],
)
def test_invalid_or_incomplete_records_are_rejected(mutation):
    with pytest.raises(CatalogError):
        build(_mutate(mutation))


def test_issue_referencing_unknown_fact_is_rejected():
    kb = _mutate(lambda kb: kb["research_open_conflicts"][0]["related_existing_fact_ids"].append("BUR-9001-F099"))
    with pytest.raises(CatalogError):
        build(kb)


def test_source_registry_must_match_freeze_sha():
    freeze = base_freeze()
    freeze["external_source_pdf_sha256"] = {"kaynak-a.pdf": "f" * 64}
    with pytest.raises(CatalogError):
        build(freeze=freeze)


def test_freeze_summary_count_mismatch_is_rejected():
    freeze = base_freeze()
    freeze["summary"]["unapproved_drafts"] = 57
    with pytest.raises(CatalogError):
        build().verify_freeze_summary(freeze)


def test_tampered_knowledge_base_is_rejected(tmp_path):
    root = write_data_dir(tmp_path)
    kb_path = root / "v20" / "vakifname_knowledge_base_v20_dev.json"
    kb_path.write_text(kb_path.read_text(encoding="utf-8").replace("KURGUSAL OLGU", "DEĞİŞTİRİLMİŞ"), encoding="utf-8")
    with pytest.raises(CatalogError):
        load_catalog(root)


def test_unpublished_records_are_not_publicly_usable():
    c = build()
    assert c.publicly_usable_facts() == []
    kb = _mutate(lambda kb: kb["monuments"][0]["historical_facts"][0]["access"].update(
        publication_status="published", public_answer_eligible=True, license_review_status="not_checked"
    ))
    # Lisans incelemesi ve editör onayı olmadan tek bir bayrağın açılması yetmez.
    assert build(kb).publicly_usable_facts() == []


# --- Koordinatlar ve check-in -----------------------------------------------------


@pytest.mark.parametrize("raw", ["", "   ", None])
def test_empty_coordinates_become_none_not_zero(raw):
    assert parse_coordinate(raw) is None


def test_monument_without_coordinates_cannot_check_in():
    m = build().monuments["BUR-9001"]
    assert (m.latitude, m.longitude, m.location_status) == (None, None, "missing")
    assert m.checkin_eligible is False
    with pytest.raises(LocationUnavailableError):
        to_checkin_place(m)


def test_monument_with_unverified_coordinates_cannot_check_in():
    kb = _mutate(lambda kb: kb["monuments"][0]["catalog_metadata"].update(latitude="40.18", longitude="29.06"))
    m = build(kb).monuments["BUR-9001"]
    assert m.location_status == "unverified" and m.checkin_eligible is False
    with pytest.raises(LocationUnavailableError):
        to_checkin_place(m)


def test_public_place_contract_still_requires_coordinates():
    # Mevcut `/places` sözleşmesi değişmedi: koordinatsız kayıt Place olamaz.
    with pytest.raises(ValueError):
        Place(id="x", name="x", city="x", description="x", latitude=None, longitude=None,
              check_in_radius_m=10, is_demo=False)


# --- Görsel envanteri -------------------------------------------------------------


def test_image_linked_to_unknown_monument_is_rejected():
    images = base_images()
    images["images"][0].update(monument_id="BUR-9999", image_id="BUR-9999/a.jpeg", relative_path="BUR-9999/a.jpeg")
    with pytest.raises(CatalogError):
        ImageInventory(images, {"BUR-9001"})


@pytest.mark.parametrize("path", ["../secret.jpeg", "/etc/a.jpeg", "BUR-9001/../../a.jpeg", "BUR-9001/a.pdf"])
def test_image_path_must_stay_in_monument_folder(path):
    images = base_images()
    images["images"][0]["relative_path"] = path
    with pytest.raises(CatalogError):
        ImageInventory(images, {"BUR-9001"})


def test_image_link_does_not_grant_publication():
    images = base_images()
    images["images"][0].update(monument_link_status="editor_confirmed")
    inv = ImageInventory(images, {"BUR-9001"})
    assert inv.publishable() == []


# --- Gerçek V20 verisi (yalnızca korumalı dizin varsa) ----------------------------


@pytest.fixture(scope="module")
def real_catalog():
    return load_catalog(REAL_DATA_DIR)


@real_data
def test_real_monument_ids_complete_and_unique(real_catalog):
    assert set(real_catalog.monuments) == EXPECTED_MONUMENT_IDS
    assert len(real_catalog.monuments) == 10


@real_data
def test_real_fact_ids_unique(real_catalog):
    assert len(real_catalog.facts) == 80
    assert sum(len(m.fact_ids) for m in real_catalog.monuments.values()) == 80


@real_data
def test_real_drafts_quarantined(real_catalog):
    assert len(real_catalog.drafts) == 57
    assert not set(real_catalog.drafts) & set(real_catalog.facts)
    assert all(
        d.rag_eligible is False and d.public_answer_eligible is False and d.publication_status == "blocked"
        for d in real_catalog.drafts.values()
    )


@real_data
def test_real_flags_preserved(real_catalog):
    for f in real_catalog.facts.values():
        assert f.access.publication_status == "blocked"
        assert f.access.public_answer_eligible is False
        assert f.access.game_eligible is False
    assert real_catalog.publicly_usable_facts() == []


@real_data
def test_real_source_page_references_valid(real_catalog):
    registry = {s.source_file: s for s in load_source_registry(REAL_DATA_DIR / "manifests" / "source_registry.json")}
    for f in real_catalog.facts.values():
        assert 1 <= f.source.pdf_physical_page <= registry[f.source.source_file].physical_page_count
    audit_path = REAL_DATA_DIR / "manifests" / "source_page_audit.json"
    if audit_path.is_file():
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        fact_results = {r["record_id"]: r["result"] for r in audit["records"] if r["kind"] == "fact"}
        assert set(fact_results) == set(real_catalog.facts)
        assert set(fact_results.values()) == {"quote_found_on_page"}


@real_data
def test_real_orhan_gazi_conflict_preserved(real_catalog):
    issue = real_catalog.issues["BUR-0020-ISSUE-001"]
    assert issue.status == "unresolved"
    assert issue.chosen_value is None
    assert issue.competing_years == (1863, 1868)
    assert set(issue.related_fact_ids) == {"BUR-0020-F004", "BUR-0020-F007"}
    f4, f7 = real_catalog.facts["BUR-0020-F004"], real_catalog.facts["BUR-0020-F007"]
    assert (f4.source.pdf_physical_page, f7.source.pdf_physical_page) == (116, 117)
    assert f4.certainty == f7.certainty == "uncertain"
    assert "BUR-0020-ISSUE-001" in real_catalog.monuments["BUR-0020"].open_issue_ids


@real_data
def test_real_monuments_have_no_coordinates_and_cannot_check_in(real_catalog):
    for m in real_catalog.monuments.values():
        assert (m.latitude, m.longitude, m.location_status) == (None, None, "missing")
        with pytest.raises(LocationUnavailableError):
            to_checkin_place(m)


@real_data
def test_real_images_linked_but_not_published(real_catalog):
    inv = load_image_inventory(REAL_DATA_DIR / "manifests" / "image_manifest.json", set(real_catalog.monuments))
    assert len(inv.images) == 325
    assert {i.monument_id for i in inv.images} == EXPECTED_MONUMENT_IDS
    assert inv.publishable() == []
    assert all(
        i.monument_link_status == "folder_assigned_unverified"
        and i.public_serving_allowed is False
        and i.publication_status == "blocked"
        and i.license_status == "not_checked"
        for i in inv.images
    )
