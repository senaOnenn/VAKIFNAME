import os
import tempfile
from pathlib import Path

# `app.main` içe aktarılırken modül düzeyinde `create_app()` çalışır; fikstürlerden önce de gerçek kota sayacı, OpenRouter
# anahtarı veya yüz modelleri açılmasın diye güvenli yollar burada, içe aktarmadan önce verilir.
_SAFE = Path(tempfile.mkdtemp(prefix="vakifname-test-env-"))
os.environ["VAKIFNAME_GUIDE_BUDGET_DB"] = str(_SAFE / "guide-budget.sqlite3")
os.environ["VAKIFNAME_OPENROUTER_KEY_FILE"] = str(_SAFE / "anahtar-yok")
os.environ["VAKIFNAME_GUIDE_FACE_MODEL_DIR"] = str(_SAFE / "yuz-modeli-yok")
os.environ["VAKIFNAME_GUIDE_MODE"] = "off"
os.environ["VAKIFNAME_GUIDE_LEXICON"] = "off"  # zeyrek sözlüğü testlerde yalnızca açıkça istendiğinde yüklenir

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import DEFAULT_CORS_ORIGINS, create_app  # noqa: E402

TEST_PLACES_FILE = Path(__file__).parent / "data" / "places.json"


@pytest.fixture(scope="session")
def turkish_lexicon():
    """Canlıdaki Türkçe sözlük (zeyrek), oturumda bir kez yüklenir. Kurulu değilse veya yüklenemezse None: yazım düzeltmesi
    yalnızca katalog sözlüğüyle çalışır."""
    from app.guide.lexicon import TurkishLexicon
    lex = TurkishLexicon(background=False)
    return lex if lex.state == "ready" else None


@pytest.fixture
def client():
    # Her test için yeni uygulama: bellek içi ilerleme testler arasında paylaşılmaz.
    with TestClient(create_app(TEST_PLACES_FILE, cors_origins=DEFAULT_CORS_ORIGINS, demo_api=True)) as c:
        yield c


def _real_review_db_fingerprint():
    # Gerçek inceleme veritabanı (ve WAL dosyaları) yalnızca okunur; testler ona asla yazmamalıdır.
    from app.internal import config

    db = config.data_dir_from_env() / config.REVIEW_DB_FILE
    out = {}
    for p in (db, db.with_name(db.name + "-wal"), db.with_name(db.name + "-shm")):
        try:
            st = p.stat()
        except (FileNotFoundError, PermissionError):
            continue
        out[p.name] = (st.st_size, st.st_mtime_ns)
    return out


@pytest.fixture(autouse=True, scope="session")
def real_review_db_untouched():
    """Test oturumu gerçek inceleme veritabanını değiştirirse oturum hata verir. Her test kendi geçici DB'sini kullanır."""
    before = _real_review_db_fingerprint()
    yield
    assert _real_review_db_fingerprint() == before, "Testler gerçek inceleme veritabanına dokundu."


def temp_review_db() -> Path:
    """Gerçek V20 diziniyle çalışan testler için yeni, boş inceleme veritabanı yolu (gerçek DB asla açılmaz)."""
    return Path(tempfile.mkdtemp(prefix="vakifname-review-test-")) / "review.sqlite3"


@pytest.fixture(autouse=True)
def no_real_llm_provider(monkeypatch, tmp_path):
    """Testler gerçek OpenRouter anahtarını asla okumaz ve rehber varsayılan olarak kapalıdır (gerçek API çağrısı yapılmaz)."""
    monkeypatch.setenv("VAKIFNAME_OPENROUTER_KEY_FILE", str(tmp_path / "anahtar-yok"))
    monkeypatch.delenv("CREDENTIALS_DIRECTORY", raising=False)
    monkeypatch.setenv("VAKIFNAME_GUIDE_MODE", "off")
    monkeypatch.setenv("VAKIFNAME_GUIDE_BUDGET_DB", str(tmp_path / "guide-budget.sqlite3"))  # gerçek sayaç dosyası açılmaz
    monkeypatch.setenv("VAKIFNAME_GUIDE_TESTER_KEY_FILE", str(tmp_path / "test-anahtari-yok"))
    monkeypatch.setenv("VAKIFNAME_GUIDE_FACE_MODEL_DIR", str(tmp_path / "yuz-modeli-yok"))
