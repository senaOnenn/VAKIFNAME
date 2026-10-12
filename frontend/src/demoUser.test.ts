import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_USER_STORAGE_KEY, getDemoUserId, resetDemoUserIdForTests } from './demoUser'

afterEach(() => {
  window.sessionStorage.clear()
  resetDemoUserIdForTests()
})

describe('demo oyuncu kimliği', () => {
  it('oturum içinde aynı kimliği döndürür ve sessionStorage’da tutar', () => {
    const id = getDemoUserId()
    expect(id).toMatch(/^demo-[A-Za-z0-9-]+$/)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(getDemoUserId()).toBe(id)
    expect(window.sessionStorage.getItem(DEMO_USER_STORAGE_KEY)).toBe(id)
  })

  it('sayfa yeniden yüklenince (modül belleği sıfırlanınca) aynı oturumda aynı kimlik okunur', () => {
    const id = getDemoUserId()
    resetDemoUserIdForTests()
    expect(getDemoUserId()).toBe(id)
  })

  it('yeni oturumda farklı bir kimlik üretir', () => {
    const first = getDemoUserId()
    window.sessionStorage.clear()
    resetDemoUserIdForTests()
    expect(getDemoUserId()).not.toBe(first)
  })

  it('bozuk veya çok uzun kayıtlı değeri kullanmaz', () => {
    window.sessionStorage.setItem(DEMO_USER_STORAGE_KEY, `demo-${'x'.repeat(80)}`)
    const id = getDemoUserId()
    expect(id.length).toBeLessThanOrEqual(64)
    expect(window.sessionStorage.getItem(DEMO_USER_STORAGE_KEY)).toBe(id)
  })

  it('sessionStorage kullanılamazsa bellekte tutarlı bir kimlik kullanır', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const id = getDemoUserId()
    expect(getDemoUserId()).toBe(id)
  })
})
