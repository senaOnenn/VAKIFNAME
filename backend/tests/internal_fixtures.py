"""Dahili V20 testleri için kurgusal veri üreticisi.

Buradaki metinlerin hiçbiri gerçek tarihsel içerik değildir; yalnızca V20 şemasının biçimini taklit eder.
"""

import copy
import hashlib
import json
from pathlib import Path

BLOCKED_ACCESS = {
    "editor_approval_required": True,
    "game_eligible": False,
    "license_review_status": "not_checked",
    "public_answer_eligible": False,
    "publication_status": "blocked",
    "scope": "internal_development_only",
}


def fact(mid, n, page=2, book="kaynak-a.pdf", issues=()):
    fid = f"{mid}-F{n:03d}"
    return {
        "access": dict(BLOCKED_ACCESS),
        "chunk_id": f"RAG-{fid}",
        "document_type": "historical_fact",
        "metadata": {
            "category": "construction",
            "certainty": "documented",
            "fact_id": fid,
            "monument_id": mid,
            "related_issue_ids": list(issues),
            "review_priority": "P2",
            "review_status": "pending",
        },
        "source": {
            "book_evidence_status": "text_matched",
            "compiled_pdf": "derleme.pdf",
            "compiled_pdf_page": 1,
            "evidence_quote": f"KURGUSAL ALINTI {fid}",
            "original_book": book,
            "original_pdf_page": page,
            "source_page_id": f"{mid}-P01",
        },
        "text": f"KURGUSAL OLGU {fid}",
        "title": f"Test {fid}",
    }


def draft(mid, n, page=3, book="kaynak-a.pdf"):
    return {
        "draft_fact_id": f"DRAFT-{mid}-{n:03d}",
        "monument_id": mid,
        "category": "historical_event",
        "statement": "KURGUSAL ADAY",
        "evidence": {"source_file": book, "pdf_page": page, "quote": "KURGUSAL"},
        "data_status": "source_matched_draft",
        "historical_verification": "pending_editor_review",
        "publication_status": "blocked",
        "public_answer_eligible": False,
        "rag_eligible": False,
        "license_review_status": "not_checked",
    }


def monument(mid, facts, drafts=(), lat="", lon=""):
    return {
        "monument_id": mid,
        "name": f"Test Eser {mid}",
        "catalog_metadata": {
            "monument_id": mid, "name": f"Test Eser {mid}", "city": "Test", "district": "Test",
            "type": "cami", "latitude": lat, "longitude": lon,
        },
        "complex_ids": [],
        "historical_facts": list(facts),
        "fact_count": len(facts),
        "source_files": ["kaynak-a.pdf"],
        "open_issue_ids": [],
        "editorial": {"review_status": "pending", "publication_status": "blocked", "license_review_status": "not_checked"},
        "research_fact_drafts": list(drafts),
    }


def base_kb():
    return {
        "schema_version": "20.0-dev",
        "access_policy": {"publication_status": "blocked", "environment": "internal_development_only"},
        "sources": [{"source_file": "kaynak-a.pdf", "referenced_pdf_pages": [2, 4]}],
        "monuments": [
            monument("BUR-9001", [fact("BUR-9001", 1), fact("BUR-9001", 2, page=4, issues=["TEST-ISSUE-1"])],
                     [draft("BUR-9001", 1)]),
            monument("BUR-9002", [fact("BUR-9002", 1)], [draft("BUR-9002", 1)]),
        ],
        "review_issue_records": [{
            "issue_id": "TEST-ISSUE-1", "monument_id": "BUR-9001", "related_fact_ids": "BUR-9001-F002",
        }],
        "research_open_conflicts": [{
            "issue_id": "TEST-ISSUE-1", "monument_id": "BUR-9001", "related_existing_fact_ids": ["BUR-9001-F002"],
            "competing_source_years": [1700, 1705], "resolution": None,
        }],
    }


def base_freeze(kb_sha=""):
    return {
        "base_database_sha256": kb_sha,
        "summary": {"monuments": 2, "existing_historical_facts": 3, "unapproved_drafts": 2, "open_editorial_issues": 1},
        "open_editorial_issues": [{"issue_id": "TEST-ISSUE-1", "topic": "Test çelişkisi", "status": "unresolved"}],
        "external_source_pdf_sha256": {},
    }


def base_sources():
    return [{"source_file": "kaynak-a.pdf", "sha256": "0" * 64, "size_bytes": 10, "physical_page_count": 5}]


def base_images():
    img = {
        "image_id": "BUR-9001/BUR-9001_test_1.jpeg", "monument_id": "BUR-9001",
        "relative_path": "BUR-9001/BUR-9001_test_1.jpeg", "sha256": "1" * 64, "size_bytes": 10,
        "jpeg_valid": True, "width": 1, "height": 1, "monument_known_in_v20": True,
        "filename_prefix_matches_folder": True, "monument_link_status": "folder_assigned_unverified",
        "content_verification_status": "pending", "license_status": "not_checked",
        "publication_status": "blocked", "public_serving_allowed": False, "duplicate_of": [],
    }
    return {"images": [img]}


def write_data_dir(root: Path, kb=None, freeze=None, sources=None, images=None) -> Path:
    """Korumalı veri dizini yerleşimini kurgusal verilerle oluşturur."""
    kb = copy.deepcopy(kb or base_kb())
    (root / "v20").mkdir(parents=True)
    (root / "manifests").mkdir()
    kb_path = root / "v20" / "vakifname_knowledge_base_v20_dev.json"
    kb_path.write_text(json.dumps(kb, ensure_ascii=False), encoding="utf-8")
    freeze = freeze or base_freeze()
    freeze["base_database_sha256"] = freeze.get("base_database_sha256") or hashlib.sha256(kb_path.read_bytes()).hexdigest()
    (root / "v20" / "vakifname_v20_freeze_manifest_v1_dev.json").write_text(json.dumps(freeze), encoding="utf-8")
    (root / "manifests" / "source_registry.json").write_text(
        json.dumps({"sources": sources or base_sources()}), encoding="utf-8"
    )
    (root / "manifests" / "image_manifest.json").write_text(json.dumps(images or base_images()), encoding="utf-8")
    return root
