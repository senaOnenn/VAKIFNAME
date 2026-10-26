/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  /** Giriş videosunun adresi (ör. CDN). Verilmezse derlemeye kopyalanan `/media/hero.mp4` kullanılır. */
  readonly VITE_HERO_VIDEO_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
