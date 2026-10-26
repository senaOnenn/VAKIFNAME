"""Tarayıcı testi için KURGUSAL (BUR-9xxx) dahili veri dizini: V20 benzeri bilgi tabanı, manifestler, sayfa denetimi
ve kaynak araştırması. Gerçek V20 verisi kullanılmaz. Dizin önce `e2e_review_env.py prepare` ile hazırlanmış olmalıdır
(geçici inceleme DB'si ve test incelemecisi aynı dizindedir).

    python scripts/e2e_review_env.py prepare /tmp/e2e/fic
    python scripts/e2e_fictional_data.py /tmp/e2e/fic
    VAKIFNAME_INTERNAL_DATA_DIR=/tmp/e2e/fic VAKIFNAME_RESEARCH_FILE=/tmp/e2e/fic/research.json \\
      python scripts/e2e_review_env.py serve /tmp/e2e/fic --port 8767
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.internal import config  # noqa: E402
from tests import test_review_workflow as w  # noqa: E402
from tests.internal_fixtures import write_data_dir  # noqa: E402


def main(argv=None):
    root = Path((sys.argv[1:] if argv is None else argv)[0]).resolve()
    real = config.DEFAULT_DATA_DIR.resolve()
    if root == real or real in root.parents:
        raise SystemExit("Kurgusal veri gerçek dahili veri dizinine yazılamaz.")
    if not (root / "review" / "review.sqlite3").is_file():
        raise SystemExit("Önce 'e2e_review_env.py prepare' çalıştırın.")
    write_data_dir(root)
    audit = {"page_numbering": "physical_1_based", "records": [
        {"record_id": "BUR-9001-F001", "kind": "fact", "source_file": "kaynak-a.pdf", "pdf_physical_page": 2,
         "result": "quote_found_on_page"}]}
    (root / "manifests" / "source_page_audit.json").write_text(json.dumps(audit), encoding="utf-8")
    (root / "research.json").write_text(json.dumps(w.research_doc(), ensure_ascii=False), encoding="utf-8")
    print(f"Kurgusal veri dizini hazır: {root}")


if __name__ == "__main__":
    main()
