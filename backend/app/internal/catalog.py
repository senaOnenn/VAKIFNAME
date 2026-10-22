"""V20 tarihsel bilgi tabanı için doğrulamalı, salt okunur veri katmanı.

Kayıtlar `monument_id` ve `fact_id` üzerinden tutulur. Kaynak sayfaları her zaman **fiziksel PDF
sayfasıdır** (PDF dosyasındaki 1 tabanlı sayfa sırası). V20 basılı sayfa numarası içermez; bu katman
basılı sayfa numarası türetmez veya tahmin etmez.

Gerçek eserlerin V20'deki koordinatları boştur. Boş koordinat `None` olarak tutulur; asla 0,0 veya
başka bir değere çevrilmez. Konumu doğrulanmamış eser check-in akışına giremez (`to_checkin_place`).
"""

import hashlib
import json
import re
from pathlib import Path
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

from ..models import Place
from . import config

MonumentId = Annotated[str, StringConstraints(pattern=r"^BUR-\d{4}$")]
FactId = Annotated[str, StringConstraints(pattern=r"^BUR-\d{4}-F\d{3}$")]
DraftId = Annotated[str, StringConstraints(pattern=r"^DRAFT-BUR-\d{4}-\d{3}$")]
NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class CatalogError(ValueError):
    """V20 verisi beklenen şemaya veya bütünlük kurallarına uymuyor."""


class LocationUnavailableError(ValueError):
    """Eserin doğrulanmış konumu yok; harita, geofencing ve check-in için kullanılamaz."""


class _Strict(BaseModel):
    # strict: "2" -> 2 veya "false" -> False gibi sessiz dönüşümler kabul edilmez.
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class AccessFlags(_Strict):
    """Kayıt düzeyindeki yayın kısıtları. Alanların hiçbirinin varsayılanı yoktur: eksik bayrak = geçersiz kayıt."""

    scope: NonEmpty
    publication_status: NonEmpty
    public_answer_eligible: bool
    game_eligible: bool
    editor_approval_required: bool
    license_review_status: NonEmpty

    @property
    def publicly_usable(self) -> bool:
        return (
            self.publication_status == "published"
            and self.public_answer_eligible
            and not self.editor_approval_required
            and self.license_review_status == "approved"
        )


class SourceRef(_Strict):
    source_file: NonEmpty
    # Fiziksel PDF sayfası (1 tabanlı). Basılı sayfa numarası DEĞİLDİR.
    pdf_physical_page: int = Field(ge=1)
    evidence_quote: NonEmpty
    evidence_status: NonEmpty
    source_page_id: NonEmpty
    # Ekip içi derleme belgesindeki sayfa; orijinal kaynağa atıf için kullanılmaz.
    compiled_pdf: Optional[str] = None
    compiled_pdf_page: Optional[int] = Field(default=None, ge=1)


class HistoricalFact(_Strict):
    fact_id: FactId
    monument_id: MonumentId
    chunk_id: NonEmpty
    title: NonEmpty
    text: NonEmpty
    category: NonEmpty
    certainty: NonEmpty
    review_status: NonEmpty
    review_priority: NonEmpty
    open_issue_ids: tuple[str, ...]
    source: SourceRef
    access: AccessFlags


class QuarantinedDraft(_Strict):
    """Editör onayı bekleyen aday kayıt. Aramaya, RAG'e ve genel API'ye katılmaz."""

    draft_id: DraftId
    monument_id: MonumentId
    category: NonEmpty
    statement: NonEmpty
    source_file: NonEmpty
    pdf_physical_page: int = Field(ge=1)
    data_status: NonEmpty
    historical_verification: NonEmpty
    publication_status: Literal["blocked"]
    public_answer_eligible: Literal[False]
    rag_eligible: Literal[False]
    license_review_status: NonEmpty


class EditorialIssue(_Strict):
    issue_id: NonEmpty
    topic: NonEmpty
    status: NonEmpty
    monument_id: Optional[MonumentId] = None
    related_fact_ids: tuple[str, ...] = ()
    related_draft_ids: tuple[str, ...] = ()
    competing_years: tuple[int, ...] = ()
    chosen_value: Optional[str] = None


class CatalogMonument(_Strict):
    monument_id: MonumentId
    name: NonEmpty
    city: NonEmpty
    district: NonEmpty
    type: NonEmpty
    complex_ids: tuple[str, ...]
    source_files: tuple[str, ...]
    review_status: NonEmpty
    publication_status: NonEmpty
    latitude: Optional[float] = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    # V20'de konum doğrulama alanı yoktur; dolu koordinat bile "unverified" sayılır.
    location_status: Literal["missing", "unverified", "verified"]
    fact_ids: tuple[str, ...]
    draft_ids: tuple[str, ...]
    open_issue_ids: tuple[str, ...]

    @property
    def checkin_eligible(self) -> bool:
        return (
            self.location_status == "verified"
            and self.latitude is not None
            and self.longitude is not None
            and self.publication_status == "published"
        )


