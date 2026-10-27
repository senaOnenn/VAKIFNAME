import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { monogram, PeopleCards } from './components/PeopleCards'

describe('tarihî kişi kartları', () => {
  it('madalyon baş harfleri unvan ve sıra sayısını atlar', () => {
    expect(monogram('Yıldırım Bayezid')).toBe('YB')
    expect(monogram('Sultan II. Murad')).toBe('M')
    expect(monogram('Cem Sultan ve Şehzade Mustafa')).toBe('CM')
    expect(monogram('Osman Gazi')).toBe('OG')
  })

  it('kişi adına konuşmaz: rol, ad, kaydın metni ve kaynağını gösterir; kesin olmayan bilgi etiketlenir', () => {
    render(
      <PeopleCards
        people={[
          { name: 'Osman Gazi', role: 'medfun', role_label: 'Burada yatıyor', fact_id: 'F7', text: 'Türbede on yedi sanduka bulunur.', certainty: 'documented', source: 'Cilt I, s. 40' },
          { name: 'Sultan Abdülaziz', role: 'yeniden_yaptiran', role_label: 'Yeniden yaptıran', fact_id: 'F4', text: 'Bugünkü türbeyi 1863’te yeniden yaptırmıştır.', certainty: 'uncertain', source: 'Cilt I, s. 41' },
        ]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Osman Gazi' })).toBeInTheDocument()
    expect(screen.getByText('Burada yatıyor')).toBeInTheDocument()
    expect(screen.getByText('Türbede on yedi sanduka bulunur.')).toBeInTheDocument()
    expect(screen.getByText(/Kaynak: Cilt I, s\. 40/)).toBeInTheDocument()
    expect(screen.getAllByText('Kesin değil')).toHaveLength(1)
  })

  it('kişi yoksa hiçbir şey çizmez', () => {
    const { container } = render(<PeopleCards people={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
