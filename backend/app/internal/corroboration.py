"""Olguların bağımsız kaynaklarla karşılaştırılması (`data/real_catalog/fact_corroboration.json`).

Kaynak kitapların (Bursa Vakıf Eserleri Cilt I–II) yeniden yayın hakkı onaylanmadıkça kitaptan türetilmiş metin genel
katalogda yayımlanamaz. Bu modül ikinci bir yol tanımlar: olgunun, kitaptan **bağımsız** resmî veya bilimsel bir kaynakla
(Kültür Portalı, Bursa Alan Başkanlığı, TDV İslâm Ansiklopedisi …) desteklenen kısmı, kitabın cümlelerini kopyalamayan
**özgün** bir metinle yayımlanır. Kaynak kitap yalnızca kaynakça olarak (başlık ve sayfa) anılır.

Dosya hiçbir onay içermez. Yayın metni ve kaynak seçimi `fact_publication` kararının ayrıntısında editör tarafından
onaylanır; sunucu kaynakların gerçekten o olguyu desteklediğini ve metnin kaynak alıntısını kopyalamadığını denetler.
"""

import json
import re
import unicodedata
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, ValidationError, model_validator

from .catalog import CatalogError, NonEmpty, V20Catalog

IndependentKind = Literal["official_portal", "municipal_heritage", "scholarly_encyclopedia", "unesco", "vgm",
                          "academic_thesis", "news_report"]
Verdict = Literal["corroborated", "corroborated_with_discrepancy", "partially_corroborated", "source_book_only", "conflicting"]
PUBLISHABLE_VERDICTS = ("corroborated", "corroborated_with_discrepancy", "partially_corroborated")
# Yayın metni ile kaynak kitap alıntısı arasında bu uzunlukta ortak kelime dizisi olamaz.
COPY_NGRAM = 8


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CorroborationSource(_Strict):
    source_id: NonEmpty
    kind: IndependentKind
    publisher: NonEmpty
    title: NonEmpty
    url: HttpUrl
    accessed_at: NonEmpty
    # Ör. sayfa otomatik indirmeyi engelliyorsa editörün sayfayı kendisinin açması gerektiği notu.
    access_note: Optional[str] = None


class Evidence(_Strict):
    source_id: NonEmpty
    # Yalnızca iç inceleme için kısa alıntı; genel kataloğa yazılmaz.
    excerpt: NonEmpty


class Quiz(_Strict):
    question: NonEmpty
    choices: tuple[NonEmpty, ...] = Field(min_length=2, max_length=4)
    answer_index: int = Field(ge=0)
    explanation: NonEmpty

    @model_validator(mode="after")
    def _answer(self):
        if self.answer_index >= len(self.choices):
            raise ValueError("Doğru cevap seçeneklerden biri olmalı.")
        if len(set(self.choices)) != len(self.choices):
            raise ValueError("Seçenekler birbirinden farklı olmalı.")
        return self


class Revision(_Strict):
    """Editörün "düzeltme gerekli" kararına verilen yanıt. Karar değildir; kayıt yeniden incelemeye sunulur.

    `addresses_decision_id` yanıtlanan kararı gösterir. O karar artık olgunun en son kararı değilse (editör yeniden
    karar verdiyse) bu bilgi yalnızca geçmiş kaydıdır.
    """
    addresses_decision_id: NonEmpty
    revised_at: NonEmpty
    changes: tuple[NonEmpty, ...] = Field(min_length=1)
    # Kaynakla desteklenmediği için yayın metninden çıkarılan ayrıntılar.
    removed_details: tuple[NonEmpty, ...] = ()
    # Hâlâ kanıt bekleyen noktalar (editör notunda anılıp bağımsız olarak doğrulanamayan kaynaklar dahil).
    pending_evidence: tuple[NonEmpty, ...] = ()


class FactCorroboration(_Strict):
    fact_id: NonEmpty
    verdict: Verdict
    corroborations: tuple[Evidence, ...] = ()
    public_title: Optional[NonEmpty] = None
    public_text: Optional[NonEmpty] = None
    notes: NonEmpty
    recommended_action: Literal["approve_publication", "approve_partial_text", "needs_independent_source", "reject"]
    quiz: Optional[Quiz] = None
    revision: Optional[Revision] = None

    @model_validator(mode="after")
    def _complete(self):
        publishable = self.verdict in PUBLISHABLE_VERDICTS
        if publishable and not (self.public_text and self.public_title and self.corroborations):
            raise ValueError(f"{self.fact_id}: desteklenen olguda yayın metni, başlık ve kaynak zorunlu.")
        if not publishable and (self.public_text or self.quiz):
            raise ValueError(f"{self.fact_id}: bağımsız kaynakla desteklenmeyen olgu için yayın metni veya soru önerilemez.")
        return self

    @property
    def publishable(self) -> bool:
        return self.verdict in PUBLISHABLE_VERDICTS


class IssueProposal(_Strict):
    issue_id: NonEmpty
    resolution: NonEmpty
    chosen_value: Optional[NonEmpty] = None
    source_ids: tuple[NonEmpty, ...] = ()


class CorroborationCatalog:
    def __init__(self, data: dict, catalog: Optional[V20Catalog] = None):
        try:
            self.sources = {s.source_id: s for s in (CorroborationSource(**x) for x in data.get("sources", []))}
            self.facts = {f.fact_id: f for f in (FactCorroboration(**x) for x in data.get("facts", []))}
            self.issue_proposals = {i.issue_id: i for i in (IssueProposal(**x) for x in data.get("issue_proposals", []))}
        except (TypeError, ValidationError) as e:
            raise CatalogError(f"Olgu doğrulama dosyası geçersiz: {e}") from e
        for f in self.facts.values():
            for ev in f.corroborations:
                if ev.source_id not in self.sources:
                    raise CatalogError(f"{f.fact_id}: tanımsız bağımsız kaynak {ev.source_id}.")
            if catalog is not None and f.fact_id not in catalog.facts:
                raise CatalogError(f"{f.fact_id}: V20'de bulunmayan olgu.")
        for i in self.issue_proposals.values():
            if catalog is not None and i.issue_id not in catalog.issues:
                raise CatalogError(f"{i.issue_id}: V20'de bulunmayan sorun.")
        self.policy = data.get("policy", {})

    def get(self, fact_id: str) -> Optional[FactCorroboration]:
        return self.facts.get(fact_id)


EMPTY_CORROBORATION = CorroborationCatalog({})


def load_corroboration(path: Optional[Path], catalog: Optional[V20Catalog] = None) -> CorroborationCatalog:
    if path is None or not Path(path).exists():
        return EMPTY_CORROBORATION
    return CorroborationCatalog(json.loads(Path(path).read_text(encoding="utf-8")), catalog)


def _words(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text).lower()
    return re.sub(r"[^0-9a-zçğıöşüâîû]+", " ", text).split()


def copies_source(public_text: str, source_quote: Optional[str], n: int = COPY_NGRAM) -> bool:
    """Yayın metni kaynak alıntısıyla `n` kelimelik ortak bir dizi paylaşıyor mu (kopya denetimi)?"""
    if not source_quote:
        return False
    a, b = _words(public_text), _words(source_quote)
    grams = {tuple(b[i:i + n]) for i in range(len(b) - n + 1)}
    return any(tuple(a[i:i + n]) in grams for i in range(len(a) - n + 1))
