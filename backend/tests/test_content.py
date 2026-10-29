"""İçerik yönetimi (şartname 5.1.1, CLAUDE.md §2.13): yalnızca doğrulanmış yönetici; kaynak PDF → sayfa metni; elle kayıt
ve hat adayı taslak olarak girer, onaysız hiçbir genel uçta (eser, rota, rehber) görünmez; kaynak izni ve alıntı kuralı
yayında denetlenir; her onay yalnızca eklenen karar kaydıdır; yayın katmanı yeniden başlatmadan genel kataloğa düşer."""

import json
import sqlite3
import time
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.content import pdftext
from app.guide.provider import ChatResult, ProviderError
from app.main import create_app

SNAPSHOT = Path(__file__).parent / "ask_eval" / "catalog_snapshot.json"
PASSWORD = "gizli-parola-1"
ADMIN = "yonetici@example.com"
PAGES = [
    "Kapak sayfasi. Vakif eserleri envanteri.",
    "Ulu Cami Yildirim Bayezid tarafindan 1399 yilinda tamamlanmistir ve yirmi kubbesi vardir.\n"
    "Rivayete gore cami icindeki sadirvan sonradan eklenmistir.",
    "Koza Han 1491 yilinda II. Bayezid tarafindan ipek ticareti icin yaptirilmistir.",
]


