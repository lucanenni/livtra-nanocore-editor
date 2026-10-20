import {
  Activity,
  AudioWaveform,
  BrainCircuit,
  Cable,
  FoldVertical,
  Guitar,
  Info,
  KeyboardMusic,
  ListMusic,
  RadioReceiver,
  Repeat,
  Settings,
  SlidersVertical,
  Sparkles,
  Speaker,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/** One Lucide icon per sidebar section and per effect block, drawn in `currentColor` so it follows
 * the text color in both themes and in active/accent states. */
const ICONS: Record<string, LucideIcon> = {
  // Sidebar sections
  chain: Cable,
  presets: ListMusic,
  profiles: BrainCircuit, // NAM = Neural Amp Modeler captures
  global: Settings,
  ccref: KeyboardMusic,
  tuner: Guitar,
  log: Activity,
  info: Info,

  // Effect blocks
  fx1: FoldVertical, // gate / compressor: dynamics squeezed in
  fx2: Zap, // drive, boost, wah, pitch
  amp: RadioReceiver, // an amp head: a box with knobs
  cab: Speaker,
  mod: AudioWaveform,
  del: Repeat,
  rev: Sparkles,
  eq: SlidersVertical,
};

interface Props {
  name: string;
  size?: number;
  className?: string;
}

/** Decorative: always paired with a visible text label, so hidden from assistive tech. */
export function Icon({ name, size = 18, className }: Props) {
  const Component = ICONS[name];
  if (!Component) return null;
  return <Component className={['icon', className].filter(Boolean).join(' ')} size={size} strokeWidth={1.75} aria-hidden focusable="false" />;
}
