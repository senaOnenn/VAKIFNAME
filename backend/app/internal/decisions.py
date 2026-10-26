"""Editör, hak ve konum karar kuralları; yayın kapıları bu kararlardan hesaplanır.

Her yayın izni ayrı bir karardır ve ayrı bir rol gerektirir:

| Karar türü | Konu | Rol | Ne izin verir |
|---|---|---|---|
| `catalog_identity` | eser | editor | Eser kimliği ve temel katalog meta verisinin yayımlanması (olgu, görsel ve konum kararlarından bağımsız; resmî kaynak veya kaynak PDF kullanım hakkı gerekir) |
| `fact_editorial` | olgu | editor | Olgunun tarihsel doğruluğu (yayın izni değildir) |
| `fact_publication` | olgu | editor | Olgunun genel katalogda yayımlanması (kaynak hakkıyla veya bağımsız kaynak + özgün metinle) |
| `fact_game_use` | olgu | editor | Olgudan görev/soru üretilmesi (soru, seçenekler ve doğru cevap kararın içindedir) |
| `source_usage_rights` | kaynak PDF | rights | Kaynaktan türetilen metnin yayında kullanılması |
| `image_rights` | görsel | rights | Hak sahibi, lisans, atıf ve eser eşleşmesinin kaydı |
| `image_publication` | görsel | rights | Fotoğrafın katalogda yayımlanması |
| `image_game_use` | görsel | rights | Fotoğrafın oyun içinde kullanılması |
| `image_reference_index` | görsel | rights | Fotoğrafın yerel görsel tanıma referans indeksinde kullanılması (yayın değildir) |
| `location_verification` | konum | location | Koordinat adayının doğrulanması |
| `location_map_display` | konum | location | Konumun haritada gösterilmesi |
| `gps_checkin` | konum | location | Güvenli giriş noktası ve yarıçapla GPS check-in |
| `issue_resolution` | açık sorun | editor | Editoryal sorunun çözülmesi |
| `draft_triage` | karantina adayı | editor | Adayın sonraki veri sürümüne alınması önerisi (yayına etkisi yok) |

Kurallar:
- Kayıtlı karar yoksa durum `pending`'dir. Kaynak sayfa denetimi (`quote_found_on_page`) hiçbir kararı otomatik vermez.
- Karar yalnızca kişisel incelemeci hesabıyla, tek konu için ve önceden açılmış bir inceleme biletiyle kaydedilir.
  Bilet konunun içerik özetini taşır; konu değişmişse veya arada başka karar kaydedilmişse karar reddedilir.
  Bilet açıldıktan sonra en az `min_review_seconds` geçmeden onay verilemez; incelemeci başına zaman penceresinde
  kayıt sayısı sınırlıdır. Toplu karar ucu yoktur.
- Karar, kaydedildiği veri sürümü ve konu özeti değişirse geçersiz (`stale`) sayılır ve kapılarda `pending` gibi işlem görür.
- Görsel kararları birbirinden bağımsızdır: `image_publication` ve `image_reference_index` yalnızca `image_rights`
  onayına dayanır, birbirini gerektirmez. Hak kaydı yoksa veya geri alınırsa hiçbir kullanım geçerli olmaz.
  Kitap/arşiv görselleri ve dondurulmuş test kümesi fotoğrafları referans indeksine alınamaz. İstisna: hackathon ZIP
  ek katmanındaki arşiv fotoğrafları, hak kaydı yazılı izinle (`written_permission`) onaylanır ve belgelenmiş kimlik
  çelişkisi yoksa yayın ve referans kararına açılır.
- Onay ön koşulları zincirdir (ör. yayın için editör onayı, eser kimliği onayı ve kaynak kullanım hakkı). Zincirdeki bir
  halka sonradan reddedilirse sonraki onaylar kapılarda etkisiz kalır.
"""

import hashlib
import json
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Annotated, Callable, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..geo import haversine_m
from .catalog import CoordinateSource, LocationRecord, NonEmpty, SourceAuditRecord, V20Catalog
from .corroboration import EMPTY_CORROBORATION, CorroborationCatalog, Quiz, copies_source
from .images import EMPTY_HOLDOUT, HoldoutSet, ImageInventory
from .research import ResearchCatalog
from .review_store import DecisionRecord, Reviewer, ReviewStore, ReviewStoreError

SubjectKind = Literal["monument", "fact", "draft", "issue", "source", "image", "location"]
DecisionStatus = Literal["pending", "approved", "rejected", "needs_revision"]
SourceCheck = Literal["not_checked", "verified_on_page", "verified_with_discrepancy", "not_supported", "not_applicable"]
VERIFIED_SOURCE_CHECKS = ("verified_on_page", "verified_with_discrepancy")

