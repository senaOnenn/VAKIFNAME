// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { inspectHeroVideo, parseRange } from './heroVideo.ts'

describe('giriş videosu dağıtımı', () => {
  it('yalnızca gerçek MP4 dosyasını kabul eder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hero-'))
    const mp4 = join(dir, 'a.mp4')
    writeFileSync(mp4, Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(40)]))
    const html = join(dir, 'b.mp4')
    writeFileSync(html, '<html>bu bir video değil</html>')
    expect(inspectHeroVideo(mp4)).toEqual({ ok: true, size: 52 })
    expect(inspectHeroVideo(html)).toEqual({ ok: false, reason: 'MP4 değil' })
    expect(inspectHeroVideo(join(dir, 'yok.mp4'))).toEqual({ ok: false, reason: 'bulunamadı' })
    expect(inspectHeroVideo(dir)).toEqual({ ok: false, reason: 'dosya değil' })
  })

  it('Range başlığını doğru yorumlar', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBe('invalid')
  })
})
