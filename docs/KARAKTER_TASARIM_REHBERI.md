# Karakter Tasarım Rehberi — Oyuncu Kâşifleri (R6.4)

Üç kâşif × dört görünüm aşaması = **12 görünüm**. R6.5'ten beri arayüzde bu rehbere uygun **katmanlı vektör portre**
kullanılıyor (`frontend/src/app/components/KasifPortrait.tsx`; rehber karakterle aynı çizim dili, fotogerçekçi değil).
Bir illüstratör daha zengin resimsel sürümler çizerse aynı katman düzeni ve ölçülerle bu bileşenin yerine konur; veri
modeli değişmez (yalnızca karakter kimliği saklanır, aşama seviyeden hesaplanır).

## 1. Ne anlatıyoruz

"Osmanlı Bursa'sında tarihî eserlerin izini süren bir kâşif." Oyuncu kendini bir **çırak** olarak görür: saygılı, meraklı,
sakin. Karakter bir süper kahraman, savaşçı ya da sultan değildir. Ton: vakarlı oyunlaştırma (CLAUDE.md §5).

- Karakterler **yalnızca görünüştür**: güç, avantaj, farklı kural yoktur. Görsel de bunu ima etmez (silah, kalkan, zırh yok).
- Gerçek tarihî kişi canlandırılmaz; tarihî kişilerin yüzü çizilmez (K4).
- **Fotogerçekçi yüz ve kişi görseli yok.** Yapay zekâ ile fotogerçekçi üretim, stok fotoğraf ya da gerçek kişinin
  yüzünden türetme kullanılmaz.

## 2. Çizim stili

Ana sayfanın sinematik sahneleriyle (gece laciverdi, fener ışığı, altın parıltı, arşiv odası) aynı dünya:

- **Resimsel illüstrasyon**: yumuşak boya geçişleri, sınırlı ve sıcak ışık (fener/kandil), hafif doku. Çizgi film
  oranları, kalın siyah dış çizgi ve parlak plastik görünüm **yok**.
- Işık kaynağı her görselde **sol üstten**, sıcak (fener tonu); gölgeler lacivert. Arka plan ışığı yok (şeffaf zemin).
- Yüz sade ve sakin: küçük göz, belirgin ama abartısız ifade; gülümseme hafif. Yaş belirsiz genç (çırak).
- Kıyafet ve eşyalar 14.–16. yy Bursa esnaf/medrese çevresini **çağrıştırır**; birebir tarihî kostüm iddiası yoktur.
  Dinî figür, ayet, hat ya da levha kıyafete veya eşyaya **yazılmaz** (CLAUDE.md §5).

## 3. Renk paleti (Palet A, yeşil yok)

| Rol | Renk | Kullanım |
|---|---|---|
| Gece laciverdi | `#0F1330` / `#1A2050` | gölgeler, koyu kumaş |
| Fildişi | `#F3EAD3` | gömlek, kâğıt, açık kumaş |
| Altın | `#C9A24B` | işleme, toka, kenar |
| Parlak altın | `#E9C874` | yalnızca vurgu (mühür, ışık yansıması) |
| Mühür kırmızısı | `#8E2A3A` | kuşak, kurdele, balmumu (küçük alan) |
| Çini kobaltı | `#2F4FA8` civarı | nakkaşın boyası, ince süs |
| Deri / ceviz | `#6B4A2E`, `#3A281B` | çanta, kemer, ahşap (ana sayfa arşiv odasıyla uyumlu) |

Yeşil/zümrüt **hiçbir aşamada yok**. Ten tonları doğal ve çeşitli olabilir; paletin dışında sayılmaz.

## 4. Oranlar ve kadraj

- **Boy:** ~6,5 baş (gerçekçiye yakın, çocuksu değil). Duruş: üç çeyrek, hafif sağa dönük (oyun çubuğunda sağa bakar).
- **Tam boy ana görsel:** 3:4 kadraj, karakter yüksekliğin %88'i; ayaklar alttan %4 yukarıda; baş üstte %8 boşluk.
  Kemerli niş içinde gösterilir (karakter seçimi): kemerin üst yuvarlağı başın üstünde boş kalır.
