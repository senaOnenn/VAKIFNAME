import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { answerQuestion, getMonument, mediaUrl, openQuestion, progressId, startQuiz, useLoad, type Quiz, type QuizAnswerResult, type QuizQuestion, type QuizResult, type QuizStepResult } from '../api'
import { Seal } from '../components/Seal'
import { creditIn, nameOf } from '../contentLang'
import { gamePath } from '../gameCity'
import { useLang } from '../i18n'
import { usePlayer } from '../player'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'
import './quiz.css'

/** Cevap verildikten sonra şıkların durumu: doğru şık yeşil + ✓, yanlış seçilen kırmızı + ✗ (renk tek başına değil). */
type Reveal = { correct_choice: number; chosen: number | null } | null

function optClass(i: number, reveal: Reveal, base: string): string {
  if (!reveal) return base
  if (i === reveal.correct_choice) return `${base} is-right`
  if (i === reveal.chosen) return `${base} is-wrong`
  return `${base} is-dim`
}

function Mark({ i, reveal }: { i: number; reveal: Reveal }) {
  const { t } = useLang()
  if (!reveal) return null
  if (i === reveal.correct_choice) return <span className="vk-q__mark" aria-label={t('Doğru cevap')}>✓</span>
  if (i === reveal.chosen) return <span className="vk-q__mark" aria-label={t('Senin cevabın, yanlış')}>✗</span>
  return null
}

