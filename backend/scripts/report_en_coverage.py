"""R6.17 İngilizce kapsam raporu (veri ve sunucu katmanı). Arayüz katmanı için: frontend/scripts/check-i18n.mjs.

1. Eser başına: İngilizce ad, ziyaret uyarısı, diğer adlar, adres; kayıtların İngilizcesi (onaylı `text_en`); soruların
   İngilizcesi. Katalog ve (verilirse) içerik deposunun yayın katmanı birlikte okunur; yalnızca YAYINDAKİ (onaylı)
   İngilizce sayılır. `--content-dir` deposundaki taslaklar ayrıca sayılır.
2. Kamuya açık uçların ziyaretçiye görünen Türkçe mesajları (HTTPException `detail`, doğrulama `ValueError`, modül
   sabitleri): ön yüz bunları `t(detail)` ile çevirir; İngilizce sözlükte (frontend/src/app/i18n-en.ts) olmayanlar listelenir.
   Yönetim, iç inceleme ve yapılandırma (açılış) hataları bilinçli olarak Türkçedir ve sayılmaz.

    python scripts/report_en_coverage.py --catalog tests/ask_eval/catalog_snapshot.json [--content-dir <depo>] [--json <çıktı>]
"""

import argparse
import ast
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.public_catalog import PublicCatalog, apply_overlay  # noqa: E402

# Ziyaretçiye görünen mesajları üreten modüller (yönetim/iç inceleme hariç).
PUBLIC_MODULES = ("auth_routes", "accounts", "game_routes", "game", "guide_routes", "speech_routes", "ask_routes",
                  "monument_routes", "player_routes", "route_routes", "people_routes", "stats_routes", "local_preview")
TR = re.compile(r"[çğıöşüÇĞİÖŞÜ]")
CONFIG = re.compile(r"VAKIFNAME_|npm run|--api-origin|\{")


def en_keys(path: Path) -> set[str]:
    src = path.read_text(encoding="utf-8")
    return {m.group(2).replace("\\'", "'").replace('\\"', '"')
            for m in re.finditer(r"^\s*(['\"])((?:\\.|(?!\1).)*)\1\s*:", src, re.M)}


def server_messages() -> dict[str, str]:
    """Türkçe sabit mesaj → modül. Çok satıra bölünmüş dizgiler (bitişik sabitler) tek dizgi olarak okunur."""
    out = {}
    for name in PUBLIC_MODULES:
        p = ROOT / "app" / f"{name}.py"
        if not p.exists():
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            vals = []
            if isinstance(node, ast.Call):
                fn = node.func.id if isinstance(node.func, ast.Name) else getattr(node.func, "attr", "")
                if fn in ("HTTPException", "ValueError"):
                    vals += [k.value for k in node.keywords if k.arg == "detail"] + list(node.args[:1])
            elif isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets):
                vals.append(node.value)
            for v in vals:
                if isinstance(v, ast.Constant) and isinstance(v.value, str) and TR.search(v.value) \
                        and not CONFIG.search(v.value):
                    out.setdefault(v.value, name)
    return out


def coverage(catalog: PublicCatalog, drafts: dict[str, int]) -> list[dict]:
    rows = []
    for m in catalog.monuments:
        facts = list(m.facts)
        quests = [f for f in facts if f.quest]
        rows.append({
            "monument_id": m.monument_id, "name": m.name, "name_en": m.name_en,
            "site_notice": bool(m.site_notice), "site_notice_en": bool(m.site_notice_en),
            "alternative_names": len(m.alternative_names), "alternative_names_en": len(m.alternative_names_en),
            "address_en": bool(m.address_en),
            "facts": len(facts), "facts_en": sum(1 for f in facts if getattr(f, "text_en", None)),
            "quests": len(quests), "quests_en": sum(1 for f in quests if f.quest.question_en),
            "drafts": drafts.get(m.monument_id, 0),
            "turkish_only": [f.fact_id for f in facts if not getattr(f, "text_en", None)],
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog", required=True, type=Path)
    ap.add_argument("--content-dir", type=Path)
    ap.add_argument("--json", type=Path)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    catalog = PublicCatalog.model_validate_json(a.catalog.read_text(encoding="utf-8"))
    drafts: dict[str, int] = {}
    if a.content_dir:
        overlay = a.content_dir / "published.json"
        if overlay.exists():
            catalog = apply_overlay(catalog, json.loads(overlay.read_text(encoding="utf-8")))
        db = a.content_dir / "content.sqlite3"
        if db.exists():
            with sqlite3.connect(f"file:{db}?mode=ro", uri=True) as con:
                drafts = dict(con.execute("SELECT monument_id, COUNT(*) FROM translations WHERE status='draft' GROUP BY monument_id"))
    rows = coverage(catalog, drafts)
    keys = en_keys(ROOT.parent / "frontend" / "src" / "app" / "i18n-en.ts")
    msgs = server_messages()
    missing = {k: v for k, v in msgs.items() if k not in keys}

    print(f"{'Eser':<28} {'Ad':>3} {'Uyarı':>6} {'Kayıt EN':>9} {'Soru EN':>8} {'Taslak':>7}")
    for r in rows:
        notice = "—" if not r["site_notice"] else ("✓" if r["site_notice_en"] else "✗")
        print(f"{r['name'][:28]:<28} {'✓' if r['name_en'] else '✗':>3} {notice:>6} "
              f"{r['facts_en']:>4}/{r['facts']:<4} {r['quests_en']:>3}/{r['quests']:<4} {r['drafts']:>7}")
    tot = lambda k: sum(r[k] for r in rows)  # noqa: E731
    print(f"Toplam: ad {sum(1 for r in rows if r['name_en'])}/{len(rows)}, kayıt {tot('facts_en')}/{tot('facts')}, "
          f"soru {tot('quests_en')}/{tot('quests')}, taslak {tot('drafts')}")
    print(f"Kamuya görünen sunucu mesajı: {len(msgs)}; İngilizcesi sözlükte olmayan: {len(missing)}")
    for k, v in sorted(missing.items(), key=lambda x: x[1]):
        print(f"  {v}: {k}")
    if a.json:
        a.json.write_text(json.dumps({"monuments": rows, "server_messages": len(msgs), "server_missing": missing},
                                     ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
