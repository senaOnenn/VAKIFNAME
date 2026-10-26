"""Fotoğraf gizlilik taraması: insan yüzü içeren fotoğraf ücretsiz yapay zekâ uç noktasına gönderilmez.

Ücretsiz uç noktalarda sağlayıcı istemleri kaydedebilir veya model eğitiminde kullanabilir; bu yüzden fotoğraf, sağlayıcıya
gitmeden önce yerelde iki yüz algılayıcıdan geçirilir (ikisi de ONNX, MIT lisanslı):

- UltraFace RFB-320 (onnx/models) — kubbe, rozet gibi büyük yuvarlak biçimlerde yanlış alarm verebilir;
- YuNet 2023mar (opencv_zoo) — küçük süsleme ayrıntılarında yanlış alarm verebilir.

İkisinin örtüşen bir kutuda birlikte yüz bulduğu fotoğraf reddedilir. Yayımlanmış 120 katalog görselinde yanlış alarm 0,
denenen yüzlü örneklerin hepsi (tek kişi, küçük yüz, kalabalık) yakalandı; örnek sayısı küçüktür.

Sınırlar: arkadan, çok küçük (fotoğraf genişliğinin ~%5'inden küçük) veya büyük ölçüde kapalı yüzler kaçabilir; kişisel
belge veya gizli yazı algılanmaz. Bu yüzden ziyaretçi de göndermeden önce fotoğrafta yüz, kişisel bilgi veya gizli belge
olmadığını onaylar. Model dosyaları yoksa veya özetleri tutmuyorsa fotoğraf analizi tümüyle kapalıdır.
"""

import hashlib
import io
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from .image import ImageRejected

logger = logging.getLogger("vakifname.guide")

DEFAULT_MODEL_DIR = Path("/var/lib/vakifname/models/face")
MODELS = {
    "ultraface": ("version-RFB-320.onnx", "34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017"),
    "yunet": ("face_detection_yunet_2023mar.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
}
ULTRA_THRESHOLD = 0.9
YUNET_THRESHOLD = 0.7
AGREE_IOU = 0.3
FACE_MESSAGE = ("Fotoğrafta insan yüzü algılandı. Gizlilik nedeniyle yüz içeren fotoğraflar yapay zekâya gönderilmez; "
                "yalnızca yapıyı gösteren bir fotoğraf deneyin.")


class FaceScreen:
    """`faces(image_bytes) -> int`. Modeller yüklenemezse `available` False olur ve `faces` fotoğrafı reddeder."""

    def __init__(self, model_dir: Optional[Path] = None):
        self.model_dir = Path(model_dir or os.environ.get("VAKIFNAME_GUIDE_FACE_MODEL_DIR", str(DEFAULT_MODEL_DIR)))
        self._sessions: Optional[dict] = None
        self._error: Optional[str] = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._sessions is not None or self._error is not None:
                return
            try:
                import onnxruntime as ort
                from PIL import Image  # noqa: F401
                opts = ort.SessionOptions()
                opts.log_severity_level = 3
                sessions = {}
                for name, (fname, digest) in MODELS.items():
                    data = (self.model_dir / fname).read_bytes()
                    if hashlib.sha256(data).hexdigest() != digest:
                        raise ValueError(f"{name} model özeti tutmuyor")
                    sessions[name] = ort.InferenceSession(data, opts, providers=["CPUExecutionProvider"])
                self._sessions = sessions
            except Exception as e:  # noqa: BLE001 — her hata fotoğraf analizini kapatır
                self._error = type(e).__name__
                logger.warning("face screen unavailable: %s", self._error)

    @property
    def available(self) -> bool:
        self._load()
        return self._sessions is not None

    def faces(self, data: bytes) -> int:
        self._load()
        if self._sessions is None:
            raise ImageRejected("Fotoğraf gizlilik denetimi şu anda kullanılamıyor; fotoğraf analizi kapalı.")
        from PIL import Image, ImageOps
        try:
            with Image.open(io.BytesIO(data)) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
        except Exception as e:  # noqa: BLE001
            raise ImageRejected("Fotoğraf çözülemedi.") from e
        yunet = self._yunet(im)
        return sum(1 for box in self._ultraface(im) if any(_iou(box, other) > AGREE_IOU for other in yunet))

    def _ultraface(self, im) -> list[list[float]]:
        import numpy as np
        x = (np.asarray(im.resize((320, 240)), dtype=np.float32) - 127.0) / 128.0
        scores, boxes = self._sessions["ultraface"].run(None, {"input": x.transpose(2, 0, 1)[None]})
        return boxes[0][scores[0, :, 1] > ULTRA_THRESHOLD].tolist()  # 0–1 aralığında (x1, y1, x2, y2)

    def _yunet(self, im) -> list[list[float]]:
        """Görsel 640×640'a en-boy oranı korunarak sığdırılır (sağ/alt dolgu); giriş BGR, 0–255."""
        import numpy as np
        w, h = im.size
        scale = 640 / max(w, h)
        small = np.asarray(im.resize((max(1, round(w * scale)), max(1, round(h * scale)))), dtype=np.float32)[:, :, ::-1]
        canvas = np.zeros((640, 640, 3), dtype=np.float32)
        canvas[:small.shape[0], :small.shape[1]] = small
        session = self._sessions["yunet"]
        out = dict(zip([o.name for o in session.get_outputs()], session.run(None, {"input": canvas.transpose(2, 0, 1)[None]})))
        found = []
        for stride in (8, 16, 32):
            cols = 640 // stride
            score = np.sqrt(np.clip(out[f"cls_{stride}"][0, :, 0], 0, 1) * np.clip(out[f"obj_{stride}"][0, :, 0], 0, 1))
            for i in np.nonzero(score > YUNET_THRESHOLD)[0]:
                b = out[f"bbox_{stride}"][0, i]
                cx, cy = (i % cols + b[0]) * stride, (i // cols + b[1]) * stride
                bw, bh = np.exp(b[2]) * stride, np.exp(b[3]) * stride
                found.append([float((cx - bw / 2) / (scale * w)), float((cy - bh / 2) / (scale * h)),
                              float((cx + bw / 2) / (scale * w)), float((cy + bh / 2) / (scale * h))])
        return found


def _iou(a, b) -> float:
    w = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    h = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = w * h
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def screen(face_screen: Optional[FaceScreen], data: bytes):
    """Yüz bulunursa veya tarama yapılamıyorsa `ImageRejected` fırlatır."""
    if face_screen is None:
        raise ImageRejected("Fotoğraf gizlilik denetimi yapılandırılmadı; fotoğraf analizi kapalı.")
    if face_screen.faces(data) > 0:
        raise ImageRejected(FACE_MESSAGE)
