# Canlı Vasiyet — mimari taslak (henüz uygulanmadı)

Canlı Vasiyet, bir eserin hikâyesini bânisinin ya da vakfın ağzından anlatan **kurgusal** bir anlatımdır. Bu belge yalnızca
mimariyi tanımlar; tarihî karakter konuşması **üretilmez** ve kodu “Esere Sor”u etkilemez.

## İlkeler

1. **Yalnızca onaylı olgular.** Anlatımın her cümlesi genel katalogdaki (`data/public_catalog/catalog.json`) en az bir
   yayımlanmış olguya (`fact_id`) dayanır. Dahili V20 metni, kaynak kitap alıntısı, karantina adayı veya reddedilmiş olgu
   kullanılamaz.
2. **Açıkça kurgu.** Her ekranda ve her paylaşımda “Kurgusal anlatım — tarihî kişinin gerçek sözü değildir” etiketi bulunur.
   Ses, yüz veya imza taklidi yapılmaz; gerçek bir alıntı gibi tırnak içinde sunulmaz.
3. **Ayrı editör onayı.** Anlatım, olgulardan bağımsız bir yayın kararı (`vasiyet_script`) almadan genel API'ye çıkmaz.
4. **Belirsizlik korunur.** `uncertain` veya `reported` olgular anlatımda kesin bilgiye dönüştürülemez (“rivayete göre”,
   “kaynaklar farklı anlatır” gibi ifadeler zorunlu).

## Veri modeli

```json
{
  "script_id": "VAS-BUR-0009-001",
  "monument_id": "BUR-0009",
  "persona": {"label": "Koza Han'ın vakfı (kurgusal anlatıcı)", "kind": "institution|founder|building"},
  "label": "Kurgusal anlatım — tarihî kişinin gerçek sözü değildir",
  "segments": [
    {"text": "…", "fact_ids": ["BUR-0009-F001"], "certainty_floor": "documented"}
  ],
  "catalog_sha256": "<anlatımın hazırlandığı katalog>",
  "status": "draft|in_review|approved|withdrawn"
}
```

## Akış

1. **Taslak (dahili, 8765).** Editör, olgu listesinden segment seçer ve kısa metin yazar. (İleride bir LLM taslak önerebilir;
   önerinin her cümlesi bir `fact_id` taşımak zorundadır.)
2. **Otomatik denetim (sunucu).**
   - Her segmentte ≥1 `fact_id`, hepsi o katalogda yayımlanmış ve aynı esere ait.
   - Segmentte geçen yıl, sayı ve özel adlar dayandığı olguların metninde geçmeli; geçmeyen ad/sayı reddedilir.
   - Kaynak kitapla 8 kelimelik ortak dizi yasak (mevcut `copies_source` denetimi).
   - `uncertain/reported` olguya dayanan segmentte belirsizlik ifadesi zorunlu.
   - Kurgu etiketi boş olamaz.
3. **Editör kararı.** `vasiyet_script` için mevcut bilet, en az inceleme süresi ve denetim günlüğüyle karar
   (`approved / needs_revision / rejected`). Karar, anlatımın SHA-256 değerine bağlıdır; metin veya dayandığı olgulardan
   biri değişirse karar bayatlar.
4. **Yayın.** Dışa aktarıcı, yalnızca onaylı ve bayatlamamış anlatımları `catalog.json` içine `vasiyet` alanı olarak yazar.
   Dayandığı olgulardan biri yayından kalkarsa anlatım da kalkar.
5. **Genel arayüz.** Eser hikâyesinde ayrı bir “Canlı Vasiyet (kurgusal)” sekmesi; her segmentin yanında dayandığı olgu ve
   bağımsız kaynak bağlantıları. Esere Sor cevaplarıyla karışmaz.

## Eksikler (sıradaki iş)

- `vasiyet_script` karar türü, denetim kuralları ve batch inceleme aşaması (dahili sunucu).
- Dışa aktarıcı ve genel katalog şemasında `vasiyet` alanı (şema sürümü `/3`).
- Editör için segment yazma arayüzü ve otomatik denetim sonuçlarının gösterimi.
- (İsteğe bağlı) LLM taslak önerisi: harici servise yalnızca zaten yayımlanmış metinler gider; ayrı onay gerekir.
- Kurgu etiketinin ve kaynak gösteriminin erişilebilirlik ve mobil testleri.