def make_pdf(pages: list[str]) -> bytes:
    """Metin katmanlı küçük bir PDF (Helvetica, WinAnsi). Yalnızca testler için."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    kids = []
    for text in pages:
        lines = []
        for line in text.split("\n"):
            esc = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            lines.append(f"({esc}) Tj T*")
        stream = "BT /F1 10 Tf 12 TL 40 760 Td " + " ".join(lines) + " ET"
        data = stream.encode("cp1252")
        objs.append(f"<< /Length {len(data)} >>\nstream\n" + data.decode("cp1252") + "\nendstream")
        content_ref = len(objs)
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
                    f"/Contents {content_ref} 0 R >>")
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n{body}\nendobj\n".encode("cp1252"))
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def make_png(color=(180, 140, 60)) -> bytes:
    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "PNG")
    return buf.getvalue()


class FakeProvider:
    name = "fake"

    def __init__(self, text: str = "", error: str = "", ok: bool = True):
        self.text, self.error, self.ok, self.calls = text, error, ok, []

    def available(self):
        return (True, "ok") if self.ok else (False, "not_logged_in")

    def models(self):
        return []

    def chat(self, model, messages, max_tokens, temperature=0.2, json_mode=False, timeout_s=60.0):
        self.calls.append({"model": model, "messages": messages, "json_mode": json_mode})
        if self.error:
            raise ProviderError(self.error)
        return ChatResult(text=self.text, model=model, prompt_tokens=1, completion_tokens=1, latency_ms=1)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    for name in ("VAKIFNAME_PROGRESS_DB", "VAKIFNAME_ACCOUNTS_DB", "VAKIFNAME_CONTENT_DIR", "VAKIFNAME_CONTENT_MODEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("VAKIFNAME_ADMIN_EMAILS", ADMIN)


@pytest.fixture
def c(tmp_path):
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, content_dir=tmp_path / "content")) as client:
        client.app.state.content_pipeline._pool = None  # hat işleri testte eşzamanlı çalışır
        yield client


def login_admin(c):
    r = c.post("/auth/register", json={"email": ADMIN, "password": PASSWORD})
    c.app.state.accounts.mark_email_verified(r.json()["user_id"])
    return r.json()["user_id"]


def upload(c, data: bytes, ctype: str) -> str:
    r = c.post("/admin/content/uploads", content=data, headers={"Content-Type": ctype})
    assert r.status_code == 201, r.text
    return r.json()["upload_id"]


def add_source(c, rights: bool = True, pages=PAGES, title="Test Envanteri, Cilt I") -> str:
    r = c.post("/admin/content/sources", json={"upload_id": upload(c, make_pdf(pages), "application/pdf"),
                                               "title": title, "rights_confirmed": rights})
    assert r.status_code == 201, r.text
    return r.json()["source_id"]


def fact_body(source_id: str, **over) -> dict:
    return {"monument_id": "BUR-0001", "title": "Tamamlanma yılı", "text": "Ulu Cami 1399 yılında tamamlanmıştır.",
            "category": "construction", "certainty": "documented", "source_id": source_id, "page": 2,
            "quote": "Yildirim Bayezid tarafindan 1399 yilinda tamamlanmistir", "game_use": False, "quest": None,
            "publish": False, **over}


def public_fact_ids(c, mid="BUR-0001") -> set[str]:
    r = c.get(f"/monuments/{mid}")
    return {f["fact_id"] for f in r.json()["facts"]} if r.status_code == 200 else set()


# --- Kapalı depo ve yetki -----------------------------------------------------------------------------------------


def test_disabled_store_is_honest(tmp_path):
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False)) as c:
        login_admin(c)
        assert c.get("/admin/content/overview").json()["enabled"] is False
        assert c.post("/admin/content/sources", json={"upload_id": "UPL-" + "0" * 16, "title": "x",
                                                      "rights_confirmed": True}).status_code == 503


def test_only_verified_admins(c):
    assert c.get("/admin/content/overview").status_code == 401
    c.post("/auth/register", json={"email": "uye@example.com", "password": PASSWORD})
    assert c.get("/admin/content/overview").status_code == 403
    c.post("/auth/logout")
    c.post("/auth/register", json={"email": ADMIN, "password": PASSWORD})
    assert c.get("/admin/content/overview").status_code == 403  # e-posta doğrulanmadı
    assert c.post("/admin/content/uploads", content=b"%PDF-1.4", headers={"Content-Type": "application/pdf"}).status_code == 403


# --- Kaynaklar ----------------------------------------------------------------------------------------------------


def test_source_upload_pages_and_search(c):
    login_admin(c)
    sid = add_source(c)
    ov = c.get("/admin/content/overview").json()
    assert ov["enabled"] and ov["sources"][0] == {**ov["sources"][0], "source_id": sid, "page_count": 3,
                                                   "rights_confirmed": True, "uploaded_by": ADMIN}
    assert "Koza Han" in c.get(f"/admin/content/sources/{sid}/pages/3").json()["text"]
    assert c.get(f"/admin/content/sources/{sid}/pages/4").status_code == 404
    hits = c.get(f"/admin/content/sources/{sid}/search", params={"q": "koza han"}).json()["hits"]
    assert [h["page"] for h in hits] == [3]
    # Aynı PDF iki kez eklenemez; metinsiz PDF reddedilir.
    dup = c.post("/admin/content/sources", json={"upload_id": upload(c, make_pdf(PAGES), "application/pdf"),
                                                 "title": "Kopya", "rights_confirmed": True})
    assert dup.status_code == 409
    blank = c.post("/admin/content/sources", json={"upload_id": upload(c, make_pdf([""]), "application/pdf"),
                                                   "title": "Boş", "rights_confirmed": True})
    assert blank.status_code == 400 and "metin katmanı" in blank.json()["detail"]


def test_upload_type_and_content_checks(c):
    login_admin(c)
    assert c.post("/admin/content/uploads", content=b"hello", headers={"Content-Type": "text/plain"}).status_code == 415
    assert c.post("/admin/content/uploads", content=b"not a pdf", headers={"Content-Type": "application/pdf"}).status_code == 415
    assert c.post("/admin/content/uploads", content=make_png(), headers={"Content-Type": "image/jpeg"}).status_code == 415


def test_quote_matching_ignores_line_breaks_and_hyphenation():
    pages = ["Bursa Ulucami’nin, manevi ulviyet açısından önemli ibadethaneler ara -\nsında sayılması dikkate değerdir."]
    assert pdftext.quote_page(pages, 1, "önemli ibadethaneler arasında sayılması") == 1
    assert pdftext.quote_page(pages, 1, "önemli camiler arasında") is None
    assert pdftext.quote_page(["", pages[0]], 1, "dikkate değerdir") == 2  # bitişik sayfa


# --- Elle kayıt: taslak → onay → yayın ------------------------------------------------------------------------------


def test_manual_fact_on_catalog_monument_publishes_through_overlay(c):
    login_admin(c)
    sid = add_source(c)
    before = c.app.state.ask.status()["facts_indexed"]
    r = c.post("/admin/content/facts", json=fact_body(sid))
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["fact_id"] == "BUR-0001-F501" and f["status"] == "draft" and f["origin"] == "manual"
    assert f["quote_check"] == "found" and f["decision"] is None
    assert "BUR-0001-F501" not in public_fact_ids(c)  # taslak görünmez
    assert c.get("/admin/content/overview").json()["drafts"] == 1

    pub = c.post("/admin/content/facts/BUR-0001-F501/publish").json()
    assert pub["status"] == "published" and pub["decision"]["by"] == ADMIN
    assert pub["decision"]["decision_id"].startswith("DEC-")
    detail = c.get("/monuments/BUR-0001").json()
    new = next(x for x in detail["facts"] if x["fact_id"] == "BUR-0001-F501")
    assert new["text"] == "Ulu Cami 1399 yılında tamamlanmıştır." and new["source"]["pdf_physical_page"] == 2
    assert new["source"]["title"] == "Test Envanteri, Cilt I"
    # Rehberin kaynağı (arama motoru) yeniden başlatmadan yeni kaydı görür.
    assert c.app.state.ask.status()["facts_indexed"] == before + 1


def test_publish_requires_source_rights_and_quote_on_page(c):
    login_admin(c)
    no_rights = add_source(c, rights=False)
    r = c.post("/admin/content/facts", json=fact_body(no_rights, publish=True))
    assert r.status_code == 409 and "kullanım izni" in r.json()["detail"]
    sid = add_source(c, pages=PAGES + ["Ek sayfa."], title="İzinli kaynak")
    bad = c.post("/admin/content/facts", json=fact_body(sid, quote="Bu cümle kitapta yoktur ve uydurmadır", publish=True))
    assert bad.status_code == 409 and "bulunamadı" in bad.json()["detail"]
    # Taslak olarak kaydedilebilir; yönetici düzeltene kadar yayımlanamaz.
    draft = c.post("/admin/content/facts", json=fact_body(sid, quote="Bu cümle kitapta yoktur ve uydurmadır")).json()
    assert draft["quote_check"] == "not_found"
    assert c.post(f"/admin/content/facts/{draft['fact_id']}/publish").status_code == 409
    # Alıntısız elle kayıt (kaynak + sayfa ile) yayımlanabilir.
    ok = c.post("/admin/content/facts", json=fact_body(sid, quote="", publish=True))
    assert ok.status_code == 201 and ok.json()["quote_check"] == "no_quote"


def test_editing_a_published_fact_without_publish_withdraws_it(c):
    login_admin(c)
    sid = add_source(c)
    fid = c.post("/admin/content/facts", json=fact_body(sid, publish=True)).json()["fact_id"]
    assert fid in public_fact_ids(c)
    body = {k: v for k, v in fact_body(sid, title="Düzeltilmiş başlık").items() if k != "monument_id"}
    edited = c.put(f"/admin/content/facts/{fid}", json=body).json()
    assert edited["status"] == "draft" and fid not in public_fact_ids(c)
    again = c.put(f"/admin/content/facts/{fid}", json={**body, "publish": True}).json()
    assert again["status"] == "published"
    assert next(f for f in c.get("/monuments/BUR-0001").json()["facts"] if f["fact_id"] == fid)["title"] == "Düzeltilmiş başlık"
    w = c.post(f"/admin/content/facts/{fid}/withdraw").json()
    assert w["status"] == "withdrawn" and fid not in public_fact_ids(c)
    assert c.post(f"/admin/content/facts/{fid}/withdraw").status_code == 409


def test_reject_and_decisions_are_append_only(c, tmp_path):
    login_admin(c)
    sid = add_source(c)
    fid = c.post("/admin/content/facts", json=fact_body(sid)).json()["fact_id"]
    assert c.post(f"/admin/content/facts/{fid}/reject").json()["status"] == "rejected"
    db = sqlite3.connect(tmp_path / "content" / "content.sqlite3")
    rows = db.execute("SELECT action, actor FROM decisions WHERE subject_id=?", (fid,)).fetchall()
    assert rows == [("reject", ADMIN)]
    with pytest.raises(sqlite3.DatabaseError):
        db.execute("UPDATE decisions SET actor='baskasi'")
    with pytest.raises(sqlite3.DatabaseError):
        db.execute("DELETE FROM decisions")


def test_quest_is_validated_and_published_for_the_game(c):
    login_admin(c)
    sid = add_source(c)
    quest = {"question": "Ulu Cami hangi yıl tamamlandı?", "choices": ["1399", "1491", "1550"], "answer_index": 0,
             "explanation": "Kaynağa göre 1399'da tamamlandı."}
    assert c.post("/admin/content/facts", json=fact_body(sid, quest=quest)).status_code == 400  # oyunda değil
    assert c.post("/admin/content/facts", json=fact_body(sid, game_use=True,
                                                         quest={**quest, "choices": ["1399", "1399"]})).status_code == 400
    f = c.post("/admin/content/facts", json=fact_body(sid, game_use=True, quest=quest, publish=True)).json()
    pub = next(x for x in c.get("/monuments/BUR-0001").json()["facts"] if x["fact_id"] == f["fact_id"])
    assert pub["game_use"] is True


# --- Yeni eser --------------------------------------------------------------------------------------------------


MONUMENT = {"name": "Test Çeşmesi", "alternative_names": ["Test Sebili"], "type": "çeşme", "city": "Bursa",
            "district": "Osmangazi", "address": "Test Sokak 1", "latitude": 40.1901, "longitude": 29.0601,
            "site_notice": "Çeşmenin taşlarına basmayın.", "publish": False}


def test_new_monument_draft_publish_route_and_withdraw(c):
    login_admin(c)
    user = "ziyaretci-00000000-0000-4000-8000-000000000001"
    m = c.post("/admin/content/monuments", json=MONUMENT).json()
    assert m["monument_id"] == "BUR-5001" and m["status"] == "draft" and m["origin"] == "content"
    assert c.get("/monuments/BUR-5001").status_code == 404
    sid = add_source(c)
    c.post("/admin/content/facts", json=fact_body(sid, monument_id="BUR-5001", publish=True))
    assert c.get("/monuments/BUR-5001").status_code == 404  # eser taslakken kaydı da görünmez

    pub = c.put("/admin/content/monuments/BUR-5001", json={**MONUMENT, "publish": True}).json()
    assert pub["status"] == "published" and pub["decision"]["by"] == ADMIN
    detail = c.get("/monuments/BUR-5001").json()
    assert detail["name"] == "Test Çeşmesi" and [f["fact_id"] for f in detail["facts"]] == ["BUR-5001-F001"]
    assert detail["site_notice"] == "Çeşmenin taşlarına basmayın."
    route = c.get("/route", params={"city": "bursa", "user_id": user}).json()
    assert route["total"] == 11 and "BUR-5001" in {s["monument_id"] for s in route["stops"]}

    c.post("/admin/content/monuments/BUR-5001/withdraw")
    assert c.get("/monuments/BUR-5001").status_code == 404
    assert c.post("/admin/content/monuments", json=MONUMENT).json()["monument_id"] == "BUR-5002"


def test_monument_rules(c):
    login_admin(c)
    assert c.put("/admin/content/monuments/BUR-0001", json=MONUMENT).status_code == 409  # katalog eseri salt okunur
    assert c.post("/admin/content/monuments", json={**MONUMENT, "latitude": None}).status_code == 400
    assert c.post("/admin/content/monuments", json={**MONUMENT, "latitude": 0, "longitude": 0}).status_code == 400
    assert c.post("/admin/content/monuments", json={**MONUMENT, "city": "Paris"}).status_code == 400
    assert c.post("/admin/content/monuments", json={**MONUMENT, "type": "gökdelen"}).status_code == 400
    kut = c.post("/admin/content/monuments", json={**MONUMENT, "city": "Kütahya", "latitude": None, "longitude": None,
                                                   "publish": True}).json()
    assert kut["monument_id"] == "KUT-5001"
    assert c.get("/monuments/KUT-5001").json()["location"] is None  # konumsuz: haritada ve rotada yok
    assert c.put("/admin/content/monuments/KUT-5001", json={**MONUMENT, "publish": True}).status_code == 400  # şehir değişmez


# --- Görseller --------------------------------------------------------------------------------------------------


def test_image_upload_reencodes_and_publishes(c):
    login_admin(c)
    meta = {"rights_holder": "Ali Veli", "license": "CC-BY-SA-4.0", "attribution": None, "title": "Avlu",
            "source_url": None, "publish": False}
    assert c.post("/admin/content/monuments/BUR-0001/images",
                  json={**meta, "upload_id": upload(c, make_png(), "image/png")}).status_code == 400  # CC BY atıfsız
    img = c.post("/admin/content/monuments/BUR-0001/images",
                 json={**meta, "attribution": "Fotoğraf: Ali Veli, CC BY-SA 4.0",
                       "upload_id": upload(c, make_png(), "image/png")}).json()
    assert img["status"] == "draft" and img["file"].endswith(".jpg")
    assert c.get(img["url"]).status_code == 200  # yönetici önizlemesi
    assert c.get(f"/monuments/media/{img['file']}").status_code == 404  # taslak genelde yok
    c.post(f"/admin/content/images/{img['image_id']}/publish")
    assert c.get(f"/monuments/media/{img['file']}").status_code == 200
    files = [i["file"] for i in c.get("/monuments/BUR-0001").json()["images"]]
    assert img["file"] in files
    c.post("/auth/logout")
    assert c.get(img["url"]).status_code == 401


# --- Hat --------------------------------------------------------------------------------------------------------


def candidates_json(*items) -> str:
    return "```json\n" + json.dumps({"facts": list(items)}, ensure_ascii=False) + "\n```"


GOOD = {"title": "Şadırvan", "text": "Rivayete göre şadırvan sonradan eklenmiştir.", "page": 2,
        "quote": "Rivayete gore cami icindeki sadirvan sonradan eklenmistir", "category": "architecture",
        "certainty": "reported"}


def test_pipeline_keeps_only_candidates_quoted_from_the_book(c):
    login_admin(c)
    sid = add_source(c)
    fake = FakeProvider(candidates_json(
        GOOD,
        {**GOOD, "title": "Uydurma", "text": "Caminin altın kubbesi vardır.", "quote": "caminin altin kubbesi vardir ve parlar"},
        {**GOOD, "title": "Tekrar"},  # aynı alıntı: tekrar önerilmez
        {**GOOD, "title": "Komşu", "text": "Koza Han 1491'de yapıldı.", "page": 2,
         "quote": "Koza Han 1491 yilinda II. Bayezid tarafindan"},  # alıntı bitişik sayfada: sayfa düzeltilir
        {**GOOD, "title": "Kısa", "text": "Kısa alıntı.", "quote": "yirmi kubbesi"},  # alıntı çok kısa
    ))
    c.app.state.content_pipeline.provider = fake
    r = c.post("/admin/content/extract", json={"source_id": sid, "monument_id": "BUR-0001", "page_from": 1, "page_to": 2})
    assert r.status_code == 202, r.text
    job = c.get(f"/admin/content/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "done" and job["candidates"] == 2 and job["dropped"] == 3
    drafts = c.get("/admin/content/facts", params={"status": "draft", "monument_id": "BUR-0001"}).json()["facts"]
    assert {d["title"]: d["page"] for d in drafts} == {"Şadırvan": 2, "Komşu": 3}
    assert all(d["origin"] == "pipeline" and d["quote_check"] == "found" for d in drafts)
    assert not {d["fact_id"] for d in drafts} & public_fact_ids(c)
    user_msg = fake.calls[0]["messages"][1]["content"]
    assert "=== Sayfa 1 ===" in user_msg and "=== Sayfa 2 ===" in user_msg and "Sayfa 3" not in user_msg
    # Hattan gelen kayıt, alıntısı kaynakta bulunmadan yayımlanamaz.
    d = next(x for x in drafts if x["title"] == "Şadırvan")
    body = {k: d[k] for k in ("title", "text", "category", "certainty", "source_id", "page", "game_use", "quest")}
    assert c.put(f"/admin/content/facts/{d['fact_id']}", json={**body, "quote": "", "publish": True}).status_code == 409
    assert c.post(f"/admin/content/facts/{d['fact_id']}/publish").json()["status"] == "published"


def test_pipeline_failures_and_limits(c):
    login_admin(c)
    sid = add_source(c)
    pipe = c.app.state.content_pipeline
    body = {"source_id": sid, "monument_id": "BUR-0001", "page_from": 1, "page_to": 2}
    pipe.provider = FakeProvider(ok=False)
    r = c.post("/admin/content/extract", json=body)
    assert r.status_code == 503 and "kullanılamıyor" in r.json()["detail"]
    pipe.provider = FakeProvider(error="quota")
    job = c.post("/admin/content/extract", json=body).json()
    assert job["status"] == "failed" and "quota" in job["error"]
    pipe.provider = FakeProvider("bu JSON değil")
    assert c.post("/admin/content/extract", json=body).json()["status"] == "failed"
    assert c.post("/admin/content/extract", json={**body, "page_to": 9}).status_code == 422  # en fazla 6 sayfa
    assert c.post("/admin/content/extract", json={**body, "page_from": 2, "page_to": 1}).status_code == 422
    assert c.post("/admin/content/extract", json={**body, "page_to": 4}).status_code == 400  # kaynakta 3 sayfa var
    assert c.post("/admin/content/extract", json={**body, "monument_id": "BUR-9999"}).status_code == 404


def test_restart_keeps_content_and_fails_interrupted_jobs(tmp_path):
    root = tmp_path / "content"
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, content_dir=root)) as c:
        login_admin(c)
        sid = add_source(c)
        c.post("/admin/content/facts", json=fact_body(sid, publish=True))
        job = c.app.state.content.create_job(sid, "BUR-0001", 1, 2, ADMIN)  # kuyrukta kalmış iş
    with TestClient(create_app(public_catalog_file=SNAPSHOT, demo_api=False, content_dir=root)) as c:
        assert "BUR-0001-F501" in public_fact_ids(c)
        assert c.app.state.content.job(job["job_id"])["status"] == "failed"


def test_invalid_overlay_keeps_last_good_catalog(c, tmp_path):
    login_admin(c)
    sid = add_source(c)
    c.post("/admin/content/facts", json=fact_body(sid, publish=True))
    assert "BUR-0001-F501" in public_fact_ids(c)
    overlay = tmp_path / "content" / "published.json"
    time.sleep(0.01)
    overlay.write_text(json.dumps({"schema": "vakifname.content_overlay/1", "monuments": [], "images": [],
                                   "facts": [{"monument_id": "BUR-0001", "fact": {"fact_id": "BUR-0001-F001"}}]}))
    assert "BUR-0001-F501" in public_fact_ids(c)  # bozuk katman reddedildi, son geçerli katalog sunuluyor


def test_validation_errors_are_turkish_and_catalog_counts_include_published_facts(c):
    login_admin(c)
    sid = add_source(c)
    r = c.post("/admin/content/facts", json=fact_body(sid, title="ab", text="kısa"))
    msgs = [e["msg"] for e in r.json()["detail"]]
    assert r.status_code == 422 and "Başlık en az 3 karakter olmalı." in msgs and "Metin en az 10 karakter olmalı." in msgs
    r = c.post("/admin/content/extract", json={"source_id": sid, "monument_id": "BUR-0001", "page_from": 1, "page_to": 9})
    assert r.json()["detail"][0]["msg"].startswith("Sayfa aralığı en fazla 6 sayfa")
    row = next(m for m in c.get("/admin/content/overview").json()["monuments"] if m["monument_id"] == "BUR-0001")
    assert row["facts"]["published"] == len(c.get("/monuments/BUR-0001").json()["facts"]) > 0
