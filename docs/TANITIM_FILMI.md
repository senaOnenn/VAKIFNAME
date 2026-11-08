# Tanıtım filmi — senaryo ve sahne listesi (onaylandı, 30 Ekim)

> Faz 9 (29 Ekim kararları): harita üzerinde eser eser yolculuk; site ekran görüntüsü yok; tarihî kişiler yalnızca
> portre madalyonuyla (K4); tanıtım sayfasında 10–15 sn sessiz döngü + "Tanıtım filmini izle" (tam film, sesli).
> Üretim HyperFrames ile (HTML/SVG sahneler → MP4); çizimler ürünün kendi vektörleri (Türkiye haritası, rehber
> karakter, mühürler, Kayıp Vakfiye, girih) + yeni eser silüetleri. Ses: rehberin klon sesi. Her tarihî cümle onaylı
> bir kayıttır ve kayıttaki cümle aynen okunur (kayıt kimliği yanında).

**Süre:** ~75 sn · **Biçim:** 16:9 (1920×1080) + altyazı (TR, EN) · **Müzik:** sakin, telifsiz (seçim ayrıca)

| # | Süre | Görüntü | Rehberin sesi (altyazı) | Kaynak |
|---|---|---|---|---|
| 1 | 0–6 | Gece laciverdi; altın girih çizilerek belirir | "Bu topraklarda yüzyıllardır ayakta duran eserler var. Her birinin bir hikâyesi." | — (kurgu) |
| 2 | 6–14 | Türkiye haritası; envanter şehirleri tek tek yanar (Hatay, Konya, Bursa, Kütahya, İzmir, Manisa) | "Vakıf Eserleri Envanter Projesi bu eserleri kitaplara kaydetti. VAKIFNAME onları yanına getiriyor." | Proje bilgisi |
| 3 | 14–20 | Bursa'ya yakınlaşma; rota çizgisi altın kesikli çizilir, ilk üç durak belirir | "Rehberin seni en yakın eserden başlatır." | — |
| 4 | 20–34 | Ulu Cami silüeti (yirmi kubbe); rehber karakter yanında konuşur; köşede **Y.B. madalyonu** "Eserin banisi"; alt şeritte kaynak | "Ulu Cami'yi Sultan Yıldırım Bayezid yaptırmıştır. Yaklaşık 55 × 69 metrelik dikdörtgen bir plana oturan cami, on iki ayağa dayanan yirmi kubbeyle örtülüdür." | BUR-0001-F001, F004 · Cilt I |
| 5 | 34–42 | Soru kartı "Ulu Cami'yi kim yaptırdı?" — üç şık, doğru şık yanar → **bilgi mührü** (indigo) basılır | "Dinle, sor, bilgini sına. Dört doğru, bir mühür." | — |
| 6 | 42–50 | Koza Han silüeti (iki katlı revaklar, avluda köşk mescit); yapboz parçası vakfiyeye uçar | "Koza Han, yapıldığı günden bu yana ticaret için kullanılmaktadır." | BUR-0009-F010 |
| 7 | 50–60 | Osman Gazi Türbesi silüeti (sekizgen, kubbeli); ziyaretçi işareti 50 m halkasına girer → mühür **altına** döner | "Bugünkü türbeyi 1863'te Sultan Abdülaziz yeniden yaptırmıştır. Eserin önüne gittiğinde mührün altına döner." | BUR-0019-F004 |
| 8 | 60–68 | Kayıp Vakfiye: on parça yerine oturur, parçalar altınlaşır | "Her eser bir parça. Hepsini ziyaret edersen vakfiye altın olur." | — |
| 9 | 68–75 | Haritada diğer şehirlerin ışıkları ("yakında"); VAKIFNAME yazısı; alt satır adres | "Vakıf eserlerini yerinde keşfet." | — |

**Sessiz döngü (tanıtım sayfası arka planı, 12 sn, yazısız):** sahne 2 → 3 → 7'nin altın mühür anı, uçları birleşik
(dikiş görünmez). Masaüstü 16:9 + telefon için dikey kesit (~200 KB hedef).

**Kurallar:** tarihî kişinin yüzü çizilmez (yalnızca baş harf madalyonu); rehber "canlandırma"dır, filmde de sağ altta
küçük "canlandırma" etiketi; ekran görüntüsü yok; "sınav" denmez.

## Onay bekleyenler

1. ~~Sahne listesi ve metin~~ — onaylandı (30 Ekim).
2. Müzik: telifsiz sakin bir parça (ney/ud tınılı ya da yalnız piyano) — seçenekler sonra dinletilir.
3. ~~Ses~~ — rehberin klon sesi (Zülal, `zulal-1`). 8 Kasım: kısa süre kaldırılıp geri alındı; ses Zülal'in (yeni filmde de). Sessiz kopya `~/vakifname-video-assets/film-sessiz/` duruyor; sitede sesli film (`~/vakifname-video-assets/film/`). Yeni film: güncel kâşifler + kadın olarak yeniden çizilecek rehber; çıktılar `~/vakifname-video-assets/film-v2/` (eski dosyaların üzerine yazılmaz).

