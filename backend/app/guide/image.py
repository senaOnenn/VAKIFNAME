"""Yüklenen fotoğrafın güvenli işlenmesi (yalnızca bellekte; diske yazılmaz, kalıcı saklanmaz).

- Tür, dosya uzantısına veya istemcinin bildirdiği türe göre değil, dosyanın imzasına göre belirlenir: JPEG, PNG, WebP.
- Boyut ve piksel sınırı uygulanır; yapı bozuksa (kesik segment, eksik başlık) dosya reddedilir.
- Konum (GPS) dahil EXIF, XMP, IPTC, yorum ve metin blokları yapısal olarak çıkarılır; görüntü verisi değiştirilmez.
  Arayüz de fotoğrafı göndermeden önce küçültüp yeniden kodlar; bu sunucu denetimi ona güvenmeden yapılır.
"""

import base64
import binascii
import struct
from dataclasses import dataclass

MAX_BYTES = 6 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_SIDE = 12_000


class ImageRejected(ValueError):
    pass


@dataclass(frozen=True)
class CleanImage:
    mime: str
    data: bytes
    width: int
    height: int
    removed: tuple[str, ...]

    def data_url(self) -> str:
        return f"data:{self.mime};base64,{base64.b64encode(self.data).decode('ascii')}"


def _check_dims(w: int, h: int):
    if w <= 0 or h <= 0 or w > MAX_SIDE or h > MAX_SIDE or w * h > MAX_PIXELS:
        raise ImageRejected("Görsel boyutları desteklenen sınırların dışında.")


# JPEG: APP1 (EXIF/XMP), APP13 (IPTC/Photoshop), COM ve diğer uygulama segmentleri atılır. APP0 (JFIF), APP2 (ICC
# renk profili) ve APP14 (Adobe renk dönüşümü) görüntünün doğru çözülmesi için korunur.
_JPEG_KEEP_APP = {0xE0, 0xE2, 0xEE}
_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def _clean_jpeg(b: bytes) -> CleanImage:
    out, removed, i, dims = bytearray(b"\xff\xd8"), [], 2, None
    while True:
        if i + 4 > len(b) or b[i] != 0xFF:
            raise ImageRejected("JPEG yapısı bozuk.")
        marker = b[i + 1]
        if marker == 0xFF:  # dolgu baytı
            i += 1
            continue
        if marker == 0xDA:  # SOS: kalan veri sıkıştırılmış görüntü; olduğu gibi kopyalanır
            if dims is None:
                raise ImageRejected("JPEG boyut bilgisi yok.")
            rest = b[i:]
            if not rest.rstrip(b"\x00").endswith(b"\xff\xd9"):
                raise ImageRejected("JPEG dosyası eksik.")
            out += rest
            break
        if 0xD0 <= marker <= 0xD7 or marker == 0x01:
            out += b[i:i + 2]
            i += 2
            continue
        (seglen,) = struct.unpack(">H", b[i + 2:i + 4])
        if seglen < 2 or i + 2 + seglen > len(b):
            raise ImageRejected("JPEG segmenti bozuk.")
        seg = b[i:i + 2 + seglen]
        if marker in _SOF:
            if seglen < 7:
                raise ImageRejected("JPEG başlığı bozuk.")
            h, w = struct.unpack(">HH", seg[5:9])
            _check_dims(w, h)
            dims = (w, h)
        if (0xE0 <= marker <= 0xEF and marker not in _JPEG_KEEP_APP) or marker == 0xFE:
            removed.append("EXIF/XMP" if marker == 0xE1 else "IPTC" if marker == 0xED else "yorum" if marker == 0xFE
                           else f"APP{marker - 0xE0}")
        else:
            out += seg
        i += 2 + seglen
    return CleanImage("image/jpeg", bytes(out), dims[0], dims[1], tuple(dict.fromkeys(removed)))


# PNG: yalnızca görüntü için gerekli ve renkle ilgili bloklar tutulur; metin (tEXt/zTXt/iTXt), eXIf, tIME vb. atılır.
_PNG_KEEP = {b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS", b"gAMA", b"cHRM", b"sRGB", b"iCCP", b"sBIT", b"pHYs",
             b"acTL", b"fcTL", b"fdAT", b"bKGD"}


