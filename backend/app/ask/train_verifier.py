"""Yanıt uygunluğu denetleyicisini eğitir: `python -m app.ask.train_verifier --model-dir … [--out …]`.

Yalnızca geliştirme setleri kullanılır (`tests/ask_eval/` altındaki eval_set, heldout*, dev_unanswerable); kör
değerlendirme setleri (`blind_v2/`) eğitimde ve eşik seçiminde kullanılmaz. Olumsuz örnekler: cevabı olmayan sorular ve
her cevaplanabilir sorunun doğru olgusu katalogdan çıkarılarak yeniden sorulması (yakın ama yanlış olgu üretir).

Model: standartlaştırılmış özelliklerle L2 düzenlemeli lojistik regresyon (numpy). Eşik, soru bazında 5 katlı çapraz
doğrulamayla, olumsuz sorularda yanlış cevap oranı `--max-false` değerini aşmayacak biçimde seçilir.
"""

import argparse
import copy
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..public_catalog import PublicCatalog
from .engine import Corpus, Engine
from .verifier import FEATURES, Verifier

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "tests" / "ask_eval"
DEV_SETS = ("eval_set", "heldout", "heldout2", "heldout3", "heldout4", "heldout5", "dev_unanswerable")
STRICT = Verifier(None)


def _questions():
    out = []
    for name in DEV_SETS:
        for it in json.loads((EVAL / f"{name}.json").read_text(encoding="utf-8"))["items"]:
            if it["expect"] in ("answer", "no_answer"):
                out.append(it | {"set": name})
    return out


def collect(catalog_data: dict, encoder, mode: str, cross_encoder=None):
    """Her soru için (soru kimliği, olumlu mu, [(olgu, özellikler, etiket)]) örnekleri."""
    vec_by_fact = {}
    if encoder is not None:
        full = Corpus(PublicCatalog.model_validate(catalog_data))
        vecs = encoder.passages([d.passage for d in full.docs])
        vec_by_fact = {d.fact_id: v for d, v in zip(full.docs, vecs)}
        query = lru_cache(maxsize=4096)(encoder.query)

    def engine_for(drop: frozenset) -> Engine:
        data = copy.deepcopy(catalog_data)
        for m in data["monuments"]:
            m["facts"] = [f for f in m["facts"] if f["fact_id"] not in drop]
        corpus = Corpus(PublicCatalog.model_validate(data))
        ce = cross_encoder if mode == "hybrid_ce" else None
        if encoder is None or mode == "lexical":
            return Engine(corpus, verifier=STRICT, cross_encoder=ce)
        return Engine(corpus, query, np.stack([vec_by_fact[d.fact_id] for d in corpus.docs]), verifier=STRICT, cross_encoder=ce)

    engines = {frozenset(): engine_for(frozenset())}
    groups = []
    for i, it in enumerate(_questions()):
        variants = [(frozenset(), it["expect"] == "answer")]
        if it["expect"] == "answer":
            variants.append((frozenset(it["gold"]), False))  # doğru olgu yokken yakın ama yanlış adaylar
        for drop, positive in variants:
            if drop not in engines:
                engines[drop] = engine_for(drop)
            r = engines[drop].ask(it["q"], it.get("ctx"), debug=True)
            cands = (r.get("_debug") or {}).get("candidates", [])
            rows = [(fid, feats, int(positive and fid in it["gold"])) for fid, feats in cands]
            groups.append({"qid": i, "q": it["q"], "positive": positive, "rows": rows, "status": r["status"],
                           "synthetic": bool(drop)})
    return groups


def _matrix(groups):
    X, y = [], []
    for g in groups:
        for _, f, lab in g["rows"]:
            X.append([f[n] for n in FEATURES])
            y.append(lab)
    return np.array(X, dtype=np.float64), np.array(y, dtype=np.float64)


def fit(X, y, l2=1.0, iters=4000, lr=0.2):
    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd[sd < 1e-9] = 1.0
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    pos_w = (len(y) - y.sum()) / max(y.sum(), 1)  # sınıf dengesi
    sw = np.where(y > 0, pos_w, 1.0)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = (p - y) * sw
        w -= lr * (Z.T @ g / len(y) + l2 * w / len(y))
        b -= lr * g.mean()
    return {"weights": w.tolist(), "bias": float(b), "mean": mu.tolist(), "std": sd.tolist()}


