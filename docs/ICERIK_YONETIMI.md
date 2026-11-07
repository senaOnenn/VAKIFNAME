# İçerik yönetimi (şartname 5.1.1) — tasarım ve API sözleşmesi

Karar: CLAUDE.md §2.13 (29 Ekim). Tek rol **yönetici**; onaysız hiçbir kayıt genel uygulamada görünmez.

## Akış
1. **Kaynak ekle:** yönetici kitabı (PDF) yükler, başlığını yazar ve **kullanım iznini** işaretler. Sunucu sayfa metnini
   çıkarır (fiziksel PDF sayfası, 1 tabanlı) ve saklar. PDF ve metin yalnızca sunucudaki içerik dizinindedir, repoya girmez.
2. **Eser:** katalogdaki (onaylı V20) eserler salt okunurdur; yönetici bunlara yeni kayıt ekleyebilir. Yeni eser de
   eklenebilir (ad, tür, şehir, ilçe, adres, haritada konum, ziyaret uyarısı). Yeni eser kimliği `<ŞEHİR>-5001`'den başlar.
3. **Hat:** yönetici kaynak + eser + sayfa aralığı (en fazla 6 sayfa) seçer → rehber modeli (`claude -p`, abonelik) aday
   kayıtlar önerir. Her adayın kitaptan **birebir alıntısı** olmalı; alıntı belirtilen sayfada (veya bitişiğinde; sayfa
   düzeltilir) bulunamazsa aday **düşer**. Kalanlar **taslak** olur.
4. **Elle:** yönetici kayıt ekler/düzenler. Kaynak (kitap + sayfa) zorunlu; alıntı isteğe bağlı ama yazılırsa sayfada
   bulunmalıdır.
5. **Onay:** yönetici taslağı kaynak sayfa metniyle yan yana görür, düzeltir, **onaylayıp yayımlar** veya reddeder.
   Yayımlanmış kayıt taslak olarak kaydedilirse yayından çekilir; "kaydet ve yayımla" yeniden onaydır.
   Her onay `DEC-…` kimlikli, kimin ne zaman onayladığını tutan, yalnızca eklenen bir karar kaydıdır.
6. **Yayın:** onaylı içerik `published.json` katmanına atomik yazılır; genel katalog bu katmanı V20 anlık görüntüsünün üstüne
   ekler ve dosya değişince yeniden yükler. Eser sayfası, anlatım, rota, sınav ve rehber yeniden başlatma olmadan günceller.

## Kurallar (sunucuda denetlenir)
- Yalnızca yönetici (`VAKIFNAME_ADMIN_EMAILS`, doğrulanmış e-posta). Oturum yok → 401, yönetici değil → 403.
- Kitaptan türetilen kayıt, kaynağın kullanım izni işaretlenmeden yayımlanamaz (409).
- Kesinlik: `documented` (belgelenmiş) | `reported` (rivayet) | `uncertain` (kesin değil). Rivayet ve kesin olmayan bilgi
  arayüzde ve anlatımda öyle etiketlenir.
- Konumsuz eser yayımlanabilir ama haritada/rotada yer almaz ve ziyaret edilemez.
- Taslak eserin kayıtları, eser yayımlanana kadar görünmez.

