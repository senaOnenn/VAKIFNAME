import os
from pathlib import Path

DEFAULT_DATA_DIR = Path("/var/lib/vakifname-internal")

# Korumalı veri dizininin beklenen yerleşimi (bkz. README, "Dahili V20 veri katmanı").
V20_DIR = "v20"
KNOWLEDGE_BASE_FILE = "vakifname_knowledge_base_v20_dev.json"
FREEZE_MANIFEST_FILE = "vakifname_v20_freeze_manifest_v1_dev.json"
RAG_RUNTIME_DIR = "rag/runtime"
MANIFESTS_DIR = "manifests"
SOURCE_REGISTRY_FILE = "source_registry.json"
IMAGE_MANIFEST_FILE = "image_manifest.json"
IMAGES_DIR = "images/monuments"
SOURCES_DIR = "sources"

MIN_TOKEN_LENGTH = 32


def data_dir_from_env() -> Path:
    return Path(os.environ.get("VAKIFNAME_INTERNAL_DATA_DIR", DEFAULT_DATA_DIR))
