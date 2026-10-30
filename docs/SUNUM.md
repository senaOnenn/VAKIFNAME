# Final sunumu — demo senaryosu, B planı, jüri soruları (taslak)

> Faz 10 taslağı (30 Ekim). İskelet TASK.md'de onaylı. Konuşmacılar ve süreler ekipçe netleşir; slaytlar organizasyonun
> şablonu gelince hazırlanır. Burada yazan her teknik iddia üründe çalışır durumdadır; çalışmayan bir şeyi söylemeyiz.

## 1. Canlı demo (~5 dk)

Ön koşul: canlı adres açık (`https://calismalar.tikirsoft.com`), **sunum modu açık** (ekranda "simülasyon" yazar),
hazır hesap girişli bir sekme + misafir sekmesi, yönetici hesabı ayrı tarayıcı profilinde. Ekran yakınlaştırması %125.

| Süre | Ekranda | Söylenen (özet) | Kanıtladığı (şartname) |
|---|---|---|---|
| 0:00–0:30 | Açılış → tanıtım sayfası | "Siteyi açan ilk 5 saniyede ne olduğunu anlar; uzun metin yok." | Funnel, 5.4 |
| 0:30–1:00 | "Keşfe başla" → hazır hesapla giriş → Türkiye haritası → Bursa | "Bursa pilot; şehir bir veri alanı, yeni şehir kod değişikliği istemez." | Ölçek, 5.1.1 |
| 1:00–1:30 | Rota: en yakın 3 eser açık, kilitler | "Rota yönlendirir; her bilgi mührü bir kilit açar." | Birden çok eser keşfi |
| 1:30–2:30 | Ulu Cami → **Dinle**: rehber konuşur (ağız senkronu, altyazı), kaynak satırı | "Her cümle onaylı bir kayda bağlı; kaynağı kitap ve sayfa." | 5.1.3, 5.1.4 (ses + altyazı) |
| 2:30–3:00 | Rehbere sor: "Bu camiyi kim yaptırdı?" → kaynaklı cevap | "Rehber yalnızca onaylı kayıtlardan konuşur; bilmiyorsa 'kaynaklarımda bulamadım' der." | Yapay zekâ + doğruluk |
| 3:00–3:40 | **Rozeti Al**: 5 soru (görsel eşleştirme dahil) → bilgi mührü | "Bu bir oyun; doğru cevap tarayıcıya gönderilmez, sunucuda denetlenir." | Oyunlaştırma, güvenlik |
| 3:40–4:00 | Ziyaret → altın mühür ("simülasyon" etiketiyle) → Pasaport, Kayıp Vakfiye | "Gerçekte konumla, 50 m içinde. Ziyaret en değerli ödül." | Fiziksel ziyaret teşviki |
| 4:00–4:20 | Dil: TR → EN | "İngilizce içerik kitabın İngilizce bölümünden, onaylı; makine çevirisi yok." | Turist, 5.1.4 |
| 4:20–5:00 | Yönetici: kitap PDF'i → aday kayıtlar (alıntı sayfada vurgulu) → **onayla** → eser sayfasında anında görünür | "İçerik ekleme ve düzenleme; onaysız hiçbir şey yayına çıkmaz." | 5.1.1 içerik yönetimi |

Notlar:
- Yönetici adımı için kitap ve eser **önceden** yüklenir; canlıda yalnızca bir adayın onayı gösterilir (aday üretimi
  dakikalar sürebilir; beklemeyiz).
- Rehber cevabı ~10 sn sürebilir: o sırada konuşmacı kaynak satırını anlatır.

## 2. Aksilik B planı

| Aksilik | Belirti | Ne yapılır |
|---|---|---|
| Salon interneti yok | Sayfa açılmıyor | Telefon paylaşımı (hotspot) → olmazsa **yedek dizüstü**: `deploy/yedek/calistir.sh --hizli`, hazır hesap (README "Demo yedeği") |
| Sunucu yanıt vermiyor | API hatası | Yedek dizüstüne geç (aynı sürüm ve içerik, eşitleme finalden önce) |
| Rehber cevabı gecikiyor / kapalı | "Rehber şu anda soru alamıyor" | Dürüstçe söyle: "Model yoksa sistem uydurmaz, kaynaklı aramaya düşer" — bu bir özellik |
| Google girişi açılmıyor | Düğme yok | Hazır e-posta+parola hesabı |
| Harita karoları gelmiyor | "Bağlantı yok" notu | Ana yollar çizilir; durak listesi aynı işi görür |
| Ses çıkmıyor | Hoparlör | Altyazı zaten ekranda; "sessiz mod" erişilebilirlik özelliğidir |
| Yanlış cevap verildi, mühür gelmedi | "Bu sefer olmadı" | "Yeniden dene" farklı sorularla açılır — gösterilebilir |

Son çare: akışın ekran kaydı (şartname: kayıt canlı demonun yerine geçmez, yalnızca destek).

## 3. Jüri soru-cevap kartları