## API (`/admin/content`, JSON; dosya yüklemede ham gövde)
Ortak tipler:
```ts
type Status = 'draft' | 'published' | 'rejected' | 'withdrawn'
type Decision = { decision_id: string; by: string; at: string } | null
type Source = { source_id: string; title: string; page_count: number; rights_confirmed: boolean; uploaded_at: string; uploaded_by: string }
type Quest = { question: string; choices: string[]; answer_index: number; explanation: string }
type Fact = {
  fact_id: string; monument_id: string; title: string; text: string; category: string; certainty: string
  source_id: string; page: number; quote: string; game_use: boolean; quest: Quest | null
  origin: 'pipeline' | 'manual'; status: Status
  quote_check: 'found' | 'not_found' | 'no_quote'; updated_at: string; decision: Decision
}
type MonumentFields = { name: string; alternative_names: string[]; type: string; city: string; district: string
  address: string; latitude: number | null; longitude: number | null; site_notice: string | null }
type MonumentRow = { monument_id: string; name: string; city: string; type: string; origin: 'catalog' | 'content'
  status: Status; facts: { draft: number; published: number } }
type Image = { image_id: string; url: string; rights_holder: string; license: string; attribution: string | null
  title: string | null; source_url: string | null; status: Status; decision: Decision }
type Job = { job_id: string; source_id: string; monument_id: string; page_from: number; page_to: number
  status: 'queued' | 'running' | 'done' | 'failed'; created_at: string; finished_at: string | null
  candidates: number; dropped: number; error: string | null }
```
| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/admin/content/overview` | — | `{ enabled, sources: Source[], monuments: MonumentRow[], drafts: number, vocab: { certainty: string[], category: string[], type: string[], cities: {slug,name}[] } }` |
| POST | `/admin/content/uploads` | ham dosya; `Content-Type: application/pdf \| image/jpeg \| image/png` | `{ upload_id, kind: 'pdf'\|'image', size }` |
| POST | `/admin/content/sources` | `{ upload_id, title, rights_confirmed }` | `Source` |
| GET | `/admin/content/sources/{source_id}/pages/{page}` | — | `{ source_id, page, page_count, text }` |
| GET | `/admin/content/sources/{source_id}/search?q=` | — | `{ hits: { page, snippet }[] }` (en fazla 30) |
| POST | `/admin/content/monuments` | `MonumentFields & { publish: boolean }` | `{ monument_id, ...MonumentFields, origin, status, decision }` |
| GET | `/admin/content/monuments/{monument_id}` | — | `{ monument: (yukarıdaki), facts: Fact[], images: Image[] }` (katalog eseri: alanlar salt okunur, `origin:'catalog'`) |
| PUT | `/admin/content/monuments/{monument_id}` | `MonumentFields & { publish }` | aynı (yalnızca `origin:'content'`) |
| POST | `/admin/content/monuments/{monument_id}/withdraw` | — | aynı |
| GET | `/admin/content/facts?status=&monument_id=` | — | `{ facts: Fact[] }` |
| POST | `/admin/content/facts` | `{ monument_id, title, text, category, certainty, source_id, page, quote, game_use, quest, publish }` | `Fact` |
| PUT | `/admin/content/facts/{fact_id}` | aynı (`monument_id` hariç) | `Fact` |
| POST | `/admin/content/facts/{fact_id}/publish` · `/reject` · `/withdraw` | — | `Fact` |
| POST | `/admin/content/extract` | `{ source_id, monument_id, page_from, page_to }` | `Job` (202) |
| GET | `/admin/content/jobs/{job_id}` | — | `Job` |
| POST | `/admin/content/monuments/{monument_id}/images` | `{ upload_id, rights_holder, license, attribution, title, source_url, publish }` | `Image` |
| POST | `/admin/content/images/{image_id}/publish` · `/withdraw` | — | `Image` |
| GET | `/admin/content/media/{file}` | — | görsel (yalnızca yönetici; taslak görselin önizlemesi) |

Hatalar: `{ detail: string }` (Türkçe). 400 geçersiz, 401/403 yetki, 404 yok, 409 kural (ör. kaynak izni yok, alıntı
sayfada yok, katalog eseri düzenlenemez), 413 dosya büyük, 415 dosya türü, 503 içerik deposu kapalı
(`VAKIFNAME_CONTENT_DIR` tanımsız; `overview.enabled=false`).

## İngilizce (Faz 11, karar 15 = C)
Tarihî içerikte makine çevirisi yoktur: İngilizce metin kitabın İngilizce bölümünden gelir, İngilizce alıntı sayfada
birebir doğrulanır ve yönetici onaylar. Çeviri bir Türkçe kayda (katalog ya da depo) bağlıdır; Türkçe kayıt yayında
değilse çeviri görünmez.
```ts
type Translation = { fact_id: string; monument_id: string; fact_title: string; fact_text: string
  title_en: string; text_en: string; quote_en: string; source_id: string; page: number
  origin: 'pipeline' | 'manual'; status: Status; quote_check: 'found' | 'not_found' | 'no_quote'; updated_at: string; decision: Decision }
