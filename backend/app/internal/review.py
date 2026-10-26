"""Gerçek eser başına editör, lisans, kaynak ve konum inceleme durumu.

`ReviewStatus` yalnızca durumu raporlar; hiçbir kaydı yayına açmaz. `public_release_blockers` boş olmayan
eser genel kataloğa alınamaz. Görsellerin lisansı eserin kendisinin yayınını engellemez ama görsel ancak
`ImageRecord.publishable` olduğunda sunulabilir.

`service` verilirse durum inceleme veritabanındaki kararlardan hesaplanır (`decisions.DecisionService`). V20'deki
`review_status` / `access` alanları değişmez; onay yalnızca kayıtlı karardan gelir. Kaynak sayfa denetiminin
`quote_found_on_page` sonucu editör onayı sayılmaz.
"""

from typing import TYPE_CHECKING, Literal, Optional

from pydantic import BaseModel, ConfigDict

from .catalog import SourceAuditRecord, V20Catalog
from .images import ImageInventory

if TYPE_CHECKING:
    from .decisions import DecisionService

ReleaseBlocker = Literal[
    "editor_review_pending",
    "publication_blocked",
    "license_review_pending",
    "location_missing",
    "location_unverified",
    "facts_not_approved",
    "source_audit_incomplete",
    "open_editorial_issues",
    "catalog_identity_pending",
    "source_rights_pending",
]


class ReviewStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    editor_review: str
    publication_status: str
    license_review: str
    location_status: str
    facts_total: int
    facts_publicly_usable: int
    facts_awaiting_editor: int
    facts_license_unchecked: int
    # Sonuç -> kayıt sayısı; denetim kaydı olmayan olgular "not_audited" altında sayılır.
    source_audit: dict[str, int]
    drafts_quarantined: int
    images_total: int
    images_publishable: int
    images_license_pending: int
    images_link_unverified: int
    open_issues: int
    public_release_blockers: tuple[ReleaseBlocker, ...]
    # Yalnızca `service` verildiğinde: karar tabanlı ayrı yayın kapıları (bkz. `DecisionService.gates`).
    gates: Optional[dict] = None


def review_status(
    catalog: V20Catalog,
    images: ImageInventory,
    audit: dict[str, SourceAuditRecord],
    monument_id: str,
    service: Optional["DecisionService"] = None,
    latest: Optional[dict] = None,
) -> ReviewStatus:
    if service is not None:
        return _decision_review_status(catalog, images, audit, monument_id, service, latest)
    m = catalog.monuments[monument_id]
    facts = catalog.facts_for(monument_id)
    imgs = images.for_monument(monument_id)

    audit_counts: dict[str, int] = {}
    for f in facts:
        result = audit[f.fact_id].result if f.fact_id in audit else "not_audited"
        audit_counts[result] = audit_counts.get(result, 0) + 1

    blockers: list[ReleaseBlocker] = []
    if m.review_status != "approved":
        blockers.append("editor_review_pending")
    if m.publication_status != "published":
        blockers.append("publication_blocked")
    if m.license_review_status != "approved":
        blockers.append("license_review_pending")
    if m.location.status == "missing":
        blockers.append("location_missing")
    elif m.location.status == "unverified":
        blockers.append("location_unverified")
    if any(not f.access.publicly_usable for f in facts):
        blockers.append("facts_not_approved")
    if set(audit_counts) - {"quote_found_on_page"}:
        blockers.append("source_audit_incomplete")
    if m.open_issue_ids:
        blockers.append("open_editorial_issues")

    return ReviewStatus(
        editor_review=m.review_status,
        publication_status=m.publication_status,
        license_review=m.license_review_status,
        location_status=m.location.status,
        facts_total=len(facts),
        facts_publicly_usable=sum(f.access.publicly_usable for f in facts),
        facts_awaiting_editor=sum(f.access.editor_approval_required for f in facts),
        facts_license_unchecked=sum(f.access.license_review_status != "approved" for f in facts),
        source_audit=audit_counts,
        drafts_quarantined=len(m.draft_ids),
        images_total=len(imgs),
        images_publishable=sum(i.publishable for i in imgs),
        images_license_pending=sum(i.license_status != "approved" for i in imgs),
        images_link_unverified=sum(i.monument_link_status != "editor_confirmed" for i in imgs),
        open_issues=len(m.open_issue_ids),
        public_release_blockers=tuple(blockers),
    )


def _audit_counts(facts, audit) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in facts:
        result = audit[f.fact_id].result if f.fact_id in audit else "not_audited"
        counts[result] = counts.get(result, 0) + 1
    return counts


def _decision_review_status(catalog, images, audit, monument_id, service: "DecisionService", latest) -> ReviewStatus:
    latest = service.store.latest_all() if latest is None else latest
    m = catalog.monuments[monument_id]
    facts = catalog.facts_for(monument_id)
    imgs = images.for_monument(monument_id)
    gates = service.gates(monument_id, latest)
    identity = service.effective("monument", monument_id, "catalog_identity", latest)
    audit_counts = _audit_counts(facts, audit)
    unresolved = [i for i in m.open_issue_ids if not service.issue_resolved(i, latest)]
    rights_pending = {f.source.source_file for f in facts
                      if not service.effective("source", f.source.source_file, "source_usage_rights", latest).approved}

    blockers: list[ReleaseBlocker] = []
    if not gates["public"]:
        blockers.append("publication_blocked")
    if not identity.approved:
        blockers.append("catalog_identity_pending")
    if gates["facts_editor_approved"] < len(facts):
        blockers.append("editor_review_pending")
    if len(gates["facts_published"]) < len(facts):
        blockers.append("facts_not_approved")
    if rights_pending:
        blockers.append("source_rights_pending")
    if len(gates["images_published"]) < len(imgs):
        blockers.append("license_review_pending")
    if gates["location_status"] == "missing":
        blockers.append("location_missing")
    elif gates["location_status"] == "unverified":
        blockers.append("location_unverified")
    if set(audit_counts) - {"quote_found_on_page"}:
        blockers.append("source_audit_incomplete")
    if unresolved:
        blockers.append("open_editorial_issues")

    return ReviewStatus(
        editor_review=identity.status,
        publication_status="published" if gates["public"] else "blocked",
        license_review="approved" if not rights_pending else "pending",
        location_status=gates["location_status"],
        facts_total=len(facts),
        facts_publicly_usable=len(gates["facts_published"]),
        facts_awaiting_editor=len(facts) - gates["facts_editor_approved"],
        facts_license_unchecked=sum(f.source.source_file in rights_pending for f in facts),
        source_audit=audit_counts,
        drafts_quarantined=len(m.draft_ids),
        images_total=len(imgs),
        images_publishable=len(gates["images_published"]),
        images_license_pending=len(imgs) - gates["images_rights_recorded"],
        images_link_unverified=len(imgs) - gates["images_rights_recorded"],
        open_issues=len(unresolved),
        public_release_blockers=tuple(blockers),
        gates=gates,
    )
