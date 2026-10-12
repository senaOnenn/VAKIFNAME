export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__inner container">
        <p className="hero__eyebrow">Yaşayan Miras Oyunu · KÖK &amp; KOD</p>
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
          <a className="button button--primary" href="#kesfet">
            Eserleri Keşfet
          </a>
          <a className="button button--ghost" href="#harita">
            Haritayı aç
          </a>
        </div>
      </div>
    </section>
  )
}