## Üretim (30 Ekim)

Kaynak `film/` (HyperFrames 0.8.221, Node 22+, FFmpeg). Çizimler ürünün kendi bileşenleridir
(`frontend/scripts/film-art.tsx` Vite SSR ile durağan SVG'ye çevirir: rehber karakter ve 9 ağız şekli, mühürler, Kayıp
Vakfiye, girih, Türkiye haritası); Bursa yolları ürünün çevrimdışı harita verisinden (© OpenStreetMap katkıcıları); eser
silüetleri `film/tools/monuments.mjs` (temsilî; alem dikey çubuk + küre, haç gibi okunacak yatay çubuk yok).

```bash
cd film
node tools/build.mjs ses-isleri ~/vakifname-voice/arsiv/2026-10-30-zulal/film/isler.json   # ses satırları
# üret: backend/scripts/voice/generate.py <isler.json> --ref <zulal-tr-referans.wav> --out <klasör>; sahne-N.mp3 → film/assets/audio/
node tools/build.mjs [film|altyazili|dongu|dongu-mobil]   # index.html (o sürüm) + out/tanitim-tr.vtt, tanitim-en.vtt
npx --yes hyperframes@0.8.221 snapshot --at 4,13,30 --no-end -o /tmp/kareler   # göz denetimi
tools/render.sh                                         # hepsi → ~/vakifname-video-assets/film/
```

- Sahne süreleri ses dosyalarından ölçülür; ağız senkronu ürünün kuralıyla (`lipsync.ts`) ses süresine yayılır; göz kırpma
  sabit aralıklarla (render her seferinde aynı). CSS animasyonu yok (render kare kare atlar), hepsi GSAP.
- İngilizce altyazıdaki tarihî cümleler kitabın İngilizce bölümünden: Cilt I s. 20, 25–26; Cilt II s. 11, 119.
- Çıktılar (repoda yok): `tanitim-film.mp4` (1080p, sesli), `tanitim-altyazili.mp4` (TR altyazı gömülü, sunum için),
  `tanitim-web.mp4` (720p, site), `hero.mp4` / `hero-mobil.mp4` (12 sn sessiz döngü), `tanitim-tr.vtt`, `tanitim-en.vtt`.
- Site: `frontend/heroVideo.ts` `filmAssets()` film + iki altyazıyı derlemeye koyar (VTT denetimli); tanıtım sayfası dosya
  varsa "Tanıtım filmini izle" düğmesini gösterir (pencerede altyazı varsayılan açık, Esc ile kapanır).
- `film/package.json`'da bulut yayını ("publish") komutu bilerek yok; HyperFrames kullanım verisi kapalı (`telemetry disable`).

## Sürüm 2 (8 Kasım, Talha)

Çıktılar `~/vakifname-video-assets/film-v2/` (eski `film/` klasörüne dokunulmaz). Değişenler:

- **Hız ×1,15.** Senaryo ve zaman çizelgesi özgün saniyelerle yazılır; çıktıda bütün zamanlar `SPEED`'e bölünür
  (`O()`, `scaleJs`), ses `atempo=1.15` ile hızlanır (perde değişmez; `film/assets/audio/hizli/`). İç içe GSAP çizelgesi
  + `timeScale` denendi, HyperFrames'in seek'i sıfır anlı `set`'leri bozdu; kullanılmaz. Süre ≈80 sn.
- **3D eser maketleri** (`film/tools/sahne3d.js`, Three.js 0.187 `film/vendor/three.min.js`, MIT): Ulu Cami (5 × 4 kubbe,
  iki minare), Koza Han (avlu, revaklar, köşk mescit), Osman Gazi Türbesi; gece laciverdi gövde, altın çizgi, pencerelerde
  sıcak ışık; tabandan yükselerek "inşa" olur, kamera yavaşça döner. **Temsilîdir, rölöve değildir** (kapanışta yazılı).
  Açılış sahnesindeki girih/yıldız kaldırıldı; yerine üç eserin maketi yükselir.
- **Rehber:** kadın rehber görseli (sabit; ağız senkronu yok); konuşurken yalnızca arkasındaki hale ses zarfıyla parlar.
- **Kâşifler (Buse):** Bursa haritasında ziyaretçi Çırak Kâşif portresiyle; yeni sahne "Çıraktan Başkâşife" — iki kâşif dört
  aşamadan geçer (Seviye 1 Çırak Kâşif → 3 Gezgin Seyyah → 5 Vakıf Muhafızı → 7 Başkâşif), her geçişte kart 3D döner.
  Kâşifler düz çizimin silüetinden hesaplanan yükseklik haritasıyla **kabartılır** (gerçek 3D model değil; dönünce hacim
  verir). Kapanışta iki Başkâşif. Yeni ses satırı (Zülal, benzerlik 0,99): "Keşfettikçe kâşifin büyür; çıraktan başkâşife
  yükselir." EN altyazı: "The more you explore, the more your explorer grows, from apprentice to master explorer."
