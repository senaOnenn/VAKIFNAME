import type { Mouth } from '../lipsync'
import src320 from '../../assets/guide/rehber-kadin-320.webp'
import src480 from '../../assets/guide/rehber-kadin-480.webp'
import src640 from '../../assets/guide/rehber-kadin-640.webp'
import './guide-character.css'

/**
 * R3.3: kurgusal yerel rehber (tarihî bir kişi değildir; K4). Tek bir şeffaf portre, durağan.
 * 8 Kasım: kadın rehber ("Nakışlı Kaftanlı Bilge Kadın"; sesi Zülal'in izinli klon sesi). Kaynak:
 * `src/assets/guide/rehber-kadin.png` (kare tuvale ortalandı); WebP sürümleri ondan üretildi (320/480/640 px). Önceki erkek
 * portre (`rehber-osmanli*`) dosyalarda duruyor.
 *
 * Ağız hareketi: tek portreden güvenilir ağız hareketi üretilemez; sahte animasyon yapılmaz. `MOUTH_FRAMES` boş olduğu
 * sürece portre DURAĞANDIR; konuşma yalnızca arkadaki ışıkla belirtilir, ses ve altyazı aynen çalışır.
 * Varyant eklemek için: portreyle AYNI kadraj ve boyutta, yalnızca ağız bölgesi farklı şeffaf kareler üretilir
 * (`lipsync.ts` şekilleri: A kapalı m/b/p, B hafif açık, C açık e, D geniş a, E yuvarlak o, F büzük u, G f/v, H l;
 * X = portrenin kendisi) ve burada içe aktarılır, ör. `import mouthD from '../../assets/guide/rehber-osmanli-mouth-D.webp'`
 * → `MOUTH_FRAMES = { D: mouthD, ... }`. Kare portrenin üstüne tam örtüşerek konur; anlatıcı ağız senkronunu kendiliğinden açar.
 */
export const MOUTH_FRAMES: Partial<Record<Exclude<Mouth, 'X'>, string>> = {}

/** Ağız varyantı varsa anlatıcı ağız senkronunu hesaplar; yoksa hesaplamaz (boşuna kare döngüsü çalışmaz). */
export const PORTRAIT_LIP_SYNC = Object.keys(MOUTH_FRAMES).length > 0

export function GuidePortrait({ mouth = 'X', speaking = false, className = '' }: { mouth?: Mouth; speaking?: boolean; className?: string }) {
  const frame = mouth === 'X' ? undefined : MOUTH_FRAMES[mouth]
  return (
    <div
      className={`vk-gchar vk-gchar--portrait${speaking ? ' is-speaking' : ''} ${className}`}
      aria-hidden="true"
      data-lip-sync={PORTRAIT_LIP_SYNC ? 'on' : 'off'}
    >
      <img
        className="vk-gchar__img"
        src={src480}
        srcSet={`${src320} 320w, ${src480} 480w, ${src640} 640w`}
        sizes="(max-width: 640px) 46vw, 240px"
        width={640}
        height={640}
        alt=""
        decoding="async"
        draggable={false}
      />
      {frame && <img className="vk-gchar__img vk-gchar__mouth" src={frame} width={640} height={640} alt="" draggable={false} />}
    </div>
  )
}