def _decide(model, groups):
    v = Verifier({"features": list(FEATURES), "modes": {"m": {**model, "threshold": 0.5}}})
    out = []
    for g in groups:
        if not g["rows"]:
            out.append((g, 0.0, None))
            continue
        best = max(((v.probability(f, "m"), fid, lab) for fid, f, lab in g["rows"]), key=lambda x: x[0])
        out.append((g, best[0], best))
    return out


def cross_validate(groups, folds=5, seed=7):
    qids = sorted({g["qid"] for g in groups})
    rng = np.random.default_rng(seed)
    rng.shuffle(qids)
    fold_of = {q: i % folds for i, q in enumerate(qids)}
    preds = []
    for k in range(folds):
        train = [g for g in groups if fold_of[g["qid"]] != k]
        test = [g for g in groups if fold_of[g["qid"]] == k]
        preds += _decide(fit(*_matrix(train)), test)
    return preds


def sweep(preds, max_false, max_synthetic=0.04):
    """Eşik: doğal cevapsız sorularda ve cevaplanabilir sorularda yanlış cevap `max_false` sınırını aşmasın; bu koşulda
    doğruluğu en yüksek eşik. Yapay olumsuzlar (doğru olgusu çıkarılmış sorular: "yakın ama yanlış olgu") için ayrıca
    `max_synthetic` üst sınırı uygulanır; bunlar etiket gürültüsü içerdiğinden (kalan olgu bazen soruyu gerçekten
    yanıtlar) sınır doğal sorulardan daha gevşektir."""
    pos = [p for p in preds if p[0]["positive"]]
    nat = [p for p in preds if not p[0]["positive"] and not p[0]["synthetic"]]
    syn = [p for p in preds if not p[0]["positive"] and p[0]["synthetic"]]
    best = None
    for t in np.round(np.arange(0.05, 0.99, 0.01), 2):
        correct = sum(1 for g, p, b in pos if b and p >= t and b[2] == 1) / len(pos)
        wrong = sum(1 for g, p, b in pos if b and p >= t and b[2] == 0) / len(pos)
        false = sum(1 for g, p, b in nat if b and p >= t) / len(nat)
        synthetic = sum(1 for g, p, b in syn if b and p >= t) / len(syn)
        if (false <= max_false and wrong <= max_false and synthetic <= max_synthetic
                and (best is None or correct > best["accuracy"] + 1e-9)):
            best = {"threshold": float(t), "accuracy": correct, "wrong": wrong, "false_answer_natural": false,
                    "false_answer_synthetic": synthetic, "positives": len(pos), "natural_negatives": len(nat),
                    "synthetic_negatives": len(syn)}
    return best


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalog", type=Path, default=EVAL / "catalog_snapshot.json")
    ap.add_argument("--model-dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).with_name("verifier_model.json"))
    ap.add_argument("--max-false", type=float, default=0.01)
    ap.add_argument("--runtime", default="torch", choices=("torch", "onnx"))
    ap.add_argument("--ce-dir", type=Path)
    args = ap.parse_args(argv)
    data = json.loads(args.catalog.read_text(encoding="utf-8"))
    encoder = cross_encoder = None
    if args.model_dir:
        from .service import make_encoder
        encoder = make_encoder(args.model_dir, args.runtime)
    if args.ce_dir:
        from .service import make_cross_encoder
        cross_encoder = make_cross_encoder(args.ce_dir)
    modes, report = {}, {}
    for mode in ("hybrid_ce", "hybrid", "lexical"):
        if mode != "lexical" and encoder is None or mode == "hybrid_ce" and cross_encoder is None:
            continue
        groups = collect(data, encoder, mode, cross_encoder)
        cv = cross_validate(groups)
        chosen = sweep(cv, args.max_false)
        model = fit(*_matrix(groups))
        modes[mode] = {**model, "threshold": chosen["threshold"]}
        report[mode] = {"cv": chosen, "questions": len({g["qid"] for g in groups}), "groups": len(groups),
                        "positive_groups": sum(g["positive"] for g in groups), "candidates": len(_matrix(groups)[1])}
        print(mode, json.dumps(report[mode], ensure_ascii=False))
    if "hybrid" not in modes:
        modes["hybrid"] = modes["lexical"]
    out = {"features": list(FEATURES), "modes": modes, "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "training_sets": list(DEV_SETS), "catalog": args.catalog.name, "cross_validation": report,
           "encoder": getattr(encoder, "fingerprint", None), "cross_encoder": getattr(cross_encoder, "fingerprint", None),
           "note": "Kör setler (blind_v2) eğitimde ve eşik seçiminde kullanılmadı."}
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("yazıldı:", args.out)


if __name__ == "__main__":
    main()