- **Yarım boy (büst):** göğüs hizasından kesik, yüz kadrajın üst üçte birinde (küçük avatar için).
- Aynı karakterin dört aşamasında **baş, yüz, saç, ten, boy ve duruş değişmez**; yalnızca kıyafet ve eşya katmanları değişir.

## 5. Üç kâşif

| Kimlik | Rol | Kimlik eşyası | Ayırt edici siluet |
|---|---|---|---|
| `gezgin` | Gezgin | pusula, yol çantası, asa | geniş omuz atkısı, çapraz çanta |
| `nakkas` | Nakkaş Çırağı | fırça, boya kabı, desen defteri | önlük, kollar sıvalı, kemerde fırçalar |
| `katip` | Kâtip Çırağı | kamış kalem, divit, rulo kâğıt | uzun cüppe, kuşakta divit, kolda rulolar |

Üçü uzaktan siluetinden ayırt edilebilmeli (32 px avatar dahil).

## 6. Dört aşama (yalnızca kozmetik; seviyeden hesaplanır)

| Aşama | Seviye | Değişen katmanlar |
|---|---|---|
| Başlangıç (`baslangic`) | 1–2 | sade fildişi gömlek, lacivert yelek, kırmızı kuşak; kimlik eşyası basit |
| Gezginlik (`gezginlik`) | 3–4 | yol pelerini/atkısı, deri çanta veya önlük güçlenir, eşya pirinç detaylı |
| Araştırmacı (`arastirmaci`) | 5–6 | altın işlemeli yelek kenarı, kitap/defter, büyüteç veya pergel, kâğıt rulolar |
| Vakfiye Muhafızı (`muhafiz`) | 7+ | koyu lacivert cüppe üstünde ölçülü altın şerit, belde balmumu mühür (`#8E2A3A`), vakfiye rulosu |

En üst aşama bile **sade** kalır: taç, pelerin dalgası, ışık halesi, kanat yok. "Muhafız" bir koruyucu-arşivcidir.

## 7. Katmanlı aksesuar sistemi

Her görsel ayrı katmanlarla teslim edilir; arayüz aşamaya göre katmanları üst üste koyar (aynı boyut ve kadraj):

1. `govde` — ten, yüz, saç (dört aşamada aynı dosya)
2. `kiyafet-<asama>` — temel kıyafet
3. `ust-<asama>` — yelek, pelerin, cüppe
4. `kusak-<asama>` — kuşak, kemer, mühür
5. `esya-<asama>` — kimlik eşyası (pusula, fırça, kalem)
6. `canta-<asama>` — çanta, rulo, defter

Katman sırası sabittir; bir katmanın yokluğu görüntüyü bozmaz. Bu düzen sonradan yeni aksesuar eklemeye izin verir
(veri modelinde yalnızca karakter kimliği saklanır; aşama seviyeden hesaplanır).

## 8. Teslim biçimi ve ölçüler

- **Şeffaf arka plan** (alfa kanallı). Gölge, zemin veya çerçeve çizilmez; arayüz koyar.
- **Kaynak:** katmanlı dosya (PSD/Krita/Procreate) + her katman ayrı PNG.
- **Web için:** WebP (alfa), sRGB.

| Kullanım | Boyut | Not |
|---|---|---|
| Karakter seçimi (tam boy, 3:4) | 960 × 1280 ve 480 × 640 | kemerli nişte |
| Oyun ekranı / Vakfiye Odası (tam boy) | 720 × 960 | |
| Oyun çubuğu avatarı (büst, daire) | 128 × 128 ve 64 × 64 | 32 px'te de okunur olmalı |
| Seviye atlama anı (büst) | 512 × 512 | |

Dosya adı: `kasif-<kimlik>-<asama>-<katman>-<genislik>.webp` (ör. `kasif-katip-muhafiz-esya-960.webp`).

## 9. Erişilebilirlik ve kontrol listesi

- Görseller dekoratiftir; adı ve aşaması metin olarak yanında yazılıdır (alternatif metin boş).
- Koyu lacivert zeminde siluet okunur (kenarda sıcak ışık).
- Teslimden önce: 12 görsel yan yana dizilip aynı yüz/oran kontrol edilir; 32 px küçültmede üç kâşif ayırt edilir;
  yeşil yok; yazı/hat yok; fotogerçekçi değil; telif/lisans kaydı (çizen kişi ve izin) eklenir.
