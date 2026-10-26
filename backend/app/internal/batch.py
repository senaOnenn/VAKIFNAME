"""Toplu inceleme: yetkili incelemecinin çok sayıda **gerçek ve ayrı** kararı tek ekranda vermesi.

Neyi değiştirmez:
- Her kayıt için ayrı bir karar satırı ve ayrı bir denetim günlüğü kaydı yazılır; karar kuralları (`record_checked`)
  tekil formdakiyle aynıdır: rol, gerekçe, kaynak kontrolü, ayrıntı şeması, ön koşullar, konu özeti.
- Hiçbir kayıt önceden seçili değildir; incelemeci her satırı açıkça işaretler ve her biri için karar seçer.
  Öneriler (yayın metni, kimlik alanları, lisans) yalnızca formu doldurur; düzenlenebilir ve sunucu yeniden denetler.
- GPS check-in ve kaynak kitap kullanım hakkı toplu incelemeye alınmaz.

Neyi kolaylaştırır:
- Kararlar bağımlılık sırasıyla kaydedilir (ör. aynı gönderimde önce editör onayı, sonra yayın kararı).
- Bilet bütün seçili satırları kapsar; konu özetleri bilet açılırken sabitlenir.
- Onay için asgari inceleme süresi seçili satır sayısıyla artar.
- Ret ve düzeltme kararlarında onaya özgü ayrıntı istenmez.
"""

import json
import secrets
import threading
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Optional

from .decisions import (
    MIN_RATIONALE_CHARS, SPECS, TICKET_TTL_S, VERIFIED_SOURCE_CHECKS, DecisionError, DecisionService,
)
from .review_store import Reviewer

# Kayıt sırası: önceki aşamalar sonrakilerin ön koşuludur.
STAGES = (
    "issue_resolution", "fact_editorial", "catalog_identity", "fact_publication", "fact_game_use",
    "image_rights", "image_publication", "image_game_use", "image_reference_index", "location_verification",
    "location_map_display",
)
STAGE_LABELS = {
    "issue_resolution": "Editoryal sorunların çözümü",
    "fact_editorial": "Tarihî bilgilerin doğruluğu",
    "catalog_identity": "Eser kimlikleri",
    "fact_publication": "Tarihî bilgilerin yayını (özgün metin)",
    "fact_game_use": "Keşif soruları",
    "image_rights": "Fotoğraf hak ve lisans kayıtları",
    "image_publication": "Fotoğrafların yayını",
    "image_game_use": "Fotoğrafların oyunda kullanımı",
    "image_reference_index": "Fotoğrafların görsel tanıma referansı olarak kullanımı (yayın değildir)",
    "location_verification": "Koordinat doğrulaması",
    "location_map_display": "Haritada gösterim",
}
BATCH_MAX_ITEMS = 150
BATCH_SECONDS_PER_ITEM = 0.5
BATCH_MAX_MIN_SECONDS = 30.0
BATCH_HOURLY_LIMIT = 400

BLOCKER_TEXT = {
    "fact_editorial": "Önce bu bilginin doğruluk onayı (editör) gerekir.",
    "catalog_identity": "Önce eserin kimlik onayı (editör) gerekir.",
    "source_usage_rights": "Kaynak kitabın kullanım hakkı onaylı değil; bağımsız kaynak + özgün metinle yayımlayın.",
    "fact_publication": "Önce bilginin yayın onayı gerekir.",
    "image_rights": "Önce fotoğrafın hak ve lisans kaydı (rights) gerekir.",
    "image_publication": "Önce fotoğrafın yayın onayı gerekir.",
    "location_verification": "Önce koordinat doğrulaması (location) gerekir.",
    "independent_corroboration_missing": "Bu bilgi yalnızca kaynak kitapta; bağımsız resmî/bilimsel kaynakla desteklenmedi.",
    "public_text_copies_source_book": "Yayın metni kaynak kitabın cümlelerini kopyalıyor; özgün yazılmalı.",
    "no_coordinate_candidate": "Koordinat adayı yok.",
    "collection_not_allowed_for_reference_index": "Kitap/arşiv görselleri referans indeksine alınamaz.",
    "holdout_test_set": "Bu fotoğraf görsel tanıma test kümesinde; referans olarak kullanılamaz.",
    "research_missing": "Kaynak araştırması yok.",
}


