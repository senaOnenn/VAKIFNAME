"""Yanıt uygunluğu denetleyicisi: "Bu onaylı olgu, ziyaretçinin sorusunu doğrudan yanıtlıyor mu?"

Arama motorunun getirdiği ilk adaylar (en çok `TOP_K`) için yalnızca soruyla olgu arasındaki ilişkiyi ölçen özellikler
hesaplanır; küçük bir lojistik regresyon modeli (yalnızca numpy, `verifier_model.json`) her aday için olasılık verir.
En yüksek olasılıklı aday eşiği geçerse cevap olarak seçilir, geçmezse sistem cevap vermez.

Denetleyici metin üretmez ve yeni bilgi ekleyemez: çıktısı yalnızca bir aday olgunun kimliği (veya hiçbiri), güven değeri
ve özelliklerden türetilen kısa bir gerekçedir. Model dosyası yoksa veya bozuksa katı kural kapısına geri çekilir
(yalnızca bütün güçlü terimleri ve cevap türü koşullarını karşılayan aday kabul edilir).
"""

import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger("vakifname.ask")

MODEL_FILE = Path(__file__).with_name("verifier_model.json")
TOP_K = 5

# Özellik adları (sıra model dosyasıyla aynı olmalı). Hepsi 0–1 aralığında ya da küçük ölçekli.
FEATURES = (
    "coverage",          # idf ağırlıklı terim kapsaması
    "strong_all",        # sorudaki bütün güçlü terimler olguda geçiyor
    "strong_frac",       # güçlü terimlerin kapsanan oranı
    "category_ok",       # kavram–kategori uyumu (kavram sorulmuyorsa 1)
    "build_ok",          # eserin kendi yapımı sorusunda yapım/vakıf kaydı ve parça başlığı yok (soru değilse 1)
    "subpart_ok",        # alt yapı (ahır, mescit) başlıklı olgu soruyla örtüşüyor (değilse 1)
    "part_maker_ok",     # "parçasını kim yaptı" sorusunda parça başlıkta ya da usta/mimar geçiyor (soru değilse 1)
    "present_ok",        # "bugün" sorusunda güncel bilgi (soru değilse 1)
    "title_overlap",     # sorulan kavram olgu başlığında
    "lex_rank1",         # kelime puanında birinci
    "cos",               # anlamsal benzerlik (yoksa 0)
    "cos_margin",        # bu olgunun benzerliği − eserdeki en yüksek diğer benzerlik
    "cos_rank1",         # anlamsal benzerlikte birinci
    "has_cos",           # anlamsal arama kullanılabiliyor
    "n_strong_inv",      # 1 / (güçlü terim sayısı + 1): az terimli sorular daha belirsizdir
    "weak_cov",          # sorudaki fiillerin (yüklem) olguda geçme oranı (fiil yoksa 1)
    "oov_verb",          # sorunun fiili hiçbir olguda geçmiyor ("nerede doğdu?")
    "obj_title",         # sorulan nesnenin (minber, kapı…) olgu başlığında geçme oranı (nesne yoksa 1)
    "person_other",      # olguda eserin kendi adındaki kişi dışında bir kişi geçiyor
    "who_q",             # "kim" sorusu (person_other ile birlikte anlamlı)
    "ce",                # cross-encoder ilgililik puanı (logit; yoksa 0)
    "ce_margin",         # bu adayın cross-encoder puanı − diğer adayların en yüksek puanı
    "ce_rank1",          # cross-encoder sıralamasında birinci
    "has_ce",            # cross-encoder kullanılabildi
)
MODES = ("hybrid_ce", "hybrid", "lexical")


@dataclass
class Decision:
    answerable: bool
    selected_fact_id: Optional[str]
    confidence: float
    reason: str
    method: str

    def to_dict(self) -> dict:
        return {"answerable": self.answerable, "selected_fact_id": self.selected_fact_id,
                "confidence": round(self.confidence, 3), "reason": self.reason, "method": self.method}


