# Rehberle Konuş ve Canlı Vasiyet — sonraki aşamalar için teknik not

> Durum (3 Kasım 2026, R3.2 ürün kararları): eser sayfasındaki sohbet alanının adı **Rehberle Konuş**.
> "Canlı Vasiyet" adı yalnızca `docs/CANLI_VASIYET.md`'deki editör onaylı özel tarihî anlatıma aittir (henüz uygulanmadı).
> K4 sürer: rehber kurgusal yerel rehberdir, tarihî kişi adına konuşmaz. Bu not öneridir; hiçbiri uygulanmadı.

## Bugünkü durum (yalnızca frontend)

- **Sohbet et** (varsayılan): tamamen gündelik mesajlar (`frontend/src/app/smallTalk.ts`) tarayıcıda, önceden yazılmış ve
  tarihî iddia içermeyen cevapla karşılanır; API çağrılmaz, bütçe harcanmaz, oyun sayacı ilerlemez, geçmişe girmez.
- **Kaynaklara sor**: gündelik mesaja mod ipucu; tarihî sorular iki modda da `/guide/ask` → RAG → `Checker` hattından geçer.

## 1. Gerçek model destekli doğal sohbet (ayrı backend aşaması)

Amaç: hazır cevaplar yerine modelin doğal konuşması; ama tarihî iddia yine yalnızca onaylı kayıttan.

1. **API sözleşmesi.** `/guide/ask` isteğine isteğe bağlı `intent: "chat" | "sources"` (varsayılan `sources`; eski
   istemciler etkilenmez). Yanıttaki cümlelere `kind: "conversational" | "sourced"` alanı. Frontend `askGuide()` yalnızca
   `conversational` cümlelerde kaynak şartını kaldırır; `sourced` cümlede kaynaksızlık bugünkü gibi reddedilir.
2. **Sunucu tarafı niyet sınıflandırma.** `smallTalk.ts` mantığının Python karşılığı (`backend/app/guide/`), istemciye
   güvenilmez. Karışık mesaj ("Merhaba, kim yaptırdı?") kaynaklı hatta gider.
3. **Ayrı sohbet istemi.** `ANSWER_SYSTEM`'e dokunmadan yeni `CHAT_SYSTEM`: kısa, saygılı; yıl, ad, sayı, olay, kişi
   iddiası yasak; tarihî soru gelirse "kaynaklara bakayım" diyerek kaynaklı hatta yönlendirme. Kayıtlar (RAG) bu isteme
   **verilmez**, böylece kaynak dışı tarih sızmaz.
4. **Denetim (`claims.Checker` genişletmesi).** Konuşma cümlesinde yıl/sayı, özel ad (eser adı hariç), tarihî fiil
   kalıpları ("yaptırdı", "inşa", "vakfetti", "öldü"…) aranır; bulunan cümle düşer, düşen olursa hazır cevaba geri dönülür.
   Bu bir güvenlik kuralı değişikliğidir (CLAUDE.md §4); ayrı onay gerekir.
5. **Bütçe ve kötüye kullanım.** Sohbet çağrıları ayrı sayaçla sınırlanır (oturum başına üst sınır); sınır aşılınca hazır
   cevaplar. Oyun ilerlemesi yalnızca `sourced` cevapla sayılır (bugünkü davranış).
6. **Testler.** Sahte sağlayıcı ile: sohbet cümlesinde tarih/ad sızarsa düşmesi, karışık mesajın kaynaklı hatta gitmesi,
   `intent` yokken eski davranış, frontend'de `conversational` etiketinin "Rehber · canlandırma" olarak gösterilmesi.
   Canlı model testi yalnızca elle ve ortam değişkeniyle (`VAKIFNAME_EVREN_LIVE_TEST=1` örneği).

## 2. Canlı Vasiyet — editör onaylı senaryo sistemi için gereken bileşenler

Tanım `docs/CANLI_VASIYET.md`'dedir (değiştirilmedi). Gerekenler:

| Katman | Bileşen |
|---|---|
| Veri | `vasiyet` senaryo modeli (`script_id`, `monument_id`, `persona`, kurgu etiketi, `segments[].fact_ids`, `catalog_sha256`, `status`); dahili veritabanında tablo |
| Dahili sunucu (8765) | Taslak düzenleyici: olgu listesinden segment seçimi, kısa metin; isteğe bağlı LLM taslağı (yalnızca yayımlanmış metinlerle) |
| Otomatik denetim | Segment başına ≥1 aynı esere ait yayımlanmış `fact_id`; yıl/sayı/özel adın dayanak olguda geçmesi; kaynakla 8 kelimelik ortak dizi yasağı (`copies_source`); `reported/uncertain` olguda belirsizlik ifadesi; boş olmayan kurgu etiketi |
| Onay | Yeni karar türü `vasiyet_script` (`approved / needs_revision / rejected`), SHA-256'ya bağlı; metin veya dayanak olgu değişince karar bayatlar; denetim günlüğü. CLAUDE.md §2.13'e göre onayı **yönetici** verir |
| Yayın | Dışa aktarıcıda yalnızca onaylı ve bayatlamamış senaryolar; genel katalog şemasında `vasiyet` alanı (şema `/3`); dayanak olgu yayından kalkınca senaryo da kalkar |
| Genel API | Eser detayında salt okunur `vasiyet` alanı; model çağrısı yok (önceden onaylı metin) |
| Arayüz | Eser sayfasında ayrı "Canlı Vasiyet (kurgusal)" sekmesi; her segmentte dayanak olgu ve kaynak bağlantısı; Rehberle Konuş'tan ayrı; isteğe bağlı ses (önceden üretilmiş) ve altyazı |
| Ürün kararı | Bânî/vakıf ağzından anlatım K4 ile çelişir: uygulamadan önce CLAUDE.md §2.4 için açık karar (ör. yalnızca `persona.kind = institution|building`) |
| Testler | Denetim kuralları, bayatlama, dışa aktarım, arayüzün kurgu etiketini ve kaynakları göstermesi |
