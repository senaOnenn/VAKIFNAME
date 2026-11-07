import { describe, expect, it } from 'vitest'
import { FIGURE_VOICE } from './components/GuideFigure'
import { VOICE_ERKEK, VOICE_ZULAL } from './narratorVoice'
import { pickTurkishVoice, pickVoice } from './speech'

// R3.3: anlatıcı ses profili rehber çizimine bağlıdır. Sistem sesi adları örnektir (Windows/macOS/Chrome).
const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice
const SYSTEM = [
  v('Microsoft Seda - Turkish (Turkey)', 'tr-TR'), v('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'), v('Yelda', 'tr-TR'),
  v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft David - English (United States)', 'en-US'), v('Moira', 'en-IE'),
]

describe('anlatıcı ses profili', () => {
  it('Osmanlı rehberi erkek profile bağlıdır; izinli erkek kaydı henüz yok (sunucu sesi tanımsız)', () => {
    expect(FIGURE_VOICE).toBe(VOICE_ERKEK)
    expect(VOICE_ERKEK.gender).toBe('male')
    expect(VOICE_ERKEK.serverVoice).toEqual({ tr: null, en: null })
  })

  it('önceki kadın anlatıcı profili ve izinli sesi (zulal-1) korunur', () => {
    expect(VOICE_ZULAL.gender).toBe('female')
    expect(VOICE_ZULAL.serverVoice.tr).toBe('zulal-1')
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
    const local = [
      v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Mark - English (United States)', 'en-US'),
      v('Microsoft Zira - English (United States)', 'en-US'), v('Microsoft Tolga - Turkish (Turkey)', 'tr-TR'),
      v('Google Türkçe', 'tr-TR'),
    ]
    expect(pickVoice(local, 'tr', FIGURE_VOICE)!.name).toBe('Microsoft Tolga - Turkish (Turkey)')
    expect(pickVoice(local, 'en', FIGURE_VOICE)!.name).toBe('Microsoft David - English (United States)')
  })
})
