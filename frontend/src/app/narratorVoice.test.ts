import { describe, expect, it } from 'vitest'
import { FIGURE_VOICE } from './components/GuideFigure'
import { VOICE_ERKEK, VOICE_KADIN } from './narratorVoice'
import { pickTurkishVoice, pickVoice } from './speech'

// R3.3: anlatıcı ses profili rehber çizimine bağlıdır. Sistem sesi adları örnektir (Windows/macOS/Chrome).
const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice
const SYSTEM = [
  v('Microsoft Seda - Turkish (Turkey)', 'tr-TR'), v('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'), v('Yelda', 'tr-TR'),
  v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft David - English (United States)', 'en-US'), v('Moira', 'en-IE'),
]

describe('anlatıcı ses profili', () => {
  it('8 Kasım: rehber kadın profile bağlıdır (Zülal); erkek profilin izinli kaydı yok (sunucu sesi tanımsız)', () => {
    expect(FIGURE_VOICE).toBe(VOICE_KADIN)
    expect(VOICE_ERKEK.gender).toBe('male')
    expect(VOICE_ERKEK.serverVoice).toEqual({ tr: null, en: null })
  })

  it('kadın anlatıcı profili ve izinli sesi (zulal-1, TR + EN)', () => {
    expect(VOICE_KADIN.gender).toBe('female')
    expect(VOICE_KADIN.serverVoice).toEqual({ tr: 'zulal-1', en: 'zulal-1' })
    expect(pickTurkishVoice(SYSTEM)!.name).toBe('Yelda')  // varsayılan profil: eski davranış birebir
    expect(pickVoice([v('Yelda', 'tr-TR'), v('Microsoft Tolga', 'tr-TR')], 'tr')!.name).toBe('Yelda')
  })

  it('erkek profilde tarayıcı yedeği erkek sistem sesini öne alır; "female" adı "male" sayılmaz', () => {
    expect(pickVoice(SYSTEM, 'tr', VOICE_ERKEK)!.name).toMatch(/Tolga/)
    expect(pickVoice(SYSTEM, 'en', VOICE_ERKEK)!.name).toMatch(/David/)
    expect(pickVoice([v('Google Türkçe Female', 'tr-TR'), v('X Male', 'tr-TR')], 'tr', VOICE_ERKEK)!.name).toBe('X Male')
  })

  it('uygun erkek ses yoksa anlatım bozulmaz: o dildeki herhangi bir ses, hiç yoksa okuma modu (null)', () => {
    expect(pickVoice([v('Yelda', 'tr-TR')], 'tr', VOICE_ERKEK)!.name).toBe('Yelda')
    expect(pickVoice([v('Samantha', 'en-US'), v('Moira', 'en-IE')], 'en', VOICE_ERKEK)!.name).toBe('Samantha')
    expect(pickVoice([v('Moira', 'en-IE')], 'en', VOICE_ERKEK)!.name).toBe('Moira')
    expect(pickVoice([v('Samantha', 'en-US')], 'tr', VOICE_ERKEK)).toBeNull()
  })

  it('bu bilgisayarın kurulu sesleriyle (Windows, R3.3 denetimi) erkek profil Tolga ve David’i seçer', () => {
    // (Erkek profil şu an rehbere bağlı değil; profil kuralı korunur.)
    const local = [
      v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Mark - English (United States)', 'en-US'),
      v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'),
      v('Google Türkçe', 'tr-TR'),
    ]
    expect(pickVoice(local, 'tr', VOICE_ERKEK)!.name).toBe('Microsoft Tolga - Turkish (Turkey)')
    expect(pickVoice(local, 'en', VOICE_ERKEK)!.name).toBe('Microsoft David - English (United States)')
  })
})
