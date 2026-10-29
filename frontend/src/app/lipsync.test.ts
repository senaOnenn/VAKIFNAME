import { describe, expect, it } from 'vitest'
import { mouthAt, mouthFrom, visemes } from './lipsync'

describe('ağız senkronu (metinden ağız şekli)', () => {
  it('Türkçe harfleri ağız şekline çevirir; aynı şekiller birleşir', () => {
    expect(visemes('Ama').map((v) => v.shape)).toEqual(['D', 'A', 'D'])
    expect(visemes('fol').map((v) => v.shape)).toEqual(['G', 'E', 'H'])
    expect(visemes('üç').map((v) => v.shape)).toEqual(['F', 'B'])
    expect(visemes('İzmir').map((v) => v.shape)).toEqual(['B', 'A', 'B'])
    expect(visemes('Ilık').map((v) => v.shape)).toEqual(['C', 'H', 'C', 'B'])
  })

  it('noktalama duraksama, boşluk kısa dinlenmedir; rakam birkaç hece sayılır', () => {
    const v = visemes('a. b')
    expect(v.map((x) => x.shape)).toEqual(['D', 'X', 'A'])
    expect(v[1].w).toBeGreaterThan(2)
    expect(visemes('1399')[0]).toMatchObject({ shape: 'C' })
  })

  it('ilerlemeye göre şekil: başta ve sonda dinlenme', () => {
    const seq = visemes('ama')
    expect(mouthAt(seq, 0)).toBe('X')
    expect(mouthAt(seq, 0.1)).toBe('D')
    expect(mouthAt(seq, 0.5)).toBe('A')
    expect(mouthAt(seq, 1)).toBe('X')
  })

  it('kelime sınırından itibaren geçen süreyle şekil (tarayıcı sesi)', () => {
    const seq = visemes('bu ev')
    const at = 'bu ev'.indexOf('ev')
    expect(mouthFrom(seq, at, 0, 70)).toBe('C')
    expect(mouthFrom(seq, at, 100, 70)).toBe('G')
    expect(mouthFrom(seq, at, 10_000, 70)).toBe('X')
    expect(mouthFrom(seq, 99, 0, 70)).toBe('X')
  })
})