function QuestionView({ q, value, reveal, disabled, onChange }: {
  q: QuizQuestion
  value: number | undefined
  reveal: Reveal
  disabled: boolean
  onChange: (v: number) => void
}) {
  const { t, lang } = useLang()
  if (q.kind === 'true_false') {
    return (
      <div className="vk-q">
        <blockquote className="vk-q__statement">{q.statement}</blockquote>
        <div className="vk-q__tf" role="radiogroup" aria-label={q.prompt}>
          {['Yanlış', 'Doğru'].map((label, i) => (
            <button key={label} type="button" role="radio" aria-checked={value === i} disabled={disabled}
              className={optClass(i, reveal, 'vk-q__opt')} onClick={() => onChange(i)}>
              {t(label)} <Mark i={i} reveal={reveal} />
            </button>
          )).reverse()}
        </div>
      </div>
    )
  }
  if (q.kind === 'image_pick') {
    return (
      <div className="vk-q__images" role="radiogroup" aria-label={q.prompt}>
        {q.images.map((img, i) => (
          <button key={img.file} type="button" role="radio" aria-checked={value === i} disabled={disabled}
            className={optClass(i, reveal, 'vk-q__img')} onClick={() => onChange(i)}>
            <img src={mediaUrl(img.file)} alt={t('Seçenek {n}', { n: i + 1 })} />
            <Mark i={i} reveal={reveal} />
            {img.attribution && <span className="vk-q__credit">{creditIn(img.attribution, lang)}</span>}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="vk-q__choices" role="radiogroup" aria-label={q.prompt}>
      {q.choices.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === i} disabled={disabled}
          className={optClass(i, reveal, 'vk-q__opt')} onClick={() => onChange(i)}>
          {c} <Mark i={i} reveal={reveal} />
        </button>
      ))}
    </div>
  )
}

/** Kaynak satırı (kesinlik etiketiyle). */
function FactSource({ fact }: { fact: QuizAnswerResult['fact'] }) {
  const { t } = useLang()
  if (!fact) return null
  return (
    <p className="vk-quiz__src">
      {fact.certainty && fact.certainty !== 'documented' && (
        <span className="vk-cert vk-cert--uncertain">{fact.certainty === 'reported' ? t('Rivayet') : t('Kesin değil')}</span>
      )}{' '}
      {t('Kaynak:')} {typeof fact.source === 'string' ? fact.source : '—'}
    </p>
  )
}

/**
 * "Rozeti Al": 5 kısa soru, en az 4 doğru → bilgi mührü. Cevaplar sunucuda değerlendirilir. 7 Kasım: her soru tek tek
 * cevaplanır; cevap hemen değerlendirilir (doğru yeşil + ✓, yanlış kırmızı + ✗, doğru şık gösterilir) ve doğru/yanlış
 * sayısı görünür. Her sorunun süresi 30 sn'dir (sunucu da sayar); süre dolarsa cevap boş gider ve yanlış sayılır.
 */
export default function QuizPage() {
  const { id = '' } = useParams()
  const { t, lang } = useLang()
  const player = usePlayer()
  const auth = useAuth()
  const uid = progressId(auth)
  const monument = useLoad((s) => getMonument(id, s), [id])
  const [attempt, setAttempt] = useState(0)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [error, setError] = useState('')
  const [idx, setIdx] = useState(0)
  const [chosen, setChosen] = useState<Record<string, number | null>>({})
  const [steps, setSteps] = useState<Record<string, QuizStepResult>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [showResult, setShowResult] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deadline, setDeadline] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const started = useRef(-1)

  useEffect(() => {
    if (auth.status === 'loading' || started.current === attempt) return
    started.current = attempt // React StrictMode çift çağrısında ikinci sınav açılmasın
    setQuiz(null)
    setResult(null)
    setShowResult(false)
    setChosen({})
    setSteps({})
    setIdx(0)
    setDeadline(null)
    setError('')
    startQuiz(id, uid, lang).then(setQuiz, (e) => setError(e instanceof ApiError ? e.message : t('Sorular hazırlanamadı.')))
  }, [id, uid, attempt, auth.status]) // dil değişince açık oyun yeniden başlamaz; yeni denemede yeni dil kullanılır

  const q = quiz?.questions[idx]
  const step = q ? steps[q.qid] : undefined
  const total = quiz?.seconds_per_question ?? 30

  // Soru ekrana gelince sunucuda açılır; süre oradan başlar (yeniden açmak süreyi sıfırlamaz).
  useEffect(() => {
    if (!quiz || !q || step) return
    let alive = true
    setDeadline(null)
    openQuestion(quiz.quiz_id, uid, q.qid).then(
      (r) => {
        if (!alive) return
        setNow(Date.now())
        setDeadline(Date.now() + r.seconds_left * 1000)
      },
      (e) => alive && setError(e instanceof ApiError ? e.message : t('Soru açılamadı.')),
    )
    return () => {
      alive = false
    }
  }, [quiz, q?.qid]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (deadline === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [deadline])

  const left = deadline === null ? total : Math.max(0, Math.ceil((deadline - now) / 1000))

  async function answer(choice: number | null) {
    if (!quiz || !q || steps[q.qid] || busy) return
    setBusy(true)
    setDeadline(null)
    setChosen((c) => ({ ...c, [q.qid]: choice }))
    try {
      const r = await answerQuestion(quiz.quiz_id, uid, q.qid, choice)
      setSteps((s) => ({ ...s, [q.qid]: r }))
      if (r.final) {
        setResult(r.final)
        player.refresh() // R6.4: XP sunucuda verildiyse bildirim çıkar
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Cevap gönderilemedi.'))
    } finally {
      setBusy(false)
    }
  }

  // Süre dolunca cevapsız gönderilir (yanlış sayılır).
  useEffect(() => {
    if (deadline !== null && left === 0 && q && !steps[q.qid] && !busy) void answer(null)
  }, [left, deadline]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = monument.data ? nameOf(monument.data, lang) : t('Eser')
  const turkishOnly = lang === 'en' && quiz?.lang === 'tr'
  const back = <Link to={gamePath.monument(id)} className="vk-btn vk-btn--ghost">← {t('Göreve dön')}</Link>

  if (error)
    return (
      <main className="vk-page vk-quiz">
        <h1 className="vk-quiz__title">{t('Rozeti al')} · {name}</h1>
        <p className="vk-page__state vk-page__state--error" role="alert">{error}</p>
        {back}
      </main>
    )

  if (result && showResult) {
    const byId = new Map(quiz?.questions.map((x) => [x.qid, x]))
    return (
      <main className="vk-page vk-quiz">
        <section className={`vk-quiz__result${result.passed ? ' is-passed' : ''}`} aria-live="polite">
          <Seal kind={result.passed ? 'knowledge' : 'empty'} label={result.passed ? t('Bilgi mührü') : t('Mühür kazanılmadı')} stamp={result.passed} size={140} />
          <h1>{result.passed ? t('Bilgi mührünü kazandın!') : t('Bu sefer olmadı')}</h1>
          <p className="vk-quiz__tally vk-quiz__tally--big">
            <span className="is-right">✓ {t('{n} doğru', { n: result.score })}</span>
            <span className="is-wrong">✗ {t('{n} yanlış', { n: result.total - result.score })}</span>
          </p>
          <p>
            {result.passed ? t('Kayıp Vakfiye’nin bir parçası yerine oturdu. Eseri ziyaret edersen mührün altına dönüşür.') : t('Mühür için en az 4 doğru gerekiyordu. Anlatımı yeniden dinleyip tekrar deneyebilirsin.')}
          </p>
          <div className="vk-quiz__actions">
            {result.passed ? (
              <Link to="/pasaport" className="vk-btn">{t('Rozetlerime bak')}</Link>
            ) : (
              <button type="button" className="vk-btn" onClick={() => setAttempt((a) => a + 1)}>{t('Yeniden dene')}</button>
            )}
            {back}
          </div>
        </section>
        <section className="vk-quiz__review" aria-labelledby="degerlendirme">
          <h2 id="degerlendirme">{t('Cevapların')}</h2>
          <ol>
            {result.results.map((r, i) => (
              <li key={r.qid} className={r.correct ? 'is-correct' : 'is-wrong'}>
                <p className="vk-quiz__q">{i + 1}. {byId.get(r.qid)?.prompt}</p>
                <p className="vk-quiz__verdict">
                  {r.correct ? `✓ ${t('Doğru cevap')}` : r.timed_out ? `✗ ${t('Süre doldu')}` : `✗ ${t('Yanlış cevap')}`}
                </p>
                <p>{r.explanation}</p>
                <FactSource fact={r.fact} />
              </li>
            ))}
          </ol>
        </section>
      </main>
    )
  }

  if (!quiz || !q)
    return (
      <main className="vk-page vk-quiz">
        <h1 className="vk-sr-only">{t('Rozeti al')} · {name}</h1>
        <p className="vk-page__state" role="status">{t('Sorular hazırlanıyor…')}</p>
      </main>
    )

  const last = idx === quiz.questions.length - 1
  const done = Object.values(steps)
  const right = done.filter((r) => r.correct).length
  const reveal: Reveal = step ? { correct_choice: step.correct_choice, chosen: chosen[q.qid] ?? null } : null
  return (
    <main className="vk-page vk-quiz">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{t('Rozeti al')} · {name}</p>
        <div className="vk-quiz__dots" aria-hidden="true">
          {quiz.questions.map((x, i) => {
            const r = steps[x.qid]
            return <span key={x.qid} className={`${i === idx ? 'is-here' : ''} ${r ? (r.correct ? 'is-right' : 'is-wrong') : ''}`} />
          })}
        </div>
        <div className="vk-quiz__status">
          <p className="vk-quiz__count">{t('Soru {n} / {total}', { n: idx + 1, total: quiz.questions.length })}</p>
          <p className="vk-quiz__tally" aria-live="polite">
            <span className="is-right">✓ {t('{n} doğru', { n: right })}</span>
            <span className="is-wrong">✗ {t('{n} yanlış', { n: done.length - right })}</span>
          </p>
        </div>
        <h1 className="vk-quiz__prompt" lang={turkishOnly ? 'tr' : undefined}>{q.prompt}</h1>
        {turkishOnly && (
          <p className="vk-quiz__note">{t('Bu eser için yeterli onaylı İngilizce kayıt yok; sorular Türkçe.')}</p>
        )}
        {!step && (
          <div className={`vk-quiz__timer${left <= 10 ? ' is-low' : ''}`} role="timer" aria-label={t('Kalan süre: {n} saniye', { n: left })}>
            <span className="vk-quiz__timer-track" aria-hidden="true">
              <span className="vk-quiz__timer-bar" style={{ transform: `scaleX(${left / total})` }} />
            </span>
            <span className="vk-quiz__timer-n" aria-hidden="true">{t('{n} sn', { n: left })}</span>
            {left === 10 && <span className="vk-sr-only" aria-live="polite">{t('10 saniye kaldı')}</span>}
          </div>
        )}
      </header>
      <QuestionView q={q} value={chosen[q.qid] ?? undefined} reveal={reveal} disabled={!!step || busy || deadline === null}
        onChange={(v) => void answer(v)} />
      {step && (
        <section className={`vk-quiz__feedback ${step.correct ? 'is-right' : 'is-wrong'}`} role="status">
          <p className="vk-quiz__feedback-h">
            {step.correct ? `✓ ${t('Doğru cevap!')}` : step.timed_out ? `✗ ${t('Süre doldu; yanlış sayıldı.')}` : `✗ ${t('Yanlış cevap')}`}
          </p>
          <p>{step.explanation}</p>
          <FactSource fact={step.fact} />
        </section>
      )}
      <div className="vk-quiz__nav">
        {step && (last ? (
          <button type="button" className="vk-btn" onClick={() => setShowResult(true)} disabled={!result}>{t('Sonucu gör')}</button>
        ) : (
          <button type="button" className="vk-btn" onClick={() => setIdx(idx + 1)}>{t('Sonraki soru')}</button>
        ))}
      </div>
    </main>
  )
}