- **Kayıp Vakfiye:** yırtık parşömen (`film/tools/parsomen.mjs`): 5 × 2 = 10 parça, komşular aynı yırtık kenarı paylaşır;
  parçalar uçup birleşir, dikişler kaybolur, vakfiye altınlaşır. Yazı satırları el yazısı dokusudur (harf taklidi yok).
  Koza Han sahnesinde aynı parşömenin küçüğü: Ulu Cami'nin parçası yerinde, Koza Han'ınki uçup oturur.
- Sorudaki doğru şık üründeki gibi yeşil ✓.
- Görseller derlemede ürünün kaynağından kopyalanır (`film/assets/img/`, repoya girmez).

```bash
cd film && OUT=~/vakifname-video-assets/film-v2 bash tools/render.sh film altyazili
# site: VAKIFNAME_FILM_DIR=~/vakifname-video-assets/film-v2 npm run build (frontend)
```

Kararlar (8 Kasım, Talha): APK indirme bağlantısı sitede **yayımlanmaz**; Buse'nin madalyon çerçevesi **kullanılmaz**;
uygulama ikonu ve Kayıp Vakfiye yapboz tasarımı işleri **iptal** (filmde parşömen anlatımı yeterli).

## Sürüm 3 (8 Kasım, Talha) — ürün tanıtımı

Sürüm 2 eleştirisi (Talha): film ürünü değil eserleri anlatıyordu ("ürünü satıyoruz, eserleri değil; ürünün akışı
önemli"); açılışta sitedeki gibi intro yoktu; 3D kâşif kabartması seviye 1, 5 ve 7'de bozuktu. Sürüm 3:

- **Açılış** sitedeki introyla aynı (Intro.tsx / intro.css zamanlaması: harfler bulanıklıktan belirir, altın çizgi, "Geçmişin
  izinde, geleceğe bir miras"; perde 4,6 sn'de çözülür, alttan ürün açılır).
- **Tarihî bilgi yok.** Uygulamanın **gerçek ekranları** telefon çerçevesinde, dokunma halkalarıyla; solda adım başlığı
  ve ürün akışı çizgisi (Kâşif → Rota → Rehber → Sorular → Ziyaret). Ekranlar yerel tanıtım sunucusundan
  (`film/tools/ekran-kaydi.mjs`; canlı içeriğin kopyası, ayrı veritabanı, konum taklidi — canlıya yazılmaz).
- **Kâşifler düz görsel** (3D yok); aşama geçişi altın parıltıyla. 3D maketler çıkarıldı (`sahne3d.js` kullanılmıyor).
- Kayıp Vakfiye yırtık parşömeni ve ×1,15 tempo aynı.

| # | Ekran | Ses (Zülal) |
|---|---|---|
| 1 | Site introsu | — |
| 2 | Tanıtım sayfası (kaydırma) | Vakıfname, vakıf eserlerini keşfetmenin yeni yolu. |
| 3 | Kâşif seçimi → Vakfiye Odası | Önce kâşifini seç. |
| 4 | Şehir → rota → "Konumumu kullan" | Şehrini seç; rota seni en yakın eserden başlatır. |
| 5 | Eser → rehber anlatımı (altyazılı) → rehbere soru, kaynaklı cevap | Eserin başında rehberin anlatır; merak ettiğini ona sor. |
| 6 | Soru (30 sn) → yeşil doğru → kırmızı yanlış → bilgi mührü | Sonra bilgini sına: dört doğru, bir bilgi mührü. |
| 7 | "Konumumu doğrula" → altın mühür (+100 XP) | Eserin önüne gittiğinde mührün altına döner. |
| 8 | Mühür Defteri → yırtık parşömen birleşir, altınlaşır | Her mühür, Kayıp Vakfiye'nin bir parçası. |
| 9 | İki kâşif, dört aşama (düz) | Keşfettikçe kâşifin büyür. |
| 10 | Erişilebilirlik: beş grup (görme, işitme, renk körlüğü, hareket, dikkat) ve her birinin ekranı; renk körlüğünde aynı soru ekranı döteranopi süzgecinden | Sesli anlatım, altyazı, büyük yazı ve süresiz sorularla Vakıfname herkes için. |
| 11 | VAKIFNAME, iki Başkâşif | Vakıfname ile vakıf eserlerini yerinde keşfet. |

Sesler `~/vakifname-voice/film-v3-20261108/` (+ `-kapanis/`; tek başına "Vakıfname." Whisper denetiminden geçmedi, kapanış
cümlesi "… ile …" biçiminde üretildi; erişilebilirlik cümlesi `-erisim/`, dosya adı `sahne-10b.mp3`) → `film/assets/audio/v3/`.
Süre ≈80 sn. Kapanıştaki künye satırı Talha'nın isteğiyle kaldırıldı (ses için yapay zekâ notu sitedeki film penceresinde).

```bash
cd film && OUT=~/vakifname-video-assets/film-v3 bash tools/render.sh film altyazili
# site: VAKIFNAME_FILM_DIR=~/vakifname-video-assets/film-v3 npm run build (frontend)
```
