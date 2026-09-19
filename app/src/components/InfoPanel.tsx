import { useTranslation } from 'react-i18next';
import {
  audioInterfaceInfo,
  bluetoothInfo,
  companionSoftware,
  sourceDocuments,
  specifications,
} from '../data/deviceInfo';
import { nanocoreSpec } from '../data/nanocoreSpec';

export function InfoPanel() {
  const { t } = useTranslation();

  return (
    <section className="info-panel">
      <h2 className="panel-title">{t('info.title', 'About the NanoCore')}</h2>
      <p className="panel-hint">
        {t(
          'info.hint',
          "Reference material from Livtra's own documentation — nothing on this page is editable or transmitted, it's here so you don't have to dig through the PDF.",
        )}
      </p>

      <h3 className="panel-subtitle">{t('info.specifications', 'Specifications')}</h3>
      <dl className="info-panel__spec-list">
        {specifications.map((row) => (
          <div className="info-panel__spec-row" key={row.label}>
            <dt>{t(`info.spec.${row.label}`, row.label)}</dt>
            <dd>{t(`info.specValue.${row.label}`, row.value)}</dd>
          </div>
        ))}
      </dl>

      <h3 className="panel-subtitle">{t('info.bluetooth', 'Bluetooth')}</h3>
      <p>{t('info.bluetoothIntro', bluetoothInfo.intro)}</p>
      <ul className="info-panel__list">
        {bluetoothInfo.modes.map((m) => (
          <li key={m.name}>
            <strong>{m.name}</strong> — {t(`info.bluetoothMode.${m.name}`, m.description)}
          </li>
        ))}
      </ul>
      <p className="panel-hint">{t('info.bluetoothNote', bluetoothInfo.note)}</p>

      <h3 className="panel-subtitle">{t('info.usbAudio', 'USB Audio Interface')}</h3>
      <p>{t('info.usbAudioText', audioInterfaceInfo)}</p>

      <h3 className="panel-subtitle">{t('info.companionSoftware', 'Companion Software')}</h3>
      <p>{t('info.companionSoftwareText', companionSoftware.description)}</p>
      <p className="panel-hint">
        {t('info.companionSoftwarePlatforms', companionSoftware.platforms)}{' '}
        <a href={companionSoftware.url} target="_blank" rel="noreferrer">
          {companionSoftware.url.replace('https://', '')}
        </a>
      </p>

      <h3 className="panel-subtitle">{t('info.sources', 'Source documents')}</h3>
      <ul className="info-panel__list">
        {sourceDocuments.map((doc) => (
          <li key={doc.url}>
            <a href={doc.url} target="_blank" rel="noreferrer">
              {doc.label}
            </a>
          </li>
        ))}
      </ul>
      <p className="panel-hint">
        {t('info.firmware', 'Documentation version: firmware {{fw}}', { fw: nanocoreSpec.meta.firmware })}
      </p>
    </section>
  );
}
