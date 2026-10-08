import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { amp } from '@nanocore/protocol';
import { fx2 } from '@nanocore/protocol';
import {
  PROFILE_FIRST_FX2_SLOT,
  PROFILE_NAME_MAX,
  PROFILE_SLOT_COUNT,
  sanitizeProfileName,
  validateProfileFile,
  type ProfileFileProblem,
} from '@nanocore/protocol';
import { usePatchStore } from '../store/patchStore';

/** Built-in (factory) name for a slot, used before the catalog has been read: 0-29 are the AMP
 * models, 30-37 the FX2 drive/boost models. */
function factoryName(slot: number): string {
  if (slot < PROFILE_FIRST_FX2_SLOT) return amp.types[slot]?.name ?? `Slot ${slot + 1}`;
  return fx2.types.find((type) => type.id === slot - PROFILE_FIRST_FX2_SLOT)?.name ?? `Slot ${slot + 1}`;
}

/**
 * AMP/FX2 profile slots on the device: read the slot catalog and upload a `.ead` profile file into
 * a slot, using the exact command sequence ToneCommand uses (captured from real traffic — see
 * docs/MIDI_MAPPING_NOTES.md, "AMP/FX2 profile upload", and `midi/profileUpload.ts`). Uploading
 * OVERWRITES the slot and this editor cannot restore factory content — only ToneCommand's
 * "Restore Factory Content" can — so the upload is gated behind an explicit confirmation.
 */
