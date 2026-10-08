import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();

  return (
    <label className="language-switcher">
      <span className="visually-hidden">{t('language.label', 'Language')}</span>
      <select value={i18n.language} onChange={(e) => i18n.changeLanguage(e.target.value)}>
        {SUPPORTED_LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
