import { useTranslation } from 'react-i18next';
import { usePatchStore } from '../store/patchStore';
import { getRoutingConflict } from '../store/routing';

/** Shown on the MOD block editor when FX2 is currently set to Pitch / Envelope Wah / Wah,
 * which silently repurposes MOD's CC68-73 for FX2 instead (see MIDI_MAPPING_NOTES.md). */
export function RoutingWarning() {
  const { t } = useTranslation();
  const patch = usePatchStore((s) => s.patch);
  const conflict = getRoutingConflict(patch);

  if (!conflict.active) return null;

  return (
    <div className="routing-warning" role="alert">
      {t('routing.warning', {
        type: t(`type.fx2.${conflict.fx2TypeName.toLowerCase().replace(/\s+/g, '_')}.name`, conflict.fx2TypeName),
        defaultValue:
          "FX2 is set to {{type}}, which reuses MOD's parameter CCs (68-73). Editing MOD parameters right now will actually change FX2's {{type}} instead.",
      })}
    </div>
  );
}