1. **Yapay zekâ uydurursa?** Rehber yalnızca o eserin onaylı kayıtlarıyla konuşur. Her cümle bir kayıt kimliğine
   bağlanır; bağlanamayan cümle atılır, kayıtta olmayan sayı atılır. Kaynak yoksa "kaynaklarımda bulamadım" der. Model
   kapalıysa uydurmak yerine kaynaklı aramaya düşer.
2. **Bilgiler nereden geliyor, kim onaylıyor?** Envanter yayınlarından. Hat kitaptan aday çıkarır; her adayın alıntısı
   kitabın o sayfasında aranır, bulunamazsa aday düşer. Yönetici kaynak sayfayla yan yana görüp onaylar; kimin ne zaman
   onayladığı kayıtlıdır, kayıtlar silinemez.
3. **Kesin olmayan bilgiyi nasıl gösteriyorsunuz?** "Belgelenmiş / rivayet / kesin değil" etiketi; sesli anlatımda da
   söylenir ("Aktarılan bir rivayete göre…").
4. **Konum taklit edilirse?** Konum tarayıcıdan gelir; sahte GPS'i tamamen engellemek web'de mümkün değil. Ziyaret
   mührü ödüldür, para veya hak değildir; riski düşük. Yol haritası: eserde QR / kısa kod, sıra dışı hız denetimi.
   Konum saklanmaz, yalnızca karşılaştırılır.
5. **Neden 50 m?** Büyük yapılarda kapıdaki ziyaretçi dışarıda kalmasın diye (35 m'den büyütüldü); yakın eserler
   çakışmasın diye küçük tutuldu. Eser bazında ayarlanabilir; sahada denenip ince ayar yapılır.
6. **İnternet yoksa?** Canlı demo sunucuda; aynı sürüm ve içerik yedek dizüstünde internetsiz açılır. Sahada zayıf
   ağda ilk içerik ~2 sn (yavaş 4G ölçümü).
7. **Yeni şehir ne kadar sürer?** Kod değişmez: şehir bir veri alanı. Yönetici kitabı ve eserleri ekler, hat adayları
   çıkarır, yönetici onaylar. Süre içerik onayına bağlı, geliştirmeye değil.
8. **Maliyet?** Sunucu tek küçük makine. Rehber modeli abonelikle; günlük kullanım sınırı ve devre kesici var
   (aşılınca kaynaklı aramaya düşer). Ses ekipten bir insan sesinin ücretsiz klonuyla **önceden** üretilir; istek
   başına ücret yok.
9. **Kişisel veri / KVKK?** Misafir oynanabilir. Hesapta yalnızca e-posta ve ad; parola scrypt özeti. İstatistik
   anonim (kişi tutulmaz). Konum saklanmaz. Hesap ve tüm ilerleme tek tuşla silinir. Ses klonu yalnızca açık izinle.
10. **Telif?** Envanter yayınlarını dahil olduğumuz proje hazırlıyor; biz çevrim içine taşıyoruz. Üçüncü taraf
    görsellerde (Wikimedia Commons) lisans ve atıf her görselin altında.
11. **Erişilebilirlik?** Sesli anlatım + altyazı + tam metin, büyük altyazı, sessiz mod, klavye, ekran okuyucu,
    hareket azaltma; otomatik denetim (axe, WCAG 2.2 AA) temiz. Çalışan üründe, tasarımda değil.
12. **Güvenlik?** Doğru cevap istemciye gitmez; oturum HttpOnly çerez; giriş ve yapay zekâ uçlarında hız sınırı;
    içerik güvenlik politikası (CSP); yönetici yalnızca doğrulanmış e-postayla.
13. **Test?** Backend ve arayüzde otomatik testler (her birleştirmede hepsi geçer), uçtan uca tarayıcı denemeleri ve
    erişilebilirlik taraması.
14. **Neden oyun?** Amaç ziyaret; oyun araçtır. Herkes evden başlar (dinle, sor, bilgi mührü), en değerli ödül
    (altın mühür, altın vakfiye) yalnızca yerinde ziyaretle gelir.
15. **İngilizce nasıl?** Kitapların İngilizce bölümünden, alıntısı doğrulanmış ve onaylı; İngilizcesi olmayan kayıt
    Türkçe kalır ve bu söylenir. Makine çevirisi yok.

## 4. Sunum öncesi kontrol listesi

- [ ] `deploy/yedek/esitle.sh` (son içerik) ve yedek dizüstünde `calistir.sh` denendi
- [ ] Hazır hesap canlıda ve yedekte açık; parola ekipte
- [ ] Sunum modu açık (`VAKIFNAME_VISIT_SIMULATION=on`), ekranda etiket görünüyor
- [ ] Rehber cevap veriyor (sunucuda `claude` oturumu açık)
- [ ] Anlatım sesleri yüklü (`/speech/status` → `files`)
- [ ] Yönetici demosu için kitap + eser önceden yüklü, bir aday onaya hazır
- [ ] Ses çıkışı, ekran yakınlaştırma, bildirimler kapalı
