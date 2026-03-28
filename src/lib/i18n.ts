export type Locale = 'en' | 'es' | 'zh' | 'ja'

export const LOCALES: Locale[] = ['en', 'es', 'zh', 'ja']

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  zh: '中文',
  ja: '日本語',
}

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  zh: '🇨🇳',
  ja: '🇯🇵',
}

import en from './i18n/en.json'
import es from './i18n/es.json'
import zh from './i18n/zh.json'
import ja from './i18n/ja.json'

const translations: Record<Locale, Record<string, string>> = {
  en,
  es,
  zh,
  ja,
}

export async function t(
  locale: Locale,
  key: string,
  params?: Record<string, string>
): Promise<string> {
  const dict = translations[locale] ?? translations['en']
  let text = dict[key] ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
    }
  }

  return text
}

export function getLocale(request: Request): Locale {
  const url = new URL(request.url)
  const langParam = url.searchParams.get('lang')
  if (langParam && LOCALES.includes(langParam as Locale)) {
    return langParam as Locale
  }

  const cookieHeader = request.headers.get('Cookie') ?? ''
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [k, ...v] = c.trim().split('=')
      return [k, v.join('=')]
    })
  )

  if (cookies.lectern_lang && LOCALES.includes(cookies.lectern_lang as Locale)) {
    return cookies.lectern_lang as Locale
  }

  const acceptLang = request.headers.get('Accept-Language')
  if (acceptLang) {
    const preferred = acceptLang
      .split(',')
      .map((s) => s.split(';')[0].trim().toLowerCase())
      .find((lang) => {
        const base = lang.split('-')[0]
        return LOCALES.includes(base as Locale)
      })
    if (preferred) {
      const base = preferred.split('-')[0] as Locale
      if (LOCALES.includes(base)) return base
    }
  }

  return 'en'
}
