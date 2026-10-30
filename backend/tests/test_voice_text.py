"""Ses klonu üretimi (30 Ekim): anlatım cümlesinin okunuşa çevrilmesi ve üretilen sesin yazıya dökümünün denetimi
(`scripts/voice/vktext.py`; model gerektirmez)."""

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location("vktext", Path(__file__).resolve().parents[1] / "scripts" / "voice" / "vktext.py")
vk = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vk)


def test_turkish_numbers_and_ordinals():
    assert vk.tr_number(1399) == "bin üç yüz doksan dokuz"
    assert vk.tr_number(1001) == "bin bir" and vk.tr_number(2026) == "iki bin yirmi altı" and vk.tr_number(100) == "yüz"
    assert vk.tr_ordinal(19) == "on dokuzuncu" and vk.tr_ordinal(2) == "ikinci" and vk.tr_ordinal(100) == "yüzüncü"


def test_turkish_reading_keeps_words_and_converts_only_the_reading():
    s = vk.speakable("Minber kapısının üstündeki kitabeye göre yapı Hicrî 802 yılında, yani 1399–1400'de tamamlanmıştır.", "tr")
    assert s == ("Minber kapısının üstündeki kitabeye göre yapı Hicrî sekiz yüz iki yılında, yani bin üç yüz doksan dokuz "
                 "ile bin dört yüzde tamamlanmıştır.")
    assert vk.speakable("Pirinç Han'ı Sultan II. Bayezid yaptırmıştır.", "tr") == "Pirinç Han'ı Sultan İkinci Bayezid yaptırmıştır."
    assert vk.speakable("Süslemeler 19. yüzyıla aittir. 1862'de yapıldı.", "tr") == \
        "Süslemeler on dokuzuncu yüzyıla aittir. Bin sekiz yüz altmış ikide yapıldı."
    assert vk.speakable("Yaklaşık 55 × 69 metrelik", "tr") == "Yaklaşık elli beş çarpı altmış dokuz metrelik"


def test_english_reading():
    assert vk.speakable("Completed in 1399–1400 under Bayezid II, about 55 × 69 metres.", "en") == \
        "Completed in thirteen ninety-nine to fourteen hundred under Bayezid the Second, about fifty-five by sixty-nine metres."
    assert vk.speakable("19th century", "en") == "Nineteenth century"
    assert vk.en_ordinal(21) == "twenty-first" and vk.en_ordinal(12) == "twelfth"


def test_transcript_check_accepts_digits_and_flags_invented_tail():
    assert vk.compare("Yapıyı yirmi kubbe örter.", "Yapıyı 20 kubbe örter.", "tr") == (1.0, 1.0)
    assert vk.compare("Ulu Cami", "ulu camî", "tr")[0] == 1.0  # büyük/küçük harf, şapka
    sim, length = vk.compare("Welcome! I am your guide here.", "Welcome, I am your guide here. I am Tokyo, Jotowishin.", "en")
    assert sim < 0.8 and length > 1.5
    words = [("Welcome,", 0.5), ("I", 0.7), ("am", 0.8), ("your", 1.0), ("guide", 1.3), ("here.", 1.6), ("I", 2.0),
             ("am", 2.1), ("Tokyo.", 2.6)]
    assert vk.best_cut("Welcome! I am your guide here.", words, "en") == (6, 1.0)  # uydurma ek 1,6 sn'den sonra kesilir


def test_sentence_split_for_long_facts():
    assert vk.sentences("Birinci cümle. İkinci cümle; uzun. Üçüncü!") == ["Birinci cümle.", "İkinci cümle; uzun.", "Üçüncü!"]
    long = "Ulu Cami'yi kimin tasarladığı kesin olarak bilinmiyor; " + "araştırmacılar birçok ad anıyor, " * 8 + "son."
    parts = vk.sentences(long)
    assert len(parts) > 1 and all(len(p) <= 260 for p in parts) and " ".join(parts) == long
