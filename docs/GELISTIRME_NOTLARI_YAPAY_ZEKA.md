# Yapay zekâ rehberi — fotoğraftan mimari analiz (Görev 32) · geliştirme notları

> **Durum: HENÜZ TAM DOĞRULANMADI. Kararlı sürüm değildir; testers veya genel yayına bu daldan dağıtım yapılmaz.**
> Kararlı ortak sürüm `develop` dalıdır. Bu dal yalnızca yapay zekâ rehberi geliştirmesi içindir.

## Bu daldaki değişiklikler (`develop`'a göre)

- Fotoğraf çağrısı önce **mimari analiz** yazar; kimlik isteğe bağlıdır (`photo_analyzed` durumu).
- Gözlem filtresi (`backend/app/guide/observation.py`): yan cümle düzeyinde ayıklama, değiştirici listesinden sözcük
  düşürme, bağlamı kopan cümlenin düşürülmesi, malzemenin `material_guess` ve özelliklerle tutarlılığı.
- Fotoğraf sonrası mimari takip soruları (`photo_context`; fotoğraf yeniden gönderilmez, tekrar yeni bilgi gibi sunulmaz).
- Frontend: "Fotoğrafın Mimari Analizi" alanı, "daha ayrıntılı açıkla" eylemi, takip soruları.
- Testler: `test_guide_architecture.py`, gerçek model çıktılarını yeniden oynatan `test_guide_real_outputs.py`
  (`tests/data/g32_nvidia_outputs.json`: yalnızca modelin metin çıktısı; görsel, anahtar veya kişisel veri yok).

## Açık sorunlar (2026-10-26 gerçek model ölçümü)

1. **Malzeme kuralı doğru cümleleri siliyor.** Çekincesiz malzeme ifadesinde cümlenin tamamı düşüyor; ardından
   "bağlam kopması" kuralı bağlı doğru cümleleri de siliyor (Yıldırım Bayezid örneğinde 4 doğru gözlem kayboldu).
   Önerilen: yalnızca malzeme niteleyicisini çıkarmak; ham özellik listesindeki öğeleri görünür saymak.
2. **Görsel zaman aşımı dar.** `VAKIFNAME_GUIDE_VISION_TIMEOUT_S=25` iken 5 görsel denemesinin 2'si zaman aşımına
   uğradı; başarılı çağrılar 24,8 sn'ye kadar sürdü. Önerilen: ≈40 sn (genel süre sınırı 50 sn).
3. **Model kaynaklı yanlış mimari iddialar filtrelenemiyor** (ör. Ulu Cami'de "büyük merkez kubbe", "kemerli avlu").
   Arayüzdeki "yapay zekâ, yanılabilir" uyarısı korunmalı.
4. **Sözlük boşlukları:** "büyük harfliyle", "tekerlek şeklinde", "yeşil şeritli ağız" denetimden geçiyor.
5. **Ölçülmeyenler:** Bedesten levha ayrıntısı ve iki takip sorusu gerçek modelle yeniden ölçülemedi (zaman aşımı/502).
6. **Dağıtım uyumu:** Bu dalın backend'i ve frontend'i birlikte dağıtılmalıdır. Eski frontend yeni backend ile
   `building_type`'ı gösterir ve "daha ayrıntılı açıkla" eylemini tanımaz.

## Doğrulama için kalanlar

- 1–2 numaralı düzeltmeler ve yerel regresyon (`pytest tests/test_guide*.py`).
- Proje sorumlusunun onayıyla sınırlı sayıda gerçek model çağrısı (yalnızca kullanım hakkı uygun Commons görselleri;
  ZIP veya kitap görselleri gönderilmez).
- Frontend + backend birlikte testers ortamında doğrulama; ancak ondan sonra `develop`'a PR.
