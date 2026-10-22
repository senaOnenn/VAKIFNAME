import { ArchitectureDrawing } from './ArchitectureDrawing'

export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__inner container">
        <div className="hero__content">
          <p className="hero__eyebrow">Bursa’nın Kayıp Vakfiyesi · Yaşayan Miras Oyunu</p>
          <h1 id="hero-title" className="hero__title">
            VAKIFNAME
          </h1>
          <p className="hero__slogan">Geçmişi Keşfet, Mirası Yaşat.</p>
          <p className="hero__text">
            VAKIFNAME, vakıf eserlerini oyunlaştırılmış görevlerle keşfetmek için tasarlanan bir kültürel miras
            platformu. Eserleri listeleyebilir, haritada yerini görebilir, demo keşif görevlerini tamamlayıp dijital
            pasaportunda mühür biriktirebilirsin.
          </p>
          <div className="hero__actions">
            <a className="button button--light" href="#kesfet">
              Eserleri Keşfet
            </a>
            <a className="hero__link" href="#harita">
              Haritayı aç
            </a>
          </div>
        </div>
        <figure className="hero__drawing">
          <ArchitectureDrawing variant="kubbeli" />
          <figcaption className="hero__caption">
            <span>Osmanlı mimarisinden esinle</span>
            <span>Temsili çizim · Eser fotoğrafı değildir</span>
          </figcaption>
        </figure>
      </div>
      <div className="hero__foot">
        <div className="container hero__foot-inner">
          <p className="hero__motto">Geçmişin İzinde, Bilginin Işığında.</p>
          <a className="hero__foot-link" href="#gorevler">
            İlk görevine başla <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </section>
  )
}
