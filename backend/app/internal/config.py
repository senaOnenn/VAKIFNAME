import os
import stat
from pathlib import Path
from typing import Optional

DEFAULT_DATA_DIR = Path("/var/lib/vakifname-internal")

# Korumalı veri dizininin beklenen yerleşimi (bkz. README, "Dahili V20 veri katmanı").
V20_DIR = "v20"
KNOWLEDGE_BASE_FILE = "vakifname_knowledge_base_v20_dev.json"
FREEZE_MANIFEST_FILE = "vakifname_v20_freeze_manifest_v1_dev.json"
RAG_RUNTIME_DIR = "rag/runtime"
MANIFESTS_DIR = "manifests"
SOURCE_REGISTRY_FILE = "source_registry.json"
SOURCE_PAGE_AUDIT_FILE = "source_page_audit.json"
IMAGE_MANIFEST_FILE = "image_manifest.json"
IMAGES_DIR = "images/monuments"
SOURCES_DIR = "sources"
# Kalıcı inceleme veritabanı (kararlar, incelemeci hesapları, denetim günlüğü).
REVIEW_DB_FILE = "review/review.sqlite3"

# Wikimedia Commons'tan alınan, lisansı açık görseller (dosyalar veri dizininde, meta veri repository'de).
COMMONS_IMAGES_DIR = "images/commons"
# Görsel tanıma için ayrılmış test fotoğrafları (dondurulmuş sürüm). Bu kimlikler inceleme envanterine alınmaz ve
# referans indeksi kararı verilemez.
# Hackathon ZIP arşivinin görüntüleme kopyaları (sRGB, özgün boyut) ve ek katmanı. Özgünler karantinada kalır.
HACKATHON_ZIP_DISPLAY_DIR = "images/hackathon_zip_display"
HOLDOUT_TEST_SET_FILE = "visual_index/test_sets/commons_holdout_v1/manifest.json"

_REAL_CATALOG = Path(__file__).resolve().parents[3] / "data" / "real_catalog"
# Kaynak/konum araştırması repository'de tutulur; yalnızca kamuya açık kaynaklardan derlenmiş bulgular içerir.
DEFAULT_RESEARCH_FILE = _REAL_CATALOG / "monument_research.json"
# Olguların bağımsız kaynaklarla karşılaştırılması ve özgün yayın metni önerileri (onay içermez).
DEFAULT_CORROBORATION_FILE = _REAL_CATALOG / "fact_corroboration.json"
# Kimlik ve konum kararları için hazırlanmış form önerileri (onay içermez).
DEFAULT_PROPOSALS_FILE = _REAL_CATALOG / "review_proposals.json"
# Wikimedia Commons görsellerinin kaynak, yazar ve lisans kayıtları (onay içermez).
DEFAULT_COMMONS_IMAGES_FILE = _REAL_CATALOG / "commons_images.json"

MIN_TOKEN_LENGTH = 32


def data_dir_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_INTERNAL_DATA_DIR", DEFAULT_DATA_DIR))


def research_file_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_RESEARCH_FILE", DEFAULT_RESEARCH_FILE))


def corroboration_file_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_CORROBORATION_FILE", DEFAULT_CORROBORATION_FILE))


def proposals_file_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_PROPOSALS_FILE", DEFAULT_PROPOSALS_FILE))


def commons_images_file_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_COMMONS_IMAGES_FILE", DEFAULT_COMMONS_IMAGES_FILE))


def commons_candidates_file_from_env() -> Optional[Path]:
    """İnsan onayı bekleyen yeni Commons adayları. Varsayılan YOKTUR: adaylar yalnızca bu değişken açıkça
    tanımlandığında inceleme kuyruğuna girer (sunucunun yeniden başlatılması tek başına kuyruğu değiştirmez)."""
    path = os.environ.get("VAKIFNAME_COMMONS_CANDIDATES_FILE")
    return Path(path) if path else None


def hackathon_zip_overlay_file_from_env() -> Optional[Path]:
    """Hackathon ZIP fotoğraflarının ek katmanı. Varsayılan YOKTUR; yalnızca açıkça tanımlanınca yüklenir."""
    path = os.environ.get("VAKIFNAME_HACKATHON_ZIP_OVERLAY_FILE")
    return Path(path) if path else None


def token_from_env() -> str:
    """Dahili erişim anahtarı. Önerilen: `VAKIFNAME_INTERNAL_TOKEN_FILE` (yalnızca sahibinin okuyabildiği dosya; anahtar
    süreç ortamında ve ortam dökümlerinde görünmez). Tanımlı değilse eski yöntem `VAKIFNAME_INTERNAL_TOKEN` okunur."""
    path = os.environ.get("VAKIFNAME_INTERNAL_TOKEN_FILE")
    if not path:
        return os.environ.get("VAKIFNAME_INTERNAL_TOKEN", "")
    st = os.stat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError("Dahili anahtar dosyası düzenli dosya olmalı ve yalnızca sahibi okuyabilmeli (izin 600).")
    return Path(path).read_text(encoding="utf-8").strip()
