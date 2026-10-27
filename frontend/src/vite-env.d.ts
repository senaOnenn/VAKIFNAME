/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** Giriş videosunun adresi (ör. CDN). Verilmezse derlemeye kopyalanan `/media/hero.mp4` kullanılır. */
  readonly VITE_HERO_VIDEO_URL?: string
  /** Google OAuth Web istemci kimliği (gizli değil). Boşsa Google girişi kapalıdır. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