```
| Yöntem | Yol | Gövde | Yanıt |
|---|---|---|---|
| GET | `/admin/content/translations?status=&monument_id=` | — | `{ translations: Translation[] }` |
| PUT | `/admin/content/facts/{fact_id}/en` | `{ title_en, text_en, quote_en, source_id, page, publish }` | `Translation` (katalog kaydı da olabilir) |
| POST | `/admin/content/facts/{fact_id}/en/publish` · `/reject` · `/withdraw` | — | `Translation` |
| PUT | `/admin/content/monuments/{monument_id}/en` | `{ name_en, site_notice_en, publish }` | `{ monument_id, name_en, site_notice_en, status, decision }` |
| POST | `/admin/content/extract` | `{ ..., lang: 'tr' \| 'en' }` | `Job` (`kind: 'tr' \| 'en'`; en: yayındaki Türkçe kayıtların İngilizce karşılıkları) |

`GET /admin/content/monuments/{id}` ayrıca `translations`, `monument_en` ve `tr_facts: {fact_id, title, text}[]` (yayındaki
Türkçe kayıtlar, katalog dahil) döner; `overview` `translation_drafts` sayısını verir. Genel katalogda kayıtlar
`title_en`, `text_en`, `en_page`; eserler `name_en`, `site_notice_en` (özet: `name_en`, `lead_en`) taşır.

### R6.17: soru çevirisi, diğer adlar ve adres
- Çeviri gövdesi isteğe bağlı `quest_en: {question, choices[], explanation}` ve `note` (taslağı hazırlayanın notu) alır.
  Şıklar Türkçe soruyla **aynı sayıda ve aynı sırada** olmalıdır; doğru cevap gönderilmez, Türkçe sorudaki `answer_index`
  kalır (doğrulama sunucuda değişmez). Türkçe sorusu olmayan kayda İngilizce soru eklenemez (400). Çeviri yanıtı
  `fact_quest` (Türkçe soru, doğru cevapsız), `quest_en` ve `note` taşır. Yayımlanınca katalogda `quest.question_en`,
  `choices_en`, `explanation_en` dolar; İngilizce oyun yalnızca bunları kullanır.
- Eser gövdesi ayrıca `alternative_names_en: string[]` ve `address_en` alır; genel katalogda aynı adla görünür.
- **İngilizce taslaklar:** `backend/content_drafts/bursa_en_r617.json` (10 eser, 75 kayıt, 34 soru; 1 kayıt kitabın
  İngilizce bölümünde karşılığı bulunmadığı için gerekçesiyle atlandı). Her kayıt kitabın İngilizce bölümünden birebir
  alıntı ve PDF sayfası taşır; Türkçe kayıtla kitap arasındaki farklar `note` alanındadır. Depoya aktarma:
  `python scripts/import_english_drafts.py --content-dir <VAKIFNAME_CONTENT_DIR> --catalog <katalog>` (kitaplar
  depoda SHA-256 ile eşlenir; yoksa `--pdf cilt-1=<yol> --pdf cilt-2=<yol>`). Varsayılan olarak **hiçbir şey
  yayımlanmaz**: taslaklar `/yonetim/icerik` → eser → "Kayıtların İngilizcesi" listesinde yönetici onayını bekler.
  `--publish-local-test` yalnızca ayrı bir yerel deneme deposu içindir (onay aktörü "yerel-test").
- **Kapsam raporu:** `python scripts/report_en_coverage.py --catalog <katalog> [--content-dir <depo>]` (eser başına
  onaylı İngilizce, taslak sayısı, kamuya görünen sunucu mesajlarının sözlükteki karşılığı); arayüz katmanı için
  `npm run check:i18n` (frontend).
