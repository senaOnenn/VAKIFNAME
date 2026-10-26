"""Esere Sor kalite ölçümü: `python -m app.ask.evaluate [--catalog …] [--set …] [--model-dir …]`.

Ölçülenler: cevaplanabilir sorularda ilk sonucun doğru olguya eşleşmesi, yanlış cevap oranı, cevabı olmayan sorularda
güvenli geri çekilme, durum testleri (güncel bilgi, katalog dışı eser, belirsiz eser), kaynakların cevapla uyumu ve
yayımlanmamış bilgi sızıntısı.
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Optional

from ..public_catalog import PublicCatalog
from .engine import Engine

ANSWERED = "answered"


def _fact_ids(res: dict) -> list[str]:
    out = []
    for item in [res.get("answer")] + list(res.get("related") or []):
        if item and item.get("fact_id"):
            out.append(item["fact_id"])
    return out


def check_alignment(res: dict, catalog: PublicCatalog) -> list[str]:
    """Cevaptaki her olgu, katalogdaki yayımlanmış metin ve kaynaklarla birebir aynı olmalı."""
    facts = {f.fact_id: (m, f) for m in catalog.monuments for f in m.facts}
    problems = []
    for item in [res.get("answer")] + list(res.get("related") or []):
        if not item or item.get("kind") == "identity":
            continue
        fid = item.get("fact_id")
        if fid not in facts:
            problems.append(f"yayımlanmamış olgu: {fid}")
            continue
        m, f = facts[fid]
        if item["text"] != f.text or item["title"] != f.title:
            problems.append(f"{fid}: metin katalogla aynı değil")
        if [s["url"] for s in item["sources"]] != [s.url for s in f.sources] or not item["sources"]:
            problems.append(f"{fid}: kaynaklar katalogla aynı değil")
        if item["monument_id"] != m.monument_id or item["publication_decision_id"] != f.publication_decision_id:
            problems.append(f"{fid}: eser veya yayın kararı uyuşmuyor")
        if res.get("monument") and res["monument"]["monument_id"] != m.monument_id:
            problems.append(f"{fid}: cevap başka bir eserden")
    return problems


def evaluate(engine: Engine, items: list[dict], forbidden_ids: frozenset = frozenset()) -> dict:
    catalog = engine.corpus.catalog
    groups: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    failures, alignment, leaks = [], [], []
    tot = defaultdict(int)
    for it in items:
        res = engine.ask(it["q"], it.get("ctx"))
        status, ids = res["status"], _fact_ids(res)
        top = res["answer"]["fact_id"] if res.get("answer") and res["answer"].get("fact_id") else None
        g = groups[it["group"]]
        g["n"] += 1
        exp = it["expect"]
        ok = False
        if exp == "answer":
            tot["answerable"] += 1
            if status == ANSWERED and top in it["gold"]:
                ok = True
                tot["answerable_correct"] += 1
            elif status == ANSWERED:
                tot["answerable_wrong"] += 1
            else:
                tot["answerable_abstained"] += 1
        elif exp == "no_answer":
            tot["unanswerable"] += 1
            ok = status != ANSWERED
            tot["unanswerable_false_answer"] += 0 if ok else 1
        elif exp == "answer_or_none":
            ok = status != ANSWERED or top in it["gold"]
        else:
            tot["status_tests"] += 1
            want = set(it.get("options") or [])
            got = {o["monument_id"] for o in res.get("options") or []}
            ok = status == exp and want <= got
            tot["status_correct"] += int(ok)
        for text in it.get("forbid_text", []):
            if text in json.dumps(res, ensure_ascii=False):
                ok = False
                leaks.append(f"{it['q']}: yasak metin “{text}”")
        for fid in ids:
            if fid in forbidden_ids:
                ok = False
                leaks.append(f"{it['q']}: yayımlanmamış/reddedilmiş olgu {fid}")
        problems = check_alignment(res, catalog) if status == ANSWERED else []
        if problems:
            ok = False
            alignment.extend(f"{it['q']}: {p}" for p in problems)
        g["ok"] += int(ok)
        if not ok:
            failures.append({"q": it["q"], "ctx": it.get("ctx"), "group": it["group"], "expect": exp, "gold": it["gold"],
                             "status": status, "got": top, "options": [o["monument_id"] for o in res.get("options") or []]})
    a, u = tot["answerable"], tot["unanswerable"]
    return {
        "retrieval": engine.retrieval,
        "answerable": a, "top1_accuracy": round(tot["answerable_correct"] / a, 4) if a else None,
        "answerable_wrong_rate": round(tot["answerable_wrong"] / a, 4) if a else None,
        "answerable_abstain_rate": round(tot["answerable_abstained"] / a, 4) if a else None,
        "unanswerable": u, "unanswerable_false_answer_rate": round(tot["unanswerable_false_answer"] / u, 4) if u else None,
        "status_tests": tot["status_tests"], "status_accuracy": round(tot["status_correct"] / tot["status_tests"], 4) if tot["status_tests"] else None,
        "groups": {k: {"n": v["n"], "ok": v["ok"], "rate": round(v["ok"] / v["n"], 4)} for k, v in sorted(groups.items())},
        "alignment_problems": alignment, "leaks": leaks, "failures": failures,
    }


def main(argv: Optional[list[str]] = None):
    root = Path(__file__).resolve().parents[3]
    p = argparse.ArgumentParser()
    p.add_argument("--catalog", type=Path, default=root / "data" / "public_catalog" / "catalog.json")
    p.add_argument("--set", type=Path, action="append")
    p.add_argument("--model-dir", type=Path)
    p.add_argument("--failures", action="store_true")
    args = p.parse_args(argv)
    from .service import build_engine
    catalog = PublicCatalog.model_validate(json.loads(args.catalog.read_text(encoding="utf-8")))
    engine = build_engine(catalog, args.model_dir)
    sets = args.set or [Path(__file__).resolve().parents[2] / "tests" / "ask_eval" / "eval_set.json"]
    for path in sets:
        items = json.loads(path.read_text(encoding="utf-8"))["items"]
        report = evaluate(engine, items)
        if not args.failures:
            report = {k: v for k, v in report.items() if k != "failures"} | {"failures": len(report["failures"])}
        print(f"== {path.name}")
        print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
