"""Yazım hatası dayanıklılığı ölçümü: `python scripts/eval_typos.py [--set …] [--model-dir …] [--index-dir …]
[--no-spelling] [--no-lexicon] [--json çıktı]`.

İki yol ayrı ölçülür:
- Arama (rehberin LLM'e verdiği kanıt, `guide.retrieval.gather`): doğru olgu ilk 5 sonuç içinde mi?
- Yedek cevap (NVIDIA erişilemezken gösterilen, `Engine.ask`): ilk gösterilen cevap doğru mu, yanlış mı, geri çekildi mi,
  açıklama sorusu mu soruldu (önerilen kayıt doğru mu)?
Cevabı olmayan sorularda hiçbir olgunun cevap diye gösterilmemesi (güvenli geri çekilme) ayrıca raporlanır.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ask.evaluate import check_alignment  # noqa: E402
from app.ask.service import build_engine  # noqa: E402
from app.ask.spelling import Correction  # noqa: E402
from app.ask.text import fold  # noqa: E402
from app.guide.retrieval import gather  # noqa: E402
from app.public_catalog import PublicCatalog  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def _suggested(res: dict) -> list[str]:
    return [s.get("fact_id") for s in res.get("suggestions") or [] if s.get("fact_id")]


def run(engine, items: list[dict]) -> dict:
    g = defaultdict(lambda: defaultdict(int))
    rows = []
    for it in items:
        res = engine.ask(it["q"], it.get("ctx"))
        ev = gather(engine, it["q"], it.get("ctx"))
        top5 = [d.fact_id for d in ev.docs[:5]] if ev.status == "ok" else []
        top = (res.get("answer") or {}).get("fact_id")
        st = res["status"]
        gold = set(it["gold"])
        k = it["group"]
        s = g[k]
        s["n"] += 1
        if it["expect"] == "answer":
            s["top5"] += int(bool(gold & set(top5)))
            if st == "answered":
                s["correct" if top in gold else "wrong"] += 1
            elif st == "clarification_required" and _suggested(res):
                s["clarify_right" if set(_suggested(res)) & gold else "clarify_wrong"] += 1
            else:
                s["abstain"] += 1
        else:
            s["safe" if st != "answered" else "wrong"] += 1
        if st == "answered" and check_alignment(res, engine.corpus.catalog):
            s["alignment"] += 1
        rows.append({"q": it["q"], "ctx": it.get("ctx"), "group": k, "gold": it["gold"], "status": st, "top": top,
                     "suggested": _suggested(res), "top5": top5, "interpreted": res.get("interpreted_question")})
    return {"groups": {k: dict(v) for k, v in sorted(g.items())}, "rows": rows}


def summary(groups: dict) -> dict:
    ans = [v for k, v in groups.items() if k != "unanswerable"]
    typo = [v for k, v in groups.items() if k not in ("unanswerable", "correct")]
    tot = lambda vs, f: sum(v.get(f, 0) for v in vs)
    out = {}
    for name, vs in (("all_answerable", ans), ("typo_answerable", typo)):
        n = tot(vs, "n")
        out[name] = {"n": n, **{f: round(tot(vs, f) / n, 4) for f in ("top5", "correct", "wrong", "clarify_right", "clarify_wrong", "abstain")}}
    u = groups.get("unanswerable", {})
    out["unanswerable"] = {"n": u.get("n", 0), "safe": round(u.get("safe", 0) / u["n"], 4) if u.get("n") else None}
    out["alignment_problems"] = tot(groups.values(), "alignment")
    return out


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", type=Path, default=ROOT / "tests" / "ask_eval" / "catalog_snapshot.json")
    p.add_argument("--set", type=Path, default=ROOT / "tests" / "ask_eval" / "typo_set.json")
    p.add_argument("--model-dir", type=Path)
    p.add_argument("--index-dir", type=Path)
    p.add_argument("--json", type=Path)
    p.add_argument("--failures", action="store_true")
    p.add_argument("--no-lexicon", action="store_true", help="Türkçe sözlük (zeyrek) olmadan, yalnızca katalog sözlüğüyle")
    p.add_argument("--no-spelling", action="store_true", help="yazım düzeltmesi kapalı (Görev 25 öncesi davranış)")
    a = p.parse_args(argv)
    catalog = PublicCatalog.model_validate(json.loads(a.catalog.read_text(encoding="utf-8")))
    word_check = None
    if not a.no_lexicon:
        from app.guide.lexicon import TurkishLexicon  # noqa: PLC0415
        lex = TurkishLexicon(background=False)
        word_check = lex.is_word if lex.state == "ready" else None
    engine = build_engine(catalog, a.model_dir, a.index_dir, word_check=word_check)
    if a.no_spelling:
        engine.corpus.correct = lambda q: Correction(q, fold(q), q, [])
    items = json.loads(a.set.read_text(encoding="utf-8"))["items"]
    r = run(engine, items)
    r["summary"] = summary(r["groups"])
    r["retrieval"] = engine.retrieval
    print(f"retrieval={engine.retrieval} lexicon={word_check is not None} spelling={not a.no_spelling}")
    print(f"{'grup':14} {'n':>3} {'ilk5':>5} {'doğru':>5} {'yanlış':>6} {'açık+':>5} {'açık-':>5} {'çekil':>5} {'güvenli':>7}")
    for k, v in r["groups"].items():
        print(f"{k:14} {v['n']:>3} {v.get('top5', 0):>5} {v.get('correct', 0):>5} {v.get('wrong', 0):>6} "
              f"{v.get('clarify_right', 0):>5} {v.get('clarify_wrong', 0):>5} {v.get('abstain', 0):>5} {v.get('safe', 0):>7}")
    print(json.dumps(r["summary"], ensure_ascii=False, indent=1))
    if a.failures:
        for row in r["rows"]:
            bad = (row["group"] == "unanswerable" and row["status"] == "answered") or \
                  (row["group"] != "unanswerable" and row["top"] not in row["gold"])
            if bad:
                print("  ✗", json.dumps(row, ensure_ascii=False))
    if a.json:
        a.json.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
