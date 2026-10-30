import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getMonument, mediaUrl, progressId, startQuiz, submitQuiz, useLoad, type Quiz, type QuizQuestion, type QuizResult } from '../api'
import { Seal } from '../components/Seal'
import { creditIn, nameOf } from '../contentLang'
import { useLang } from '../i18n'
import { useAuth } from '../session'
import './discover.css'
import './monument.css'
import './quiz.css'

function QuestionView({ q, value, onChange }: { q: QuizQuestion; value: number | undefined; onChange: (v: number) => void }) {
  const { t, lang } = useLang()
  if (q.kind === 'true_false') {
    return (
      <div className="vk-q">
        <blockquote className="vk-q__statement">{q.statement}</blockquote>
        <div className="vk-q__tf" role="radiogroup" aria-label={q.prompt}>
          {['Yanlış', 'Doğru'].map((label, i) => (
            <button key={label} type="button" role="radio" aria-checked={value === i} className="vk-q__opt" onClick={() => onChange(i)}>
              {t(label)}
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
          <button key={img.file} type="button" role="radio" aria-checked={value === i} className="vk-q__img" onClick={() => onChange(i)}>
            <img src={mediaUrl(img.file)} alt={t('Seçenek {n}', { n: i + 1 })} />
            {img.attribution && <span className="vk-q__credit">{creditIn(img.attribution, lang)}</span>}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="vk-q__choices" role="radiogroup" aria-label={q.prompt}>
      {q.choices.map((c, i) => (
        <button key={c} type="button" role="radio" aria-checked={value === i} className="vk-q__opt" onClick={() => onChange(i)}>
          {c}
        </button>
      ))}
    </div>
  )
}

/** "Rozeti Al": 5 kısa soru, en az 4 doğru → bilgi mührü. Cevaplar sunucuda değerlendirilir. */
export default function QuizPage() {
  const { id = '' } = useParams()
  const { t, lang } = useLang()
  const auth = useAuth()
  const uid = progressId(auth)
  const monument = useLoad((s) => getMonument(id, s), [id])
  const [attempt, setAttempt] = useState(0)
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [error, setError] = useState('')
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [busy, setBusy] = useState(false)
  const started = useRef(-1)

  useEffect(() => {
    if (auth.status === 'loading' || started.current === attempt) return
    started.current = attempt // React StrictMode çift çağrısında ikinci sınav açılmasın
    setQuiz(null)
    setResult(null)
    setAnswers({})
    setIdx(0)
    setError('')
    startQuiz(id, uid, lang).then(setQuiz, (e) => setError(e instanceof ApiError ? e.message : t('Sorular hazırlanamadı.')))
  }, [id, uid, attempt, auth.status]) // dil değişince açık oyun yeniden başlamaz; yeni denemede yeni dil kullanılır

  async function submit() {
    if (!quiz) return
    setBusy(true)
    try {
      setResult(await submitQuiz(quiz.quiz_id, uid, quiz.questions.map((q) => ({ qid: q.qid, choice: answers[q.qid] }))))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Cevaplar gönderilemedi.'))
    } finally {
      setBusy(false)
    }
  }

  const name = monument.data ? nameOf(monument.data, lang) : t('Eser')
  const turkishOnly = lang === 'en' && quiz?.lang === 'tr'
  const back = <Link to={`/eser/${encodeURIComponent(id)}`} className="vk-btn vk-btn--ghost">← {t('Esere dön')}</Link>

  if (error)
    return (
      <main className="vk-page vk-quiz">
        <h1 className="vk-quiz__title">{t('Rozeti al')} · {name}</h1>
        <p className="vk-page__state vk-page__state--error" role="alert">{error}</p>
        {back}
      </main>
    )

  if (result) {
    const byId = new Map(quiz?.questions.map((q) => [q.qid, q]))
    return (
      <main className="vk-page vk-quiz">
        <section className={`vk-quiz__result${result.passed ? ' is-passed' : ''}`} aria-live="polite">
          <Seal kind={result.passed ? 'knowledge' : 'empty'} label={result.passed ? t('Bilgi mührü') : t('Mühür kazanılmadı')} stamp={result.passed} size={140} />
          <h1>{result.passed ? t('Bilgi mührünü kazandın!') : t('Bu sefer olmadı')}</h1>
          <p>
            {t('{total} sorudan {score} doğru.', { total: result.total, score: result.score })}{' '}
            {result.passed ? t('Kayıp Vakfiye’nin bir parçası yerine oturdu. Eseri ziyaret edersen mührün altına dönüşür.') : t('Mühür için en az 4 doğru gerekiyordu. Anlatımı yeniden dinleyip tekrar deneyebilirsin.')}
          </p>
          <div className="vk-quiz__actions">
            {result.passed ? (
              <Link to="/pasaport" className="vk-btn">{t('Pasaportuma bak')}</Link>
            ) : (
              <button type="button" className="vk-btn" onClick={() => setAttempt((a) => a + 1)}>{t('Yeniden dene')}</button>
            )}
            {back}
          </div>
        </section>
        <section className="vk-quiz__review" aria-labelledby="degerlendirme">
          <h2 id="degerlendirme">{t('Cevapların')}</h2>
          <ol>
            {result.results.map((r, i) => {
              const q = byId.get(r.qid)
              return (
                <li key={r.qid} className={r.correct ? 'is-correct' : 'is-wrong'}>
                  <p className="vk-quiz__q">{i + 1}. {q?.prompt}</p>
                  <p className="vk-quiz__verdict">{r.correct ? t('Doğru') : t('Yanlış')}</p>
                  <p>{r.explanation}</p>
                  {r.fact && (
                    <p className="vk-quiz__src">
                      {r.fact.certainty && r.fact.certainty !== 'documented' && (
                        <span className="vk-cert vk-cert--uncertain">{r.fact.certainty === 'reported' ? t('Rivayet') : t('Kesin değil')}</span>
                      )}{' '}
                      {t('Kaynak:')} {typeof r.fact.source === 'string' ? r.fact.source : '—'}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      </main>
    )
  }

  if (!quiz)
    return (
      <main className="vk-page vk-quiz">
        <h1 className="vk-sr-only">{t('Rozeti al')} · {name}</h1>
        <p className="vk-page__state" role="status">{t('Sorular hazırlanıyor…')}</p>
      </main>
    )

  const q = quiz.questions[idx]
  const last = idx === quiz.questions.length - 1
  const allAnswered = quiz.questions.every((x) => answers[x.qid] !== undefined)
  return (
    <main className="vk-page vk-quiz">
      <header className="vk-page__head">
        <p className="vk-page__eyebrow">{t('Rozeti al')} · {name}</p>
        <div className="vk-quiz__dots" aria-hidden="true">
          {quiz.questions.map((x, i) => (
            <span key={x.qid} className={`${i === idx ? 'is-here' : ''} ${answers[x.qid] !== undefined ? 'is-set' : ''}`} />
          ))}
        </div>
        <p className="vk-quiz__count">{t('Soru {n} / {total}', { n: idx + 1, total: quiz.questions.length })}</p>
        <h1 className="vk-quiz__prompt" lang={turkishOnly ? 'tr' : undefined}>{q.prompt}</h1>
        {turkishOnly && (
          <p className="vk-quiz__note">{t('Bu eser için yeterli onaylı İngilizce kayıt yok; sorular Türkçe.')}</p>
        )}
      </header>
      <QuestionView q={q} value={answers[q.qid]} onChange={(v) => setAnswers((a) => ({ ...a, [q.qid]: v }))} />
      <div className="vk-quiz__nav">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() => setIdx(idx - 1)} disabled={idx === 0}>{t('Önceki')}</button>
        {last ? (
          <button type="button" className="vk-btn" onClick={() => void submit()} disabled={!allAnswered || busy}>
            {busy ? t('Gönderiliyor…') : t('Cevapları gönder')}
          </button>
        ) : (
          <button type="button" className="vk-btn" onClick={() => setIdx(idx + 1)} disabled={answers[q.qid] === undefined}>{t('Sonraki')}</button>
        )}
      </div>
    </main>
  )
}
