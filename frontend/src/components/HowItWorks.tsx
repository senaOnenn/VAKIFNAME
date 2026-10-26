export interface Step {
  title: string
  text: string
}


/** Yeni tasarımın "Merak edin. İzini sürün." bölümü. Adımlar kullanan sayfadan gelir (genel platform / demo). */
export function HowItWorks({ steps, lead }: { steps: Step[]; lead: string }) {
  return (
    <section className="section journey" aria-labelledby="journey-title">
      <div className="container journey__inner">
        <div>
          <h2 id="journey-title" className="journey__title">
            Merak et.
            <br />
            İzini sür.
          </h2>
          <p className="section__lead">{lead}</p>
        </div>
        <ol className="journey__list">
          {steps.map((step, index) => (
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