MIN_RATIONALE_CHARS = 15
DEFAULT_MIN_REVIEW_SECONDS = 5.0
DEFAULT_RATE_LIMIT = (20, 600)  # (karar sayısı, saniye) / incelemeci
TICKET_TTL_S = 30 * 60
MAX_TICKETS = 500
MAX_CHECKIN_RADIUS_M = 150.0
MAX_CHECKIN_DISTANCE_FROM_MONUMENT_M = 250.0
# Kimliği tek başına doğrulayabilen, kaynak kitaptan bağımsız resmî kaynak türleri. Açık harita verisi ve Wikidata
# yalnızca çapraz kontroldür; V20 kaynak PDF'i ancak kullanım hakkı kaydıyla kullanılabilir.
INDEPENDENT_IDENTITY_SOURCE_KINDS = frozenset({"official_portal", "municipal_heritage", "vgm", "cadastral"})


class DecisionError(ValueError):
    """Karar kurallara uymuyor. `code` arayüzde ve testlerde kullanılır."""

    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.status = status


class _Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CatalogIdentityPayload(_Payload):
    """Temel kimlik (ad, tür, şehir, ilçe, adres, BUR kimliği). Olgu, görsel ve konum kararlarından bağımsızdır.

    Yayımlanan her alan editörün açıkça seçtiği değerdir; araştırma dosyasındaki otomatik derlenmiş metin (ör. erişim
    notu) kendiliğinden yayına geçmez.
    """

    # Yayında gösterilecek ad; araştırmadaki tam ad, V20 adı veya alternatif adlardan biri olmalı.
    display_name: NonEmpty
    # Yayında gösterilecek adres; araştırmadaki adres iddialarından biri olmalı.
    display_address: NonEmpty
    # Kimliği destekleyen kaynaklar (araştırmada `identity` desteği olan). En az biri resmî/bağımsız kaynak olmalı veya
    # V20 kaynak PDF'i için kullanım hakkı onaylanmış olmalı (bkz. `identity_source_rules`).
    identity_source_ids: tuple[NonEmpty, ...] = Field(min_length=1)
    published_alternative_names: tuple[NonEmpty, ...] = ()
    # Ziyaretçiye gösterilecek kısa saygı/erişim notu; editör kendi yazar veya boş bırakır.
    public_site_notice: Optional[NonEmpty] = None
    # Esere ait tüm araştırma tutarsızlıkları okunduğunu kayda geçirir.
    acknowledged_discrepancy_ids: tuple[str, ...] = ()


ImageLicense = Literal[
    "CC0-1.0", "CC-BY-2.0", "CC-BY-3.0", "CC-BY-4.0", "CC-BY-SA-2.0", "CC-BY-SA-2.5", "CC-BY-SA-3.0", "CC-BY-SA-4.0",
    "public_domain", "project_owned", "written_permission",
]


class ImageRightsPayload(_Payload):
    rights_holder: NonEmpty
    license: ImageLicense
    attribution: Optional[NonEmpty] = None
    permission_reference: Optional[NonEmpty] = None
    monument_match: Literal["confirmed"]
    source_url: Optional[NonEmpty] = None

    @model_validator(mode="after")
    def _complete(self):
        if self.license.startswith("CC-BY") and not self.attribution:
            raise ValueError("CC-BY lisansında atıf metni zorunludur.")
        if self.license == "written_permission" and not self.permission_reference:
            raise ValueError("Yazılı izinde izin belgesi referansı zorunludur.")
        return self


ImageAngle = Literal["dis_cephe", "genel_gorunum", "ic_mekan", "kubbe_minare", "kapi_kitabe", "mimari_ayrinti"]


class ImageReferenceIndexPayload(_Payload):
    """Görsel tanıma referansı olarak kullanım. Yayın izni vermez; ölçümde katman ayırmak için içerik niteliklerini kaydeder.

    Eser eşleşmesi hak kararında onaylanmış olsa da burada yeniden ve açıkça işaretlenir: referans indeksindeki yanlış
    etiket, tanıma sonucunu doğrudan bozar.
    """

    monument_match: Literal["confirmed"]
    angle_classes: tuple[ImageAngle, ...] = Field(min_length=1)
    people: Literal["none", "incidental", "prominent"]
    visible_text: Literal["none", "incidental", "readable_name"]
    note: Optional[NonEmpty] = None


class FactPublicationPayload(_Payload):
    """Olgunun yayında görünecek hali.

    - `licensed_source`: kaynak kitabın kullanım hakkı (`source_usage_rights`) onaylıdır; metin kitaptan türetilebilir.
    - `independent_corroboration`: olgu kitaptan bağımsız kaynaklarla (bkz. `corroboration.py`) desteklenir; yayın metni
      özgündür ve kitap alıntısını kopyalamaz. Kitap yalnızca kaynakça olarak anılır; kullanım hakkı gerekmez.
    """

    basis: Literal["licensed_source", "independent_corroboration"]
    title: NonEmpty
    public_text: Annotated[str, Field(min_length=20, max_length=1200)]
    corroboration_source_ids: tuple[NonEmpty, ...] = ()

    @model_validator(mode="after")
    def _sources(self):
        if self.basis == "independent_corroboration" and not self.corroboration_source_ids:
            raise ValueError("Bağımsız kaynakla yayında en az bir kaynak seçilmelidir.")
        return self