export function ProfilePanel() {
  const { t } = useTranslation();
  const connectionReady = usePatchStore((s) => s.connection.ready && !!s.connection.outputId && s.connection.connected);
  const catalog = usePatchStore((s) => s.profileCatalog);
  const upload = usePatchStore((s) => s.profileUpload);
  const readProfileCatalog = usePatchStore((s) => s.readProfileCatalog);
  const uploadProfile = usePatchStore((s) => s.uploadProfile);
  const resetProfileUpload = usePatchStore((s) => s.resetProfileUpload);

  const [slot, setSlot] = useState(0);
  const [file, setFile] = useState<{ fileName: string; data: Uint8Array } | null>(null);
  const [problem, setProblem] = useState<ProfileFileProblem | null>(null);
  const [name, setName] = useState('');
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const slotNames = useMemo(
    () => Array.from({ length: PROFILE_SLOT_COUNT }, (_, i) => catalog?.find((r) => r.slot === i)?.name || factoryName(i)),
    [catalog],
  );
  const running = upload.status === 'running';
  const canUpload = connectionReady && !!file && !problem && !running;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    resetProfileUpload();
    if (!picked) return;
    const data = new Uint8Array(await picked.arrayBuffer());
    const check = validateProfileFile(data);
    setFile({ fileName: picked.name, data });
    setProblem(check.ok ? null : check.problem);
    setName(sanitizeProfileName(picked.name));
  };

  const handleRead = async () => {
    setReading(true);
    setReadFailed(false);
    setReadFailed(!(await readProfileCatalog()));
    setReading(false);
  };

  const handleUpload = async () => {
    if (!file || !canUpload) return;
    const message = t('profiles.confirm', {
      slot: slot + 1,
      current: slotNames[slot],
      name: sanitizeProfileName(name),
      defaultValue:
        'Overwrite slot {{slot}} ("{{current}}") with "{{name}}"?\n\nThis editor cannot put the factory profile back — only ToneCommand\'s "Restore Factory Content" can (it rewrites every AMP and FX2 slot). Keep the cable connected until it finishes.',
    });
    if (!window.confirm(message ?? '')) return;
    await uploadProfile({ slot, data: file.data, name });
  };

  const failureText = () => {
    const failure = upload.failure;
    if (!failure) return null;
    const phase = t(`profiles.phase.${failure.phase}`, failure.phase);
    if (failure.reason === 'slot-out-of-range') return t('profiles.errSlot', 'The device does not have that slot.');
    if (failure.reason === 'device-status')
      return t('profiles.errStatus', { phase, status: failure.status, defaultValue: 'The device rejected the upload during "{{phase}}" (status {{status}}).' });
    return t('profiles.errNoResponse', {
      phase,
      defaultValue: 'No reply from the device during "{{phase}}". Retry; if it keeps failing, power-cycle the NanoCore.',
    });
  };

  return (
    <section className="profile-panel">
      <h2 className="panel-title">{t('profiles.title', 'AMP/FX2 Profiles')}</h2>
      <p className="panel-hint">
        {t(
          'profiles.hint',
          'The NanoCore keeps 38 profile slots: 30 AMP models and 8 FX2 drives. Read what is in them, or upload a .ead profile file into one using the same commands ToneCommand uses.',
        )}
      </p>

      <div className="profile-panel__row">
        <button type="button" className="btn btn--small" disabled={!connectionReady || reading || running} onClick={handleRead}>
          {reading ? t('profiles.reading', 'Reading…') : t('profiles.read', 'Read slots from device')}
        </button>
        {readFailed && <span className="panel-hint">{t('profiles.readFailed', 'No reply from the device.')}</span>}
      </div>

      {catalog && (
        <div className="cc-reference__table-wrap">
          <table className="cc-reference__table">
            <thead>
              <tr>
                <th>{t('profiles.colSlot', 'Slot')}</th>
                <th>{t('profiles.colName', 'Name')}</th>
                <th>{t('profiles.colNote', 'Note')}</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((r) => (
                <tr key={r.slot}>
                  <td className="cc-reference__cc">{r.slot + 1}</td>
                  <td>{r.name || '—'}</td>
                  <td className="cc-reference__range">
                    {r.slot >= PROFILE_FIRST_FX2_SLOT ? t('profiles.kindFx2', 'FX2') : t('profiles.kindAmp', 'AMP')}
                    {r.lastWritten ? ` · ${t('profiles.lastWritten', 'last written')}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="panel-subtitle">{t('profiles.uploadTitle', 'Upload a profile')}</h3>
      <p className="panel-hint">
        {t(
          'profiles.uploadHint',
          'Overwrites the chosen slot. This editor cannot restore factory content — use ToneCommand\'s "Restore Factory Content" for that. Tested over USB only.',
        )}
      </p>

      <div className="profile-panel__row">
        <label>
          {t('profiles.slot', 'Slot')}{' '}
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} disabled={running}>
            {slotNames.map((n, i) => (
              <option key={i} value={i}>
                {i + 1} — {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="profile-panel__row">
        <button type="button" className="btn btn--ghost btn--small" disabled={running} onClick={() => fileInputRef.current?.click()}>
          {t('profiles.chooseFile', 'Choose .ead file…')}
        </button>
        <input ref={fileInputRef} type="file" accept=".ead" hidden onChange={handleFile} />
        {file && (
          <span className="panel-hint">
            {file.fileName} · {file.data.length} B
          </span>
        )}
      </div>
      {problem && <p className="connection-panel__error">{t(`profiles.problem.${problem}`, problem)}</p>}

      <div className="profile-panel__row">
        <label>
          {t('profiles.name', 'Slot name')}{' '}
          <input type="text" value={name} maxLength={PROFILE_NAME_MAX} onChange={(e) => setName(e.target.value)} disabled={running} />
        </label>
      </div>

      <div className="profile-panel__row">
        <button type="button" className="btn btn--accent" disabled={!canUpload} onClick={handleUpload}>
          {running ? t('profiles.uploading', 'Uploading…') : t('profiles.upload', 'Upload to slot')}
        </button>
      </div>

      {upload.status !== 'idle' && (
        <div className="profile-panel__status">
          {upload.status === 'running' && (
            <>
              <progress value={upload.sent} max={Math.max(upload.total, 1)} />
              <span className="panel-hint">
                {t(`profiles.phase.${upload.phase ?? 'info'}`, upload.phase ?? '')} · {upload.sent} / {upload.total} B
              </span>
            </>
          )}
          {upload.status === 'done' && (
            <p className="connection-panel__success">
              {t('profiles.done', { slot: (upload.slot ?? 0) + 1, defaultValue: 'Uploaded to slot {{slot}}.' })}
            </p>
          )}
          {upload.status === 'error' && <p className="connection-panel__error">{failureText()}</p>}
        </div>
      )}
    </section>
  );
}
