"""Yapay zekâ tarih rehberi: onaylı katalog olgularıyla üretken cevap (RAG) ve fotoğraf analizi (VLM).

Akış: soru → yerel e5 aramasıyla onaylı olgular → sağlayıcıdaki LLM'e olgu kimlikleriyle gönderim → cümle başına olgu
kimliği taşıyan yapılandırılmış cevap → backend her cümleyi atıf yaptığı olgulara karşı denetler → kaynaklarıyla gösterim.
Sağlayıcı çalışmazsa, anahtar yoksa veya bütçe dolarsa mevcut kaynaklı arama (`app/ask`) cevap verir.
"""
