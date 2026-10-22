const STEPS = [
  {
    title: 'Bir eser keşfet.',
    text: 'Listeden ya da haritadan bir eser seç; ayrıntılarını ve görev alanını incele.',
  },
  {
    title: 'Görevini tamamla.',
    text: 'Eserin görev alanında demo check-in yap. Sonuç yalnızca backend onaylarsa kabul edilir.',
  },
  {
    title: 'Mührünü topla.',
    text: 'Kazandığın her mühür dijital pasaportuna eklenir; kayıp vakfiyenin izini mühür mühür sür.',
  },
]

/** Yeni tasarımın "Merak edin. İzini sürün." bölümü, oyun akışına uyarlandı. */
export function HowItWorks() {
  return (
    <section className="section journey" aria-labelledby="journey-title">
      <div className="container journey__inner">
        <div>
          <h2 id="journey-title" className="journey__title">
            Merak et.
            <br />
            İzini sür.
          </h2>
          <p className="section__lead">VAKIFNAME nasıl oynanır?</p>
        </div>
        <ol className="journey__list">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="journey__number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