_LEVEL3 = {0: "none", 1: "incidental", 2: "prominent"}
_TEXT3 = {0: "none", 1: "incidental", 2: "readable_name"}


def blocker_text(code: str) -> str:
    if code.startswith("issue_unresolved:"):
        return f"Önce açık sorun çözülmeli: {code.split(':', 1)[1]}."
    if code.startswith("discrepancy_unacknowledged:"):
        return f"Tutarsızlık okundu olarak işaretlenmeli: {code.split(':', 1)[1]}."
    if code.startswith("corroboration_source_invalid:"):
        return f"Seçilen kaynak bu bilgiyi desteklemiyor: {code.split(':', 1)[1]}."
    if code.startswith("source_usage_rights:"):
        return f"Kaynak kitap kullanım hakkı gerekir: {code.split(':', 1)[1]}."
    return BLOCKER_TEXT.get(code, code)


class ReviewProposals:
    """Kimlik ve konum formları için hazırlanmış öneriler (`data/real_catalog/review_proposals.json`)."""

    def __init__(self, data: dict):
        self.identity = {x["monument_id"]: x for x in data.get("identity", [])}
        self.location = {x["monument_id"]: x for x in data.get("location", [])}


def load_proposals(path: Optional[Path]) -> ReviewProposals:
    if path is None or not Path(path).exists():
        return ReviewProposals({})
    return ReviewProposals(json.loads(Path(path).read_text(encoding="utf-8")))


@dataclass
class _BatchTicket:
    ticket_id: str
    session_id: str
    reviewer_id: str
    items: dict  # anahtar -> (konu özeti, önceki karar kimliği)
    issued_at: float
    min_seconds: float


def _key(decision_type: str, subject_id: str) -> str:
    return f"{decision_type}|{subject_id}"