def _reason(f: dict, accepted: bool) -> str:
    good, bad = [], []
    (good if f["strong_all"] >= 1 else bad).append("sorudaki temel kavramların hepsi olguda geçiyor" if f["strong_all"] >= 1
                                                    else "sorudaki bazı temel kavramlar olguda geçmiyor")
    if f["category_ok"] < 1:
        bad.append("olgunun konusu sorulan konudan farklı")
    if f["build_ok"] < 1 or f["part_maker_ok"] < 1:
        bad.append("olgu sorulan yapı ya da parça hakkında değil")
    if f["subpart_ok"] < 1:
        bad.append("olgu eserin ayrı bir bölümüyle ilgili")
    if f["present_ok"] < 1:
        bad.append("olgu güncel durumu anlatmıyor")
    if f.get("has_ce"):
        (good if f["ce_rank1"] and f["ce"] > 0 else bad).append(
            "metin soruya doğrudan karşılık veriyor" if f["ce_rank1"] and f["ce"] > 0 else "metin soruya doğrudan karşılık vermiyor")
    if f["has_cos"]:
        (good if f["cos_rank1"] else bad).append("anlamsal olarak en yakın kayıt" if f["cos_rank1"]
                                                 else "anlamsal olarak daha yakın başka kayıt var")
    parts = good if accepted else (bad or ["soru ile olgu arasında yeterli ilişki yok"])
    return "; ".join(parts[:3]).capitalize() + "."


class Verifier:
    def __init__(self, model: Optional[dict] = None):
        self.model = model
        self.features = tuple(model["features"]) if model else FEATURES
        self.method = "learned_relevance_verifier" if model else "strict_rule_gate"

    @classmethod
    def load(cls, path: Path = MODEL_FILE) -> "Verifier":
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
            # Daha eski model dosyaları (ör. cross-encoder'sız 20 özellik) listenin başını kullanır.
            names = tuple(data["features"])
            if not names or names != FEATURES[:len(names)]:
                raise ValueError("özellik listesi uyuşmuyor")
            if not data["modes"]:
                raise ValueError("mod yok")
            for mode in data["modes"]:
                m = data["modes"][mode]
                if mode not in MODES or not len(m["weights"]) == len(m["mean"]) == len(m["std"]) == len(names) \
                        or not 0 < m["threshold"] < 1:
                    raise ValueError(f"{mode}: ağırlık/eşik geçersiz")
            return cls(data)
        except (OSError, ValueError, KeyError, TypeError) as e:
            logger.warning("Yanıt doğrulayıcı modeli yüklenemedi, katı kural kapısı kullanılıyor: %s", e)
            return cls(None)

    def mode_for(self, mode: str) -> str:
        """İstenen mod modelde yoksa daha az bileşenli moda düşer (hybrid_ce → hybrid → lexical)."""
        if mode in self.model["modes"]:
            return mode
        order = MODES[MODES.index(mode):] if mode in MODES else MODES
        return next((m for m in order if m in self.model["modes"]), "lexical")

    def probability(self, f: dict, mode: str) -> float:
        m = self.model["modes"][self.mode_for(mode)]
        z = m["bias"] + sum(w * (f[name] - mu) / sd for w, name, mu, sd in zip(m["weights"], self.features, m["mean"], m["std"]))
        return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))

    def decide(self, candidates: list[tuple[str, dict]], mode: str) -> Decision:
        """`candidates`: (olgu kimliği, özellikler) — yalnızca sert cevap türü koşullarını geçen adaylar."""
        if not candidates:
            return Decision(False, None, 0.0, "Soruyu cevaplayabilecek türde bir onaylı kayıt yok.", self.method)
        if self.model is None:
            ok = [(fid, f) for fid, f in candidates if f["strong_all"] >= 1 and f["category_ok"] >= 1 and f["build_ok"] >= 1
                  and f["subpart_ok"] >= 1 and f["part_maker_ok"] >= 1 and f["present_ok"] >= 1]
            if not ok:
                return Decision(False, None, 0.0, _reason(candidates[0][1], False), self.method)
            return Decision(True, ok[0][0], 1.0, _reason(ok[0][1], True), self.method)
        scored = sorted(((self.probability(f, mode), fid, f) for fid, f in candidates), key=lambda x: -x[0])
        p, fid, f = scored[0]
        threshold = self.model["modes"][self.mode_for(mode)]["threshold"]
        if p >= threshold:
            return Decision(True, fid, p, _reason(f, True), self.method)
        return Decision(False, None, p, _reason(f, False), self.method)
