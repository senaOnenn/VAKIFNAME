"""Dahili V20 tarihsel veri katmanı.

Bu paket yalnızca yetkili dahili geliştirme ortamı içindir. Genel API'ye (`app.main.create_app`)
bağlanmaz; ayrı bir ASGI uygulaması olarak (`app.internal.server`) yalnızca loopback üzerinde
ve erişim anahtarıyla çalışır. Veri dosyaları repository dışında, korumalı bir dizinde tutulur.
"""