class SourceDocument(_Strict):
    source_file: NonEmpty
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    size_bytes: int = Field(gt=0)
    physical_page_count: int = Field(ge=1)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_coordinate(raw) -> Optional[float]:
    """V20'deki boş koordinatı (`""` veya `None`) `None` yapar; asla 0 üretmez."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if isinstance(raw, bool):
        raise CatalogError(f"Geçersiz koordinat: {raw!r}")
    try:
        return float(raw)
    except (TypeError, ValueError):
        raise CatalogError(f"Geçersiz koordinat: {raw!r}") from None


def to_checkin_place(monument: CatalogMonument) -> Place:
    """Gerçek eseri check-in sözleşmesine (`Place`) çevirir; doğrulanmış konum yoksa reddeder."""
    if not monument.checkin_eligible:
        raise LocationUnavailableError(
            f"{monument.monument_id} için doğrulanmış ve yayına açık konum yok; check-in'e eklenemez."
        )
    raise NotImplementedError("Doğrulanmış gerçek eser konumu için check-in yarıçapı henüz tanımlanmadı.")


def _issue_registry(kb: dict, freeze_manifest: dict, draft_ids: set[str]) -> dict[str, EditorialIssue]:
    """Freeze manifestindeki açık sorunları V20 içindeki kayıtlarla zenginleştirir."""
    related: dict[str, dict] = {}

    def add(issue_id, monument_id=None, facts=(), years=(), chosen=None):
        entry = related.setdefault(issue_id, {"facts": set(), "years": set()})
        if monument_id:
            entry["monument_id"] = monument_id
        entry["facts"].update(facts)
        entry["years"].update(years)
        if chosen is not None:
            entry["chosen"] = str(chosen)

    for r in kb.get("review_issue_records", []):
        add(r["issue_id"], r.get("monument_id"), [f for f in r.get("related_fact_ids", "").split(";") if f])
    for r in kb.get("research_open_conflicts", []):
        add(r["issue_id"], r.get("monument_id"), r.get("related_existing_fact_ids", []),
            r.get("competing_source_years", []), r.get("resolution"))
    for r in kb.get("source_conflict_crossrefs_v19", []):
        add(r["issue_id"], r.get("monument_id"), r.get("related_fact_ids", []),
            r.get("competing_reconstruction_years", []), r.get("chosen_year"))
    for r in kb.get("source_text_issues_v16", []):
        add(r["issue_id"], r.get("monument_id"), r.get("related_fact_ids", []))
    for r in kb.get("source_claim_issues_v18", []):
        add(r["issue_id"], r.get("monument_id"), [r["fact_id"]] if r.get("fact_id") else [])

    issues = {}
    for item in freeze_manifest.get("open_editorial_issues", []):
        issue_id = item["issue_id"]
        info = related.get(issue_id, {"facts": set(), "years": set()})
        drafts = ()
        m = re.match(r"^DRAFT-TERM-(BUR-\d{4}-\d{3})-", issue_id)
        if m and f"DRAFT-{m.group(1)}" in draft_ids:
            drafts = (f"DRAFT-{m.group(1)}",)
        issues[issue_id] = EditorialIssue(
            issue_id=issue_id,
            topic=item["topic"],
            status=item["status"],
            monument_id=info.get("monument_id") or (drafts[0][6:14] if drafts else None),
            related_fact_ids=tuple(sorted(info["facts"])),
            related_draft_ids=drafts,
            competing_years=tuple(sorted(info["years"])),
            chosen_value=info.get("chosen"),
        )
    return issues


def _fact_from_v20(raw: dict, issue_ids: tuple[str, ...]) -> HistoricalFact:
    meta, src = raw["metadata"], raw["source"]
    return HistoricalFact(
        fact_id=meta["fact_id"],
        monument_id=meta["monument_id"],
        chunk_id=raw["chunk_id"],
        title=raw["title"],
        text=raw["text"],
        category=meta["category"],
        certainty=meta["certainty"],
        review_status=meta["review_status"],
        review_priority=meta["review_priority"],
        open_issue_ids=issue_ids,
        source=SourceRef(
            source_file=src["original_book"],
            pdf_physical_page=src["original_pdf_page"],
            evidence_quote=src["evidence_quote"],
            evidence_status=src["book_evidence_status"],
            source_page_id=src["source_page_id"],
            compiled_pdf=src.get("compiled_pdf"),
            compiled_pdf_page=src.get("compiled_pdf_page"),
        ),
        access=AccessFlags(**raw["access"]),
    )


def _draft_from_v20(raw: dict) -> QuarantinedDraft:
    ev = raw["evidence"]
    return QuarantinedDraft(
        draft_id=raw["draft_fact_id"],
        monument_id=raw["monument_id"],
        category=raw["category"],
        statement=raw["statement"],
        source_file=ev["source_file"],
        pdf_physical_page=ev["pdf_page"],
        data_status=raw["data_status"],
        historical_verification=raw["historical_verification"],
        publication_status=raw["publication_status"],
        public_answer_eligible=raw["public_answer_eligible"],
        rag_eligible=raw["rag_eligible"],
        license_review_status=raw["license_review_status"],
    )


class V20Catalog:
    """Doğrulanmış V20 kataloğu. Kurucu, kurallardan biri bozulursa `CatalogError` fırlatır."""

    def __init__(self, kb: dict, freeze_manifest: dict, sources: list[SourceDocument]):
        self.schema_version = kb.get("schema_version")
        if self.schema_version != "20.0-dev":
            raise CatalogError(f"Beklenmeyen şema sürümü: {self.schema_version!r}")
        self.access_policy = dict(kb.get("access_policy") or {})
        if self.access_policy.get("publication_status") != "blocked":
            raise CatalogError("V20 erişim politikası 'blocked' olmalı; bu aşamada yayın izni yoktur.")

        self.sources = {s.source_file: s for s in sources}
        if len(self.sources) != len(sources):
            raise CatalogError("Kaynak kayıt defterinde yinelenen PDF var.")
        expected_pdf_sha = freeze_manifest.get("external_source_pdf_sha256", {})
        for name, digest in expected_pdf_sha.items():
            if name in self.sources and self.sources[name].sha256 != digest:
                raise CatalogError(f"{name} SHA-256 değeri freeze manifestiyle uyuşmuyor.")

        try:
            self._load(kb, freeze_manifest)
        except (KeyError, TypeError, ValidationError) as e:
            raise CatalogError(f"V20 kaydı geçersiz veya eksik: {e}") from e

    def _check_source(self, owner: str, source_file: str, page: int, referenced: dict[str, set[int]]):
        doc = self.sources.get(source_file)
        if doc is None:
            raise CatalogError(f"{owner}: bilinmeyen kaynak PDF {source_file!r}.")
        if not 1 <= page <= doc.physical_page_count:
            raise CatalogError(
                f"{owner}: {source_file} fiziksel sayfa {page} geçersiz (1–{doc.physical_page_count})."
            )
        if referenced is not None and page not in referenced.get(source_file, set()):
            raise CatalogError(f"{owner}: {source_file} s.{page}, V20 kaynak sayfa listesinde yok.")

    def _load(self, kb: dict, freeze_manifest: dict):
        referenced = {s["source_file"]: set(s["referenced_pdf_pages"]) for s in kb["sources"]}
        raw_monuments = kb["monuments"]

        monument_ids = [m["monument_id"] for m in raw_monuments]
        if len(set(monument_ids)) != len(monument_ids):
            raise CatalogError("Yinelenen eser kimliği.")

        draft_ids = {d["draft_fact_id"] for m in raw_monuments for d in m.get("research_fact_drafts", [])}
        self.issues = _issue_registry(kb, freeze_manifest, draft_ids)
        issues_by_fact: dict[str, set[str]] = {}
        for issue in self.issues.values():
            for fid in issue.related_fact_ids:
                issues_by_fact.setdefault(fid, set()).add(issue.issue_id)

        self.monuments: dict[str, CatalogMonument] = {}
        self.facts: dict[str, HistoricalFact] = {}
        self.drafts: dict[str, QuarantinedDraft] = {}

        for m in raw_monuments:
            mid = m["monument_id"]
            meta = m["catalog_metadata"]
            if meta["monument_id"] != mid:
                raise CatalogError(f"{mid}: katalog meta verisindeki kimlik uyuşmuyor.")

            fact_ids = []
            for raw in m["historical_facts"]:
                fid = raw["metadata"]["fact_id"]
                own = set(raw["metadata"].get("related_issue_ids", []))
                fact = _fact_from_v20(raw, tuple(sorted(own | issues_by_fact.get(fid, set()))))
                if fact.monument_id != mid or not fact.fact_id.startswith(mid + "-"):
                    raise CatalogError(f"{fid}: olgu başka bir esere bağlı görünüyor ({mid}).")
                if fact.fact_id in self.facts:
                    raise CatalogError(f"Yinelenen olgu kimliği: {fact.fact_id}")
                self._check_source(fact.fact_id, fact.source.source_file, fact.source.pdf_physical_page, referenced)
                self.facts[fact.fact_id] = fact
                fact_ids.append(fact.fact_id)
            if m.get("fact_count") != len(fact_ids):
                raise CatalogError(f"{mid}: fact_count ({m.get('fact_count')}) ile olgu sayısı ({len(fact_ids)}) farklı.")

            own_drafts = []
            for raw in m.get("research_fact_drafts", []):
                draft = _draft_from_v20(raw)
                if draft.monument_id != mid:
                    raise CatalogError(f"{draft.draft_id}: aday kayıt başka bir esere bağlı.")
                if draft.draft_id in self.drafts:
                    raise CatalogError(f"Yinelenen aday kimliği: {draft.draft_id}")
                # Adaylar yeni kaynak pasajlarından gelir; sayfa geçerli olmalı ama V20 sayfa listesinde olması gerekmez.
                self._check_source(draft.draft_id, draft.source_file, draft.pdf_physical_page, None)
                self.drafts[draft.draft_id] = draft
                own_drafts.append(draft.draft_id)

            lat, lon = parse_coordinate(meta.get("latitude")), parse_coordinate(meta.get("longitude"))
            if (lat is None) != (lon is None):
                raise CatalogError(f"{mid}: koordinatın yalnızca bir bileşeni dolu.")
            issue_ids = set(m.get("open_issue_ids", []))
            issue_ids |= {i.issue_id for i in self.issues.values() if i.monument_id == mid}
            for fid in fact_ids:
                issue_ids |= set(self.facts[fid].open_issue_ids)

            self.monuments[mid] = CatalogMonument(
                monument_id=mid,
                name=m["name"],
                city=meta["city"],
                district=meta["district"],
                type=meta["type"],
                complex_ids=tuple(m.get("complex_ids", [])),
                source_files=tuple(m.get("source_files", [])),
                review_status=m["editorial"]["review_status"],
                publication_status=m["editorial"]["publication_status"],
                latitude=lat,
                longitude=lon,
                location_status="missing" if lat is None else "unverified",
                fact_ids=tuple(fact_ids),
                draft_ids=tuple(own_drafts),
                open_issue_ids=tuple(sorted(issue_ids)),
            )

        overlap = set(self.facts) & set(self.drafts)
        if overlap:
            raise CatalogError(f"Aday ve olgu kimlikleri çakışıyor: {sorted(overlap)}")
        for issue in self.issues.values():
            unknown = [f for f in issue.related_fact_ids if f not in self.facts]
            if unknown:
                raise CatalogError(f"{issue.issue_id}: bilinmeyen olgu kimlikleri {unknown}")

    def verify_freeze_summary(self, freeze_manifest: dict) -> dict:
        """Kayıt sayılarını freeze manifestindeki özetle karşılaştırır."""
        summary = freeze_manifest["summary"]
        checks = {
            "monuments": (len(self.monuments), summary["monuments"]),
            "existing_historical_facts": (len(self.facts), summary["existing_historical_facts"]),
            "unapproved_drafts": (len(self.drafts), summary["unapproved_drafts"]),
            "open_editorial_issues": (len(self.issues), summary["open_editorial_issues"]),
        }
        mismatched = {k: v for k, v in checks.items() if v[0] != v[1]}
        if mismatched:
            raise CatalogError(f"Freeze manifesti ile sayılar uyuşmuyor: {mismatched}")
        return {k: v[0] for k, v in checks.items()}

    def facts_for(self, monument_id: str) -> list[HistoricalFact]:
        return [self.facts[f] for f in self.monuments[monument_id].fact_ids]

    def publicly_usable_facts(self) -> list[HistoricalFact]:
        """Genel kullanıma açılabilecek olgular. V20'de bu liste boştur."""
        return [f for f in self.facts.values() if f.access.publicly_usable]


def load_source_registry(path: Path) -> list[SourceDocument]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    try:
        return [SourceDocument(**s) for s in raw["sources"]]
    except (KeyError, TypeError, ValidationError) as e:
        raise CatalogError(f"Kaynak kayıt defteri geçersiz: {e}") from e


def load_catalog(data_dir: Path) -> V20Catalog:
    """Korumalı veri dizininden V20 kataloğunu yükler ve SHA-256 / sayı kontrollerini yapar."""
    data_dir = Path(data_dir)
    v20 = data_dir / config.V20_DIR
    kb_path = v20 / config.KNOWLEDGE_BASE_FILE
    freeze = json.loads((v20 / config.FREEZE_MANIFEST_FILE).read_text(encoding="utf-8"))
    if sha256_file(kb_path) != freeze["base_database_sha256"]:
        raise CatalogError("V20 bilgi tabanının SHA-256 değeri freeze manifestiyle uyuşmuyor.")
    kb = json.loads(kb_path.read_text(encoding="utf-8"))
    sources = load_source_registry(data_dir / config.MANIFESTS_DIR / config.SOURCE_REGISTRY_FILE)
    catalog = V20Catalog(kb, freeze, sources)
    catalog.verify_freeze_summary(freeze)
    return catalog