class FactGameUsePayload(Quiz):
    """Olgudan üretilen keşif sorusu. Doğru cevap yalnızca sunucuda tutulur; genel API soruyu cevapsız sunar."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceRightsPayload(_Payload):
    rights_holder: NonEmpty
    permission_reference: NonEmpty
    permitted_uses: tuple[Literal["citation", "paraphrased_facts", "short_quotes"], ...] = Field(min_length=1)


class LocationVerificationPayload(_Payload):
    candidate_id: NonEmpty
    method: CoordinateSource
    # Doğrulamayı belgeleyen kayıt (ölçüm dosyası, tescil fişi, kadastro parsel no., harita kontrol notu).
    verification_reference: NonEmpty
    accuracy_m: float = Field(gt=0, allow_inf_nan=False)
    acknowledged_discrepancy_ids: tuple[str, ...] = ()


class CheckInPayload(_Payload):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    radius_m: float = Field(gt=0, le=MAX_CHECKIN_RADIUS_M, allow_inf_nan=False)
    point_accuracy_m: float = Field(gt=0, allow_inf_nan=False)
    point_kind: Literal["public_entrance_outside", "public_square", "public_street_frontage"]
    public_access_confirmed: Literal[True]
    outside_worship_and_burial_areas: Literal[True]
    access_hours_note: NonEmpty
    safety_note: NonEmpty

    @model_validator(mode="after")
    def _radius(self):
        if self.radius_m < self.point_accuracy_m:
            raise ValueError("Check-in yarıçapı noktanın doğruluğundan küçük olamaz.")
        return self


class IssueResolutionPayload(_Payload):
    resolution: NonEmpty
    chosen_value: Optional[NonEmpty] = None


@dataclass(frozen=True)
class DecisionSpec:
    name: str
    subject_kind: SubjectKind
    role: str
    label: str
    payload_model: Optional[type[_Payload]] = None
    source_check_required: bool = False


SPECS: dict[str, DecisionSpec] = {s.name: s for s in [
    DecisionSpec("catalog_identity", "monument", "editor", "Eser kimliği ve katalog meta verisinin yayını",
                 CatalogIdentityPayload, source_check_required=True),
    DecisionSpec("fact_editorial", "fact", "editor", "Olgunun editör onayı", source_check_required=True),
    DecisionSpec("fact_publication", "fact", "editor", "Olgunun yayımlanması", FactPublicationPayload),
    DecisionSpec("fact_game_use", "fact", "editor", "Olgunun oyunda kullanılması", FactGameUsePayload),
    DecisionSpec("draft_triage", "draft", "editor", "Karantina adayının sonraki sürüme önerilmesi",
                 source_check_required=True),
    DecisionSpec("issue_resolution", "issue", "editor", "Editoryal sorunun çözümü", IssueResolutionPayload,
                 source_check_required=True),
    DecisionSpec("source_usage_rights", "source", "rights", "Kaynak metin kullanım hakkı", SourceRightsPayload),
    DecisionSpec("image_rights", "image", "rights", "Görsel hak, lisans ve eşleşme kaydı", ImageRightsPayload),
    DecisionSpec("image_publication", "image", "rights", "Fotoğrafın yayımlanması"),
    DecisionSpec("image_game_use", "image", "rights", "Fotoğrafın oyunda kullanılması"),
    DecisionSpec("image_reference_index", "image", "rights", "Fotoğrafın görsel tanıma referans indeksinde kullanılması",
                 ImageReferenceIndexPayload),
    DecisionSpec("location_verification", "location", "location", "Koordinat doğrulaması",
                 LocationVerificationPayload),
    DecisionSpec("location_map_display", "location", "location", "Konumun haritada gösterilmesi"),
    DecisionSpec("gps_checkin", "location", "location", "GPS check-in izni", CheckInPayload),
]}

DECISION_TYPES_BY_KIND: dict[str, tuple[str, ...]] = {}
for _s in SPECS.values():
    DECISION_TYPES_BY_KIND[_s.subject_kind] = DECISION_TYPES_BY_KIND.get(_s.subject_kind, ()) + (_s.name,)


def _sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


@dataclass
class _Ticket:
    ticket_id: str
    session_id: str
    reviewer_id: str
    subject_kind: str
    subject_id: str
    decision_type: str
    subject_sha256: str
    supersedes: Optional[str]
    issued_at: float


@dataclass(frozen=True)
class EffectiveDecision:
    status: DecisionStatus
    record: Optional[DecisionRecord] = None
    stale: bool = False

    @property
    def approved(self) -> bool:
        return self.status == "approved"

    def to_dict(self) -> dict:
        return {"status": self.status, "stale": self.stale, "decision": self.record.to_dict() if self.record else None}


@dataclass
class DecisionService:
    catalog: V20Catalog
    images: ImageInventory
    audit: dict[str, SourceAuditRecord]
    research: ResearchCatalog
    store: ReviewStore
    data_version: str
    min_review_seconds: float = DEFAULT_MIN_REVIEW_SECONDS
    rate_limit: tuple[int, int] = DEFAULT_RATE_LIMIT
    monotonic: Callable[[], float] = time.monotonic
    corroboration: CorroborationCatalog = EMPTY_CORROBORATION
    holdout: HoldoutSet = EMPTY_HOLDOUT
    _tickets: dict = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # --- Konular ----------------------------------------------------------------------

    def subject(self, kind: str, subject_id: str) -> dict:
        """Konunun incelemede gösterilen içeriği. Bulunamazsa `DecisionError(404)`."""
        c = self.catalog
        if kind == "fact" and subject_id in c.facts:
            return c.facts[subject_id].model_dump(mode="json")
        if kind == "draft" and subject_id in c.drafts:
            return c.drafts[subject_id].model_dump(mode="json")
        if kind == "issue" and subject_id in c.issues:
            return c.issues[subject_id].model_dump(mode="json")
        if kind == "source" and subject_id in c.sources:
            return c.sources[subject_id].model_dump(mode="json")
        if kind == "image":
            img = next((i for i in self.images.images if i.image_id == subject_id), None)
            if img is not None:
                # Sonradan eklenen alanlar boşken özete girmez: eski kararların konu özeti değişmez.
                return img.model_dump(mode="json", exclude={k for k in ("zip_import", "display") if getattr(img, k) is None})
        if kind in ("monument", "location") and subject_id in c.monuments:
            m = c.monuments[subject_id]
            r = self.research.get(subject_id)
            base = {"monument_id": m.monument_id, "v20_name": m.name, "city": m.city, "district": m.district,
                    "type": m.type}
            if kind == "monument":
                return {**base, "research": r.model_dump(mode="json", exclude={"location_candidates"}) if r else None}
            return {**base,
                    "location_candidates": [x.model_dump(mode="json") for x in r.location_candidates] if r else [],
                    "discrepancies": [x.model_dump(mode="json") for x in r.discrepancies] if r else [],
                    "site_context": r.site_context.model_dump(mode="json") if r else None}
        raise DecisionError("subject_not_found", "İncelenecek kayıt bulunamadı.", 404)

    def subject_sha256(self, kind: str, subject_id: str) -> str:
        return _sha([kind, self.subject(kind, subject_id)])

    def open_issue_ids(self, kind: str, subject_id: str) -> tuple[str, ...]:
        if kind == "fact":
            return self.catalog.facts[subject_id].open_issue_ids
        if kind in ("monument", "location"):
            return self.catalog.monuments[subject_id].open_issue_ids
        if kind == "draft":
            return tuple(i.issue_id for i in self.catalog.issues.values() if subject_id in i.related_draft_ids)
        return ()

    # --- Etkin durum -------------------------------------------------------------------

    def effective(self, kind: str, subject_id: str, decision_type: str,
                  latest: Optional[dict] = None) -> EffectiveDecision:
        rec = (latest.get((kind, subject_id, decision_type)) if latest is not None
               else self.store.latest(kind, subject_id, decision_type))
        if rec is None:
            return EffectiveDecision("pending")
        if rec.data_version != self.data_version or rec.subject_sha256 != self.subject_sha256(kind, subject_id):
            return EffectiveDecision("pending", rec, stale=True)
        return EffectiveDecision(rec.decision, rec)

    def _approved(self, kind, subject_id, decision_type, latest=None) -> bool:
        return self.effective(kind, subject_id, decision_type, latest).approved

    def issue_resolved(self, issue_id: str, latest=None) -> bool:
        return self._approved("issue", issue_id, "issue_resolution", latest)

    # --- Ön koşullar -------------------------------------------------------------------

    def unmet_prerequisites(self, decision_type: str, subject_id: str, payload: Optional[_Payload] = None,
                            latest=None) -> list[str]:
        """Onay verilebilmesi için eksik koşullar (boş liste = onaylanabilir)."""
        c, missing = self.catalog, []
        ok = lambda kind, sid, dt: self._approved(kind, sid, dt, latest)  # noqa: E731

        if decision_type == "fact_editorial":
            fact = c.facts[subject_id]
            missing += [f"issue_unresolved:{i}" for i in fact.open_issue_ids if not self.issue_resolved(i, latest)]
        elif decision_type == "fact_publication":
            fact = c.facts[subject_id]
            if not ok("fact", subject_id, "fact_editorial"):
                missing.append("fact_editorial")
            if not self.identity_publishable(fact.monument_id, latest):
                missing.append("catalog_identity")
            if isinstance(payload, FactPublicationPayload) and payload.basis == "independent_corroboration":
                missing += self.independent_basis_rules(fact, payload)
            elif not ok("source", fact.source.source_file, "source_usage_rights"):
                missing.append("source_usage_rights")
            missing += [f"issue_unresolved:{i}" for i in fact.open_issue_ids if not self.issue_resolved(i, latest)]
        elif decision_type == "fact_game_use":
            if not ok("fact", subject_id, "fact_publication"):
                missing.append("fact_publication")
        elif decision_type == "catalog_identity":
            r = self.research.get(subject_id)
            if r is None:
                missing.append("research_missing")
            elif isinstance(payload, CatalogIdentityPayload):
                missing += self.identity_source_rules(r, payload, latest)
                unacked = {d.discrepancy_id for d in r.discrepancies} - set(payload.acknowledged_discrepancy_ids)
                missing += [f"discrepancy_unacknowledged:{d}" for d in sorted(unacked)]
        elif decision_type == "image_rights":
            img = self._image(subject_id)
            if img.zip_import is not None:
                # Organizatörün sağlaması tek başına yayın izni değildir; eser etiketi belgelenmiş çelişkiliyse onaylanamaz.
                if img.zip_identity_conflict:
                    missing.append("archive_identity_conflict")
                if isinstance(payload, ImageRightsPayload) and payload.license != "written_permission":
                    missing.append("zip_requires_written_permission")
        elif decision_type == "image_publication":
            img = self._image(subject_id)
            if not ok("image", subject_id, "image_rights"):
                missing.append("image_rights")
            if not self.identity_publishable(img.monument_id, latest):
                missing.append("catalog_identity")
        elif decision_type == "image_game_use":
            if not ok("image", subject_id, "image_publication"):
                missing.append("image_publication")
        elif decision_type == "image_reference_index":
            # Yayın kararından bağımsız; yalnızca hak/lisans/eşleşme kaydına dayanır.
            img = self._image(subject_id)
            if not ok("image", subject_id, "image_rights"):
                missing.append("image_rights")
            if img.collection != "wikimedia_commons" and img.zip_import is None:
                missing.append("collection_not_allowed_for_reference_index")
            if img.zip_identity_conflict:
                missing.append("archive_identity_conflict")
            if self.holdout.contains(img):
                missing.append("holdout_test_set")
        elif decision_type == "location_verification":
            r = self.research.get(subject_id)
            if r is None or not r.location_candidates:
                missing.append("no_coordinate_candidate")
            elif isinstance(payload, LocationVerificationPayload):
                cand = r.candidate(payload.candidate_id)
                if cand is None:
                    missing.append("unknown_candidate")
                else:
                    if payload.accuracy_m < cand.estimated_accuracy_m and payload.method != "field_survey_gnss":
                        missing.append("accuracy_better_than_source_requires_field_survey")
                    related = {d.discrepancy_id for d in r.discrepancies if cand.source_id in d.source_ids}
                    unacked = related - set(payload.acknowledged_discrepancy_ids)
                    missing += [f"discrepancy_unacknowledged:{d}" for d in sorted(unacked)]
        elif decision_type == "location_map_display":
            if not ok("location", subject_id, "location_verification"):
                missing.append("location_verification")
            if not self.identity_publishable(subject_id, latest):
                missing.append("catalog_identity")
        elif decision_type == "gps_checkin":
            if not ok("location", subject_id, "location_map_display"):
                missing.append("location_map_display")
            loc = self.effective_location(subject_id, latest)
            if isinstance(payload, CheckInPayload) and loc.status == "verified":
                d = haversine_m(payload.latitude, payload.longitude, loc.latitude, loc.longitude)
                if d > MAX_CHECKIN_DISTANCE_FROM_MONUMENT_M:
                    missing.append("checkin_point_too_far_from_monument")
        return missing

    def independent_basis_rules(self, fact, payload: FactPublicationPayload) -> list[str]:
        """Bağımsız kaynakla yayın: seçilen kaynaklar bu olguyu desteklemeli ve metin kitap alıntısını kopyalamamalı."""
        cor = self.corroboration.get(fact.fact_id)
        if cor is None or not cor.publishable:
            return ["independent_corroboration_missing"]
        supported = {e.source_id for e in cor.corroborations}
        missing = [f"corroboration_source_invalid:{s}" for s in payload.corroboration_source_ids if s not in supported]
        if copies_source(payload.public_text, fact.source.evidence_quote):
            missing.append("public_text_copies_source_book")
        return missing

    def identity_source_rules(self, r, payload: CatalogIdentityPayload, latest=None) -> list[str]:
        """Temel kimlik için kaynak ve telif koşulları.

        Tarihî bilginin doğruluğu ile kaynak kitabın metnini çoğaltma hakkı ayrı konulardır. Kimlik bir V20 kaynak
        PDF'ine dayanıyorsa (kaynak olarak veya seçilen adresin kaynağı olarak) o PDF için `source_usage_rights` onayı
        gerekir. Hak kaydı yoksa kimlik yalnızca resmî kaynaklarla bağımsız olarak doğrulanmış değerlerle yayımlanabilir.
        """
        missing: list[str] = []
        sources = {s.source_id: s for s in r.sources}
        names = {r.full_name, r.v20_name, *r.alternative_names}
        if payload.display_name not in names:
            missing.append("display_name_not_in_research")
        missing += [f"alternative_name_not_in_research:{n}" for n in payload.published_alternative_names
                    if n not in names]

        identity_sources = []
        for sid in payload.identity_source_ids:
            s = sources.get(sid)
            if s is None or "identity" not in s.supports:
                missing.append(f"identity_source_invalid:{sid}")
            else:
                identity_sources.append(s)
        claim = next((a for a in r.address_claims if a.value == payload.display_address), None)
        if claim is None:
            missing.append("display_address_not_in_research")
        cited = identity_sources + ([sources[claim.source_id]] if claim else [])

        def rights_ok(s) -> bool:
            return self._approved("source", s.pdf_file, "source_usage_rights", latest)

        for pdf in sorted({s.pdf_file for s in cited if s.kind == "v20_source_pdf" and not rights_ok(s)}):
            missing.append(f"source_usage_rights:{pdf}")
        if not any(s.kind in INDEPENDENT_IDENTITY_SOURCE_KINDS or (s.kind == "v20_source_pdf" and rights_ok(s))
                   for s in identity_sources):
            missing.append("independent_identity_source_required")
        return missing

    def _image(self, image_id: str):
        img = next((i for i in self.images.images if i.image_id == image_id), None)
        if img is None:
            raise DecisionError("subject_not_found", "Görsel bulunamadı.", 404)
        return img

    # --- Konum ----------------------------------------------------------------------

    def effective_location(self, monument_id: str, latest=None) -> LocationRecord:
        """Araştırma ve kararlardan eserin güncel konum kaydı. Yalnızca onaylı doğrulama `verified` üretir."""
        r = self.research.get(monument_id)
        eff = self.effective("location", monument_id, "location_verification", latest)
        if eff.approved and r is not None:
            p = eff.record.payload
            cand = r.candidate(p["candidate_id"])
            if cand is not None:
                return LocationRecord(
                    status="verified", latitude=cand.latitude, longitude=cand.longitude, source=p["method"],
                    source_reference=f"{cand.source_object} · {p['verification_reference']}",
                    accuracy_m=float(p["accuracy_m"]), verified_by=eff.record.reviewer_name,
                    verified_at=datetime.fromisoformat(eff.record.reviewed_at),
                    note=f"Karar {eff.record.decision_id}",
                )
        if r is not None and r.location_candidates:
            first = r.location_candidates[0]
            return LocationRecord(
                status="unverified", latitude=first.latitude, longitude=first.longitude,
                source_reference=first.source_object, accuracy_m=first.estimated_accuracy_m,
                note=f"{len(r.location_candidates)} aday; doğrulama kararı yok.",
            )
        return self.catalog.monuments[monument_id].location

    # --- Biletler ve kayıt -------------------------------------------------------------

    def _spec(self, decision_type: str, kind: str) -> DecisionSpec:
        spec = SPECS.get(decision_type)
        if spec is None or spec.subject_kind != kind:
            raise DecisionError("invalid_decision_type", "Bu kayıt türü için geçersiz karar türü.", 422)
        return spec

    def open_ticket(self, session_id: str, reviewer: Reviewer, kind: str, subject_id: str, decision_type: str) -> dict:
        spec = self._spec(decision_type, kind)
        if spec.role not in reviewer.roles:
            raise DecisionError("role_required", f"Bu karar '{spec.role}' rolü gerektirir.", 403)
        sha = self.subject_sha256(kind, subject_id)
        current = self.store.latest(kind, subject_id, decision_type)
        now = self.monotonic()
        with self._lock:
            self._tickets = {k: t for k, t in self._tickets.items() if now - t.issued_at < TICKET_TTL_S}
            if len(self._tickets) >= MAX_TICKETS:
                del self._tickets[min(self._tickets, key=lambda k: self._tickets[k].issued_at)]
            ticket = _Ticket(secrets.token_urlsafe(16), session_id, reviewer.reviewer_id, kind, subject_id,
                             decision_type, sha, current.decision_id if current else None, now)
            self._tickets[ticket.ticket_id] = ticket
        return {
            "ticket_id": ticket.ticket_id, "subject_kind": kind, "subject_id": subject_id,
            "decision_type": decision_type, "subject_sha256": sha, "supersedes": ticket.supersedes,
            "min_review_seconds": self.min_review_seconds, "expires_in_s": TICKET_TTL_S,
            "unmet_prerequisites": self.unmet_prerequisites(decision_type, subject_id),
        }

    def submit(self, session_id: str, reviewer: Reviewer, *, ticket_id: str, decision: str, source_check: str,
               rationale: str, payload: dict) -> DecisionRecord:
        now = self.monotonic()
        with self._lock:
            ticket = self._tickets.pop(ticket_id, None)  # Bilet tek kullanımlıktır.
        if ticket is None or ticket.session_id != session_id or ticket.reviewer_id != reviewer.reviewer_id:
            raise DecisionError("invalid_ticket", "İnceleme bileti geçersiz veya başka bir oturuma ait.", 409)
        if now - ticket.issued_at > TICKET_TTL_S:
            raise DecisionError("ticket_expired", "İnceleme biletinin süresi doldu; kaydı yeniden açın.", 409)
        return self.record_checked(
            reviewer, kind=ticket.subject_kind, subject_id=ticket.subject_id, decision_type=ticket.decision_type,
            decision=decision, source_check=source_check, rationale=rationale, payload=payload,
            subject_sha256=ticket.subject_sha256, supersedes=ticket.supersedes, review_seconds=now - ticket.issued_at,
        )

    def record_checked(self, reviewer: Reviewer, *, kind: str, subject_id: str, decision_type: str, decision: str,
                       source_check: str, rationale: str, payload: dict, subject_sha256: str,
                       supersedes: Optional[str], review_seconds: float, rate_limited: bool = True) -> DecisionRecord:
        """Tek bir kararı tüm kurallarla denetleyip kaydeder (tekil bilet ve toplu inceleme ortak yolu)."""
        spec = self._spec(decision_type, kind)
        if spec.role not in reviewer.roles:
            raise DecisionError("role_required", f"Bu karar '{spec.role}' rolü gerektirir.", 403)
        if len(rationale.strip()) < MIN_RATIONALE_CHARS:
            raise DecisionError("rationale_required", f"Karar gerekçesi en az {MIN_RATIONALE_CHARS} karakter olmalı.", 422)
        if decision == "approved" and review_seconds < self.min_review_seconds:
            raise DecisionError("review_too_fast", "Kayıt incelenmeden onay verilemez; içeriği okuyup yeniden deneyin.", 429)
        if self.subject_sha256(kind, subject_id) != subject_sha256:
            raise DecisionError("subject_changed", "Kayıt siz incelerken değişti; yeniden açın.", 409)

        if spec.source_check_required and decision == "approved" and source_check not in VERIFIED_SOURCE_CHECKS:
            raise DecisionError("source_check_required",
                                "Onay için kaynak kontrolü 'verified_on_page' veya 'verified_with_discrepancy' olmalı.", 422)
        if not spec.source_check_required and source_check not in ("not_applicable", "not_checked") + VERIFIED_SOURCE_CHECKS:
            raise DecisionError("invalid_source_check", "Geçersiz kaynak kontrolü değeri.", 422)

        parsed: Optional[_Payload] = None
        if decision == "approved" and spec.payload_model is not None:
            try:
                parsed = spec.payload_model(**payload)
            except (TypeError, ValidationError) as e:
                raise DecisionError("invalid_payload", f"Karar ayrıntıları eksik veya geçersiz: {e}", 422) from None
        elif payload:
            raise DecisionError("unexpected_payload", "Bu karar için ek ayrıntı gönderilmez.", 422)

        if decision == "approved":
            unmet = self.unmet_prerequisites(decision_type, subject_id, parsed)
            if unmet:
                raise DecisionError("prerequisites_unmet", "Onay ön koşulları karşılanmadı: " + ", ".join(unmet), 409)

        if rate_limited:
            max_n, window_s = self.rate_limit
            since = (self.store._clock() - timedelta(seconds=window_s)).isoformat(timespec="seconds")
            if self.store.count_by_reviewer_since(reviewer.reviewer_id, since) >= max_n:
                raise DecisionError("rate_limited", "Kısa sürede çok fazla karar kaydedildi; toplu inceleme ekranını kullanın.", 429)

        try:
            return self.store.record_decision(
                reviewer=reviewer, role=spec.role, subject_kind=kind, subject_id=subject_id,
                decision_type=decision_type, decision=decision, source_check=source_check, rationale=rationale,
                payload=parsed.model_dump(mode="json") if parsed else {}, data_version=self.data_version,
                subject_sha256=subject_sha256, expected_supersedes=supersedes,
                open_issue_ids=self.open_issue_ids(kind, subject_id),
            )
        except ReviewStoreError as e:
            raise DecisionError("conflict", str(e), 409) from None

    # --- Toplu durum (yalnızca okuma) -------------------------------------------------

    def decisions_for(self, kind: str, subject_id: str, latest=None) -> dict[str, dict]:
        latest = self.store.latest_all() if latest is None else latest
        return {dt: {**self.effective(kind, subject_id, dt, latest).to_dict(),
                     "label": SPECS[dt].label, "role": SPECS[dt].role,
                     "unmet_prerequisites": self.unmet_prerequisites(dt, subject_id, latest=latest)}
                for dt in DECISION_TYPES_BY_KIND[kind]}

    def gates(self, monument_id: str, latest=None) -> dict:
        """Eserin yayın kapıları. Her alan ayrı bir karardan gelir; hiçbiri varsayılan olarak açık değildir."""
        latest = self.store.latest_all() if latest is None else latest
        m = self.catalog.monuments[monument_id]
        ok = lambda kind, sid, dt: self._approved(kind, sid, dt, latest)  # noqa: E731
        identity = self.identity_publishable(monument_id, latest)
        published, game, editorial = [], [], []
        for fid in m.fact_ids:
            if ok("fact", fid, "fact_editorial"):
                editorial.append(fid)
            if self.fact_publishable(fid, latest):
                published.append(fid)
                if ok("fact", fid, "fact_game_use"):
                    game.append(fid)
        imgs = self.images.for_monument(monument_id)
        img_pub = [i.image_id for i in imgs if self.image_publishable(i.image_id, latest)]
        img_game = [i for i in img_pub if ok("image", i, "image_game_use")]
        img_ref = [i.image_id for i in imgs if self.image_reference_index_usable(i.image_id, latest)]
        loc = self.effective_location(monument_id, latest)
        map_ok = identity and loc.status == "verified" and ok("location", monument_id, "location_map_display")
        checkin_ok = map_ok and ok("location", monument_id, "gps_checkin")
        return {
            "catalog_identity": identity,
            "facts_total": len(m.fact_ids),
            "facts_editor_approved": len(editorial),
            "facts_published": published,
            "facts_game_use": game,
            "images_total": len(imgs),
            "images_rights_recorded": sum(ok("image", i.image_id, "image_rights") for i in imgs),
            "images_published": img_pub,
            "images_game_use": img_game,
            "images_reference_index": img_ref,
            "location_status": loc.status,
            "map_display": map_ok,
            "gps_checkin": checkin_ok,
            "public": identity,
        }

    def identity_publishable(self, monument_id: str, latest=None) -> bool:
        """Kimlik onayı hâlâ geçerli mi? Kaynak kullanım hakkı sonradan geri alınırsa kimlik de yayından düşer."""
        eff = self.effective("monument", monument_id, "catalog_identity", latest)
        if not eff.approved:
            return False
        try:
            payload = CatalogIdentityPayload(**eff.record.payload)
        except (TypeError, ValidationError):
            # Eski şemayla kaydedilmiş karar: yeniden inceleme gerekir.
            return False
        return not self.unmet_prerequisites("catalog_identity", monument_id, payload, latest)

    def fact_publication_payload(self, fact_id: str, latest=None) -> Optional[FactPublicationPayload]:
        eff = self.effective("fact", fact_id, "fact_publication", latest)
        if not eff.approved:
            return None
        try:
            return FactPublicationPayload(**eff.record.payload)
        except (TypeError, ValidationError):
            # Eski şemayla (ayrıntısız) kaydedilmiş yayın kararı: yeniden inceleme gerekir.
            return None

    def fact_publishable(self, fact_id: str, latest=None) -> bool:
        payload = self.fact_publication_payload(fact_id, latest)
        return payload is not None and not self.unmet_prerequisites("fact_publication", fact_id, payload, latest)

    def image_publishable(self, image_id: str, latest=None) -> bool:
        return (self._approved("image", image_id, "image_publication", latest)
                and not self.unmet_prerequisites("image_publication", image_id, latest=latest))


    def image_reference_index_usable(self, image_id: str, latest=None) -> bool:
        """Referans indeksine alınabilir mi? Hak kaydı sonradan reddedilir veya eskirse kullanım da düşer."""
        return (self._approved("image", image_id, "image_reference_index", latest)
                and not self.unmet_prerequisites("image_reference_index", image_id, latest=latest))


def data_version_for(freeze_manifest: dict) -> str:
    return f"V20:{freeze_manifest['base_database_sha256']}"
