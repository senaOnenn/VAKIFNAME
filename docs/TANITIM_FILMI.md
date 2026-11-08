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
3. ~~Ses~~ — rehberin klon sesi (Zülal, `zulal-1`). **8 Kasım: kaldırıldı.** Sitedeki ve sunumdaki film sessiz, altyazılı (`~/vakifname-video-assets/film-sessiz/`, ses kanalı çıkarıldı; görüntü aynı). Derlemede `VAKIFNAME_FILM_DIR` bu klasörü gösterir.

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