@dataclass
class BatchReview:
    service: DecisionService
    proposals: ReviewProposals
    _tickets: dict = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # --- Kayıt adayları -------------------------------------------------------------

    def _candidates(self) -> list[dict]:
        """(karar türü, konu) çiftleri ve önerileri. Yalnızca hazırlanmış önerisi olan kayıtlar listelenir."""
        s, c, cor = self.service, self.service.catalog, self.service.corroboration
        out = []
        for issue_id, prop in cor.issue_proposals.items():
            out.append({"decision_type": "issue_resolution", "subject_id": issue_id, "monument_id": c.issues[issue_id].monument_id,
                        "title": c.issues[issue_id].topic, "recommended": True,
                        "payload": {"resolution": prop.resolution, "chosen_value": prop.chosen_value},
                        "source_check": "verified_with_discrepancy",
                        "evidence": [self._source_evidence(sid) for sid in prop.source_ids], "notes": None})
        for fid, fact in c.facts.items():
            fc = cor.get(fid)
            if fc is None:
                continue
            book = {"label": f"Kaynak kitap: {fact.source.source_file}, fiziksel s.{fact.source.pdf_physical_page}",
                    "text": fact.source.evidence_quote, "url": None}
            evidence = [book] + [self._source_evidence(e.source_id, e.excerpt) for e in fc.corroborations]
            check = "verified_on_page" if fc.verdict == "corroborated" else "verified_with_discrepancy"
            base = {"subject_id": fid, "monument_id": fact.monument_id, "title": fact.title, "verdict": fc.verdict,
                    "evidence": evidence, "notes": fc.notes, "v20_text": fact.text,
                    "revision": fc.revision.model_dump(mode="json") if fc.revision else None}
            out.append({**base, "decision_type": "fact_editorial", "recommended": fc.publishable,
                        "default_decision": "rejected" if fc.recommended_action == "reject" else None,
                        "payload": {}, "source_check": check if fc.publishable else "not_checked"})
            if fc.publishable:
                out.append({**base, "decision_type": "fact_publication", "recommended": True, "source_check": check,
                            "payload": {"basis": "independent_corroboration", "title": fc.public_title,
                                        "public_text": fc.public_text,
                                        "corroboration_source_ids": [e.source_id for e in fc.corroborations]}})
            if fc.quiz is not None:
                out.append({**base, "decision_type": "fact_game_use", "recommended": True, "source_check": "not_applicable",
                            "payload": fc.quiz.model_dump(mode="json")})
        for mid, prop in self.proposals.identity.items():
            r = s.research.get(mid)
            out.append({"decision_type": "catalog_identity", "subject_id": mid, "monument_id": mid,
                        "title": prop["payload"]["display_name"], "recommended": prop.get("recommended", True),
                        "payload": prop["payload"], "source_check": "verified_with_discrepancy" if r and r.discrepancies else "verified_on_page",
                        "evidence": self._research_evidence(r, prop["payload"]["identity_source_ids"]), "notes": prop.get("notes")})
        for img in s.images.images:
            if img.collection != "wikimedia_commons" or not img.proposed_rights:
                continue
            p = img.provenance or {}
            review = p.get("review") or {}
            candidate = p.get("candidate_batch") is not None
            evidence = [{"label": f"Wikimedia Commons: {p.get('title', '')}", "url": p.get("file_page_url"),
                         "text": f"Yazar: {p.get('artist')} · Lisans: {p.get('license_short_name')} · {p.get('description') or ''}"},
                        {"label": "Masa başı eşleşme notu", "url": None,
                         "text": " ".join(x for x in ((p.get("verification") or {}).get("monument_match"),
                                                      (p.get("verification") or {}).get("notes")) if x)}]
            evidence += [{"label": "Kimlik kanıtı (masa başı; onay değildir)", "url": None, "text": t}
                         for t in review.get("identity_evidence", [])]
            base = {"subject_id": img.image_id, "monument_id": img.monument_id, "title": p.get("title", img.image_id),
                    "evidence": evidence, "notes": (p.get("verification") or {}).get("modification"),
                    "preview_url": p.get("thumb_url"), "media_url": f"/internal/review/media/card/{img.image_id}",
                    "image_facts": self._image_facts(img), "source_check": "verified_on_page"}
            out.append({**base, "decision_type": "image_rights", "recommended": True, "payload": dict(img.proposed_rights)})
            # Yeni adaylarda yayın önerilmez (ayrı ve bilinçli karar); oyun kullanımı bu partide listelenmez.
            out.append({**base, "decision_type": "image_publication", "recommended": not candidate, "payload": {},
                        "source_check": "not_applicable"})
            if not candidate:
                out.append({**base, "decision_type": "image_game_use", "recommended": True, "payload": {},
                            "source_check": "not_applicable"})
            # Eser eşleşmesi bilerek önceden işaretlenmez; açı ve içerik sınıfları masa başı incelemeden gelir, düzenlenebilir.
            out.append({**base, "decision_type": "image_reference_index", "recommended": candidate,
                        "source_check": "not_applicable",
                        "payload": {"angle_classes": list(review.get("angles", [])),
                                    "people": _LEVEL3.get(review.get("people")),
                                    "visible_text": _TEXT3.get(review.get("sign_or_text"))}})
        for mid, prop in self.proposals.location.items():
            r = s.research.get(mid)
            cand = r.candidate(prop["payload"]["candidate_id"]) if r else None
            evidence = [{"label": f"Aday {cand.candidate_id}: {cand.latitude}, {cand.longitude} ({cand.represents}, ±{cand.estimated_accuracy_m:g} m)",
                         "url": f"https://www.openstreetmap.org/?mlat={cand.latitude}&mlon={cand.longitude}#map=19/{cand.latitude}/{cand.longitude}",
                         "text": cand.notes or ""}] if cand else []
            evidence.append({"label": "Doğrulama kaydı", "url": None, "text": prop["payload"]["verification_reference"]})
            base = {"subject_id": mid, "monument_id": mid, "title": c.monuments[mid].name, "evidence": evidence,
                    "notes": prop.get("notes"), "recommended": prop.get("recommended", True), "source_check": "not_applicable"}
            out.append({**base, "decision_type": "location_verification", "payload": prop["payload"]})
            out.append({**base, "decision_type": "location_map_display", "payload": {}})
        return out

    def _image_facts(self, img) -> dict:
        """İnceleme ekranındaki fotoğraf künyesi (yalnızca gösterim; karar içeriği değildir)."""
        p = img.provenance or {}
        r = p.get("review") or {}
        m = self.service.catalog.monuments.get(img.monument_id)
        return {
            "candidate_batch": p.get("candidate_batch"), "monument_name": m.name if m else None,
            "file_page_url": p.get("file_page_url"), "artist": p.get("artist"), "credit": p.get("credit"),
            "license_short_name": p.get("license_short_name"), "license_url": p.get("license_url"),
            "license_obligations": r.get("license_obligations"),
            "attribution": (img.proposed_rights or {}).get("attribution"),
            "stored_size": [img.width, img.height], "original_size": [p.get("original_width"), p.get("original_height")],
            "date": p.get("date"), "angle_classes": r.get("angles", []), "people": r.get("people"),
            "sign_or_text": r.get("sign_or_text"), "confusion_risk": r.get("confusion_risk"),
            "doubts": r.get("doubts", []), "reviewed_by": r.get("by"),
        }

    def _source_evidence(self, source_id: str, excerpt: Optional[str] = None) -> dict:
        src = self.service.corroboration.sources.get(source_id)
        if src is None:
            return {"label": source_id, "url": None, "text": excerpt or ""}
        text = excerpt or ""
        if src.access_note:
            text = f"{text} ({src.access_note})".strip()
        return {"label": f"{src.publisher}: {src.title}", "url": str(src.url), "text": text}

    @staticmethod
    def _research_evidence(r, source_ids) -> list[dict]:
        if r is None:
            return []
        out = [{"label": f"{s.publisher}: {s.title}", "url": str(s.url) if s.url else None, "text": s.summary}
               for s in r.sources if s.source_id in source_ids]
        out += [{"label": f"Tutarsızlık {d.discrepancy_id}: {d.topic}", "url": None, "text": d.description} for d in r.discrepancies]
        return out

    # --- Liste -----------------------------------------------------------------------

    def listing(self, reviewer: Optional[Reviewer]) -> dict:
        s = self.service
        latest = s.store.latest_all()
        roles = set(reviewer.roles) if reviewer else set()
        cands = self._candidates()
        keys = {_key(x["decision_type"], x["subject_id"]) for x in cands}
        groups: dict[str, list] = {st: [] for st in STAGES}
        for x in cands:
            dt, sid = x["decision_type"], x["subject_id"]
            spec = SPECS[dt]
            eff = s.effective(spec.subject_kind, sid, dt, latest)
            parsed = None
            if spec.payload_model is not None:
                try:
                    parsed = spec.payload_model(**x["payload"])
                except Exception:  # noqa: BLE001 — öneri bozuksa satır engelli görünür
                    parsed = None
            unmet = s.unmet_prerequisites(dt, sid, parsed, latest)
            depends = []
            for code in unmet:
                target = self._prerequisite_key(dt, sid, code)
                if target in keys:
                    depends.append(target)
            if x.get("revision"):
                # Düzeltme, yanıtladığı "düzeltme gerekli" kararı hâlâ olgunun en son doğruluk kararıysa güncel sayılır.
                last = latest.get(("fact", sid, "fact_editorial"))
                x = {**x, "revision": {**x["revision"], "open": last is not None
                                       and last.decision_id == x["revision"]["addresses_decision_id"]}}
            groups[dt].append({
                **{k: v for k, v in x.items() if k != "v20_text"},
                "key": _key(dt, sid), "role": spec.role, "label": spec.label,
                "status": eff.status, "stale": eff.stale,
                "done": eff.approved,
                "allowed": spec.role in roles,
                "unmet_prerequisites": unmet,
                "blockers": [{"code": u, "text": blocker_text(u), "resolved_in_batch": self._prerequisite_key(dt, sid, u) in keys}
                             for u in unmet],
                "depends_on": depends,
                "source_check_required": spec.source_check_required,
                "payload_kind": spec.payload_model.__name__ if spec.payload_model else None,
            })
        return {
            "stages": [{"decision_type": st, "label": STAGE_LABELS[st], "role": SPECS[st].role,
                        "items": groups[st],
                        "counts": {"total": len(groups[st]), "done": sum(i["done"] for i in groups[st])}}
                       for st in STAGES],
            "reviewer_roles": sorted(roles),
            "max_items": BATCH_MAX_ITEMS,
            "seconds_per_item": BATCH_SECONDS_PER_ITEM,
            "excluded": ["gps_checkin (saha doğrulaması gerekir)", "source_usage_rights (hukuki izin belgesi gerekir)"],
        }

    def _prerequisite_key(self, decision_type: str, subject_id: str, code: str) -> Optional[str]:
        c = self.service.catalog
        if code.startswith("issue_unresolved:"):
            return _key("issue_resolution", code.split(":", 1)[1])
        if code == "fact_editorial":
            return _key("fact_editorial", subject_id)
        if code == "fact_publication":
            return _key("fact_publication", subject_id)
        if code == "catalog_identity":
            if decision_type.startswith("fact_"):
                return _key("catalog_identity", c.facts[subject_id].monument_id)
            if decision_type.startswith("image_"):
                img = next((i for i in self.service.images.images if i.image_id == subject_id), None)
                return _key("catalog_identity", img.monument_id) if img else None
            return _key("catalog_identity", subject_id)
        if code == "image_rights":
            return _key("image_rights", subject_id)
        if code == "image_publication":
            return _key("image_publication", subject_id)
        if code == "location_verification":
            return _key("location_verification", subject_id)
        return None

    # --- Bilet ve kayıt ----------------------------------------------------------------

    def open_ticket(self, session_id: str, reviewer: Reviewer, keys: list[str]) -> dict:
        s = self.service
        keys = list(dict.fromkeys(keys))
        if not keys:
            raise DecisionError("empty_batch", "En az bir kayıt seçin.", 422)
        if len(keys) > BATCH_MAX_ITEMS:
            raise DecisionError("batch_too_large", f"Tek seferde en fazla {BATCH_MAX_ITEMS} kayıt seçilebilir.", 422)
        items = {}
        for k in keys:
            dt, _, sid = k.partition("|")
            spec = SPECS.get(dt)
            if spec is None or dt not in STAGES:
                raise DecisionError("invalid_decision_type", f"Toplu incelemede desteklenmeyen karar: {dt}.", 422)
            if spec.role not in reviewer.roles:
                raise DecisionError("role_required", f"'{k}' için '{spec.role}' rolü gerekir.", 403)
            sha = s.subject_sha256(spec.subject_kind, sid)
            current = s.store.latest(spec.subject_kind, sid, dt)
            items[k] = (sha, current.decision_id if current else None)
        min_seconds = min(BATCH_MAX_MIN_SECONDS, max(s.min_review_seconds, BATCH_SECONDS_PER_ITEM * len(keys)))
        now = s.monotonic()
        with self._lock:
            self._tickets = {t: v for t, v in self._tickets.items() if now - v.issued_at < TICKET_TTL_S}
            ticket = _BatchTicket(secrets.token_urlsafe(16), session_id, reviewer.reviewer_id, items, now, min_seconds)
            self._tickets[ticket.ticket_id] = ticket
        return {"ticket_id": ticket.ticket_id, "keys": keys, "min_review_seconds": min_seconds, "expires_in_s": TICKET_TTL_S}

    def submit(self, session_id: str, reviewer: Reviewer, *, ticket_id: str, rationale: str, items: list[dict]) -> dict:
        s = self.service
        now = s.monotonic()
        with self._lock:
            ticket = self._tickets.pop(ticket_id, None)  # Bilet tek kullanımlıktır.
        if ticket is None or ticket.session_id != session_id or ticket.reviewer_id != reviewer.reviewer_id:
            raise DecisionError("invalid_ticket", "Toplu inceleme bileti geçersiz veya başka bir oturuma ait.", 409)
        if now - ticket.issued_at > TICKET_TTL_S:
            raise DecisionError("ticket_expired", "Toplu inceleme biletinin süresi doldu; seçimi yeniden açın.", 409)
        if len(rationale.strip()) < MIN_RATIONALE_CHARS:
            raise DecisionError("rationale_required", f"Toplu karar gerekçesi en az {MIN_RATIONALE_CHARS} karakter olmalı.", 422)
        by_key = {}
        for it in items:
            k = it.get("key")
            if k not in ticket.items or k in by_key:
                raise DecisionError("item_not_in_ticket", f"'{k}' bu bilette yok veya yinelendi.", 422)
            if it.get("decision") not in ("approved", "rejected", "needs_revision"):
                raise DecisionError("invalid_decision", f"'{k}' için geçersiz karar.", 422)
            by_key[k] = it
        if any(it["decision"] == "approved" for it in by_key.values()) and now - ticket.issued_at < ticket.min_seconds:
            raise DecisionError("review_too_fast",
                                f"Seçili {len(ticket.items)} kaydı incelemek için en az {ticket.min_seconds:g} sn gerekir.", 429)
        since = (s.store._clock() - timedelta(hours=1)).isoformat(timespec="seconds")
        if s.store.count_by_reviewer_since(reviewer.reviewer_id, since) + len(by_key) > BATCH_HOURLY_LIMIT:
            raise DecisionError("rate_limited", f"Bir saatte en fazla {BATCH_HOURLY_LIMIT} karar kaydedilebilir.", 429)

        ordered = sorted(by_key.values(), key=lambda it: (STAGES.index(it["key"].partition("|")[0]), it["key"]))
        results = []
        for it in ordered:
            dt, _, sid = it["key"].partition("|")
            spec = SPECS[dt]
            sha, supersedes = ticket.items[it["key"]]
            decision = it["decision"]
            source_check = it.get("source_check") or ("verified_on_page" if decision == "approved" and spec.source_check_required
                                                      else "not_applicable")
            if decision != "approved" and source_check in VERIFIED_SOURCE_CHECKS and not spec.source_check_required:
                source_check = "not_applicable"
            note = (it.get("note") or "").strip()
            text = rationale.strip() + (f" — {note}" if note else "") + " [toplu inceleme]"
            try:
                rec = s.record_checked(
                    reviewer, kind=spec.subject_kind, subject_id=sid, decision_type=dt, decision=decision,
                    source_check=source_check, rationale=text,
                    # Ret ve düzeltme kararlarında onaya özgü ayrıntı gönderilmez.
                    payload=(it.get("payload") or {}) if decision == "approved" else {},
                    subject_sha256=sha, supersedes=supersedes, review_seconds=now - ticket.issued_at, rate_limited=False,
                )
                results.append({"key": it["key"], "ok": True, "decision_id": rec.decision_id, "decision": decision})
            except DecisionError as e:
                results.append({"key": it["key"], "ok": False, "code": e.code, "message": str(e)})
        s.store.log(reviewer.reviewer_id, "batch_review_submitted", f"batch:{ticket.ticket_id[:8]}", {
            "items": len(results), "recorded": sum(r["ok"] for r in results),
            "failed": [r["key"] for r in results if not r["ok"]],
        })
        return {"results": results, "recorded": sum(r["ok"] for r in results), "failed": sum(not r["ok"] for r in results)}
