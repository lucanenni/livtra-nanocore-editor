import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import it from './locales/it.json';
import ptBR from './locales/pt-BR.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt-BR', label: 'Português (Brasil)' },
];

const STORAGE_KEY = 'nanocore-editor.language';

/** The viewer's last choice, else the first browser language we have (pt-PT also gets pt-BR),
 * else English. Storage can be unavailable (private mode, sandboxed previews), hence the guards. */
function initialLanguage(): string {
  const supported = SUPPORTED_LANGUAGES.map((l) => l.code);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && supported.includes(saved)) return saved;
  } catch {
    // ignore
  }
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
  for (const lang of preferred) {
    const base = lang.toLowerCase().split('-')[0];
    const match = supported.find((code) => code.toLowerCase() === lang.toLowerCase()) ?? supported.find((code) => code.toLowerCase().split('-')[0] === base);
    if (match) return match;
  }
  return 'en';
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    it: { translation: it },
    'pt-BR': { translation: ptBR },
  },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // Data-driven content (effect/param names & descriptions from data/blocks/*) is passed
  // through t(key, englishDefault) at the call site rather than duplicated in every locale
  // file. Locale files only need to override the keys they actually translate.
  returnEmptyString: false,
});

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng);
  } catch {
    // ignore
  }
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
});

export default i18n;
