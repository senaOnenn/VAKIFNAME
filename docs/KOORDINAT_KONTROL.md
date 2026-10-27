# Koordinat kontrol listesi (Bursa pilot, 10 eser)

> Durum: **KONTROL BEKLİYOR**. Hiçbiri onaylı değil; `checkin_available` kapalı kalır. Hazırlandı: 27 Ekim 2026.
> Kaynak: Google Maps arama sonucundaki **yer işaretçisi** (pin). Bu, eserin **giriş kapısı değil**, Google'ın işaretlediği noktadır (genellikle bina merkezi).
> Katalog sütunu: onaylı kataloğun mevcut noktası (`catalog_snapshot.json`, `accuracy_m` = katalogun bildirdiği doğruluk).

| ID | Eser | Katalog (enlem, boylam) | Doğruluk | Google pin (enlem, boylam) | Google adı | Fark | Kontrol |
|---|---|---|---|---|---|---|---|
| BUR-0001 | Bursa Ulu Camii | 40.183926, 29.061884 | 44 m | 40.1838595, 29.0618687 | Bursa Ulu Cami | **8 m** | [ ] |
| BUR-0003 | Muradiye Camii | 40.191059, 29.046533 | 27 m | 40.190984, 29.0465219 | Muradiye Cami | **8 m** | [ ] |
| BUR-0005 | Muradiye Medresesi | 40.19093, 29.045747 | 26 m | 40.191017, 29.045592 | Muradiye Medresesi | **16 m** | [ ] |
| BUR-0007 | Sultan II. Murad Türbesi | 40.190553, 29.046121 | 20 m | 40.1905504, 29.0460204 | II. Murad Türbesi | **9 m** | [ ] |
| BUR-0008 | Cem Sultan Türbesi | 40.190555, 29.04563 | 25 m | 40.1905076, 29.045923 | Cem Sultan Türbesi | **25 m** | [ ] |
| BUR-0009 | Koza Han | 40.18437, 29.063537 | 46 m | 40.1844815, 29.0635282 | Koza Han | **12 m** | [ ] |
| BUR-0013 | Pirinç Han | 40.185717, 29.060274 | 46 m | 40.185713, 29.0602839 | Pirinç Han | **1 m** | [ ] |
| BUR-0014 | Yıldırım Bayezid Bedesteni | 40.185135, 29.062114 | 37 m | 40.1851174, 29.0620694 | Bedesten | **4 m** | [ ] |
| BUR-0019 | Osman Gazi Türbesi | 40.186831, 29.057366 | 13 m | 40.1867258, 29.0573573 | Osman Gazi Türbesi | **12 m** | [ ] |
| BUR-0020 | Orhan Gazi Türbesi | 40.186728, 29.057663 | 14 m | 40.1867614, 29.057757 | Orhan Gazi Türbesi | **9 m** | [ ] |

## Notlar
- Fark 0–15 m: iki kaynak aynı binayı gösteriyor; asıl iş **giriş kapısı** ve **yarıçap** kararı.
- Giriş kapısı için haritada eserin kapısına yakınlaştırıp noktayı elle işaretlemek (veya sahada ölçmek) gerekir; Google'ın pini bunu vermez.
- **Yarıçap (m)** eser başına ayrıca belirlenecek. Yakın eserler çakışabilir: Muradiye külliyesinde 4 eser 42–95 m arayla, Osman/Orhan Gazi türbeleri 28 m arayla.
- Pirinç Han için Google'da ikinci bir kayıt var: *Tarihi Pirinç Han* 40.1859543, 29.0603224 (≈27 m farklı).
- Bedesten için Google'da: *Bedesten* 40.1851174, 29.0620694 (seçildi), *Bedesten Kuyumcular Çarşısı* 40.185762, 29.062471 (≈62 m kuzeydoğu).
- **Lisans uyarısı:** Google Maps verisini ürün veritabanına doğrudan kopyalamak Google kullanım koşullarına takılabilir. Bu liste yalnızca **karşılaştırma ve kontrol** içindir. Onaylanan nihai nokta, kullanıcının/sahada elle doğruladığı değer olarak kataloğa girer.
- Kataloğa yazma: onaydan sonra `location` + `checkin` kararı (gps_checkin) editör akışıyla eklenir (bkz. TASK.md K7).