def _clean_png(b: bytes) -> CleanImage:
    out, removed, i, dims, ended = bytearray(b[:8]), [], 8, None, False
    while i < len(b):
        if i + 12 > len(b):
            raise ImageRejected("PNG yapısı bozuk.")
        (n,) = struct.unpack(">I", b[i:i + 4])
        ctype = b[i + 4:i + 8]
        if i + 12 + n > len(b):
            raise ImageRejected("PNG bloğu bozuk.")
        chunk = b[i:i + 12 + n]
        if ctype == b"IHDR":
            w, h = struct.unpack(">II", b[i + 8:i + 16])
            _check_dims(w, h)
            dims = (w, h)
        if ctype in _PNG_KEEP:
            out += chunk
        else:
            removed.append(ctype.decode("latin-1"))
        i += 12 + n
        if ctype == b"IEND":
            ended = True
            break
    if dims is None or not ended:
        raise ImageRejected("PNG dosyası eksik.")
    return CleanImage("image/png", bytes(out), dims[0], dims[1], tuple(dict.fromkeys(removed)))


def _clean_webp(b: bytes) -> CleanImage:
    (riff_len,) = struct.unpack("<I", b[4:8])
    if riff_len + 8 > len(b) or riff_len < 12:
        raise ImageRejected("WebP yapısı bozuk.")
    body, removed, i, dims = bytearray(), [], 12, None
    end = 8 + riff_len
    while i < end:
        if i + 8 > end:
            raise ImageRejected("WebP bloğu bozuk.")
        fourcc = b[i:i + 4]
        (n,) = struct.unpack("<I", b[i + 4:i + 8])
        padded = n + (n & 1)
        if i + 8 + n > end:
            raise ImageRejected("WebP bloğu bozuk.")
        chunk = bytearray(b[i:i + 8 + padded])
        if fourcc == b"VP8 " and n >= 10:
            w, h = struct.unpack("<HH", b[i + 14:i + 18])
            dims = (w & 0x3FFF, h & 0x3FFF)
        elif fourcc == b"VP8L" and n >= 5:
            bits = int.from_bytes(b[i + 9:i + 13], "little")
            dims = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
        elif fourcc == b"VP8X" and n >= 10:
            dims = (int.from_bytes(b[i + 12:i + 15], "little") + 1, int.from_bytes(b[i + 15:i + 18], "little") + 1)
            chunk[8] &= ~0x0C & 0xFF  # EXIF (0x08) ve XMP (0x04) bayrakları kapatılır
        if fourcc in (b"EXIF", b"XMP "):
            removed.append(fourcc.decode("latin-1").strip())
        else:
            body += chunk
        i += 8 + padded
    if dims is None:
        raise ImageRejected("WebP boyut bilgisi yok.")
    _check_dims(*dims)
    out = b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + bytes(body)
    return CleanImage("image/webp", out, dims[0], dims[1], tuple(dict.fromkeys(removed)))


def sniff(b: bytes) -> str:
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if b[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp"
    return ""


def clean(data: bytes) -> CleanImage:
    if not data:
        raise ImageRejected("Görsel boş.")
    if len(data) > MAX_BYTES:
        raise ImageRejected(f"Görsel en çok {MAX_BYTES // (1024 * 1024)} MB olabilir.")
    kind = sniff(data)
    try:
        if kind == "image/jpeg":
            return _clean_jpeg(data)
        if kind == "image/png":
            return _clean_png(data)
        if kind == "image/webp":
            return _clean_webp(data)
    except (struct.error, IndexError) as e:
        raise ImageRejected("Görsel dosyası bozuk.") from e
    raise ImageRejected("Yalnızca JPEG, PNG veya WebP fotoğraf yüklenebilir.")


def decode_base64(text: str) -> bytes:
    if text.startswith("data:"):
        _, _, text = text.partition(",")
    if len(text) > (MAX_BYTES * 4) // 3 + 8:
        raise ImageRejected(f"Görsel en çok {MAX_BYTES // (1024 * 1024)} MB olabilir.")
    try:
        return base64.b64decode(text, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ImageRejected("Görsel verisi okunamadı.") from e
