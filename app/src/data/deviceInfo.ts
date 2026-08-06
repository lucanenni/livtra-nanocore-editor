/**
 * Reference-only content from the User Manual that isn't part of the MIDI parameter map:
 * hardware specifications, connectivity, and companion software. Shown in the "About" panel
 * so the editor doubles as a quick-reference card for the device itself.
 */

export interface SpecRow {
  label: string;
  value: string;
}

export const specifications: SpecRow[] = [
  { label: 'A/D/A Conversion', value: '24-bit' },
  { label: 'Sample Rate', value: '44.1 kHz' },
  { label: 'Signal-to-Noise Ratio', value: '103 dB' },
  { label: 'Bluetooth Frequency Band', value: '2400–2483.5 MHz (2.4 GHz ISM band)' },
  { label: 'Max RF Power', value: '6.4 dBm EIRP' },
  { label: 'Effect Modules', value: 'Max 8+1 effect modules' },
  { label: 'Presets', value: '64 preset slots, 40 factory presets' },
  { label: 'Input', value: '6.35 mm (1/4") unbalanced TS jack, 1 MΩ impedance' },
  { label: 'Output', value: '6.35 mm (1/4") unbalanced TS jack, 100 Ω impedance' },
  { label: 'Headphone Output', value: '3.5 mm (1/8") TRS stereo jack, 16 Ω impedance' },
  { label: 'USB Interface', value: 'USB 2.0 Type-C' },
  { label: 'USB Recording', value: '44.1 kHz / 24-bit' },
  { label: 'Dimensions', value: '90.5 × 55.5 × 36.7 mm (L×W×H)' },
  { label: 'Weight', value: '≈126 g' },
  { label: 'Power Requirement', value: 'USB-C, DC 5V 1A' },
  { label: 'Built-in Battery', value: '1300 mAh lithium battery, supports pass-through charging' },
  { label: 'Included Accessories', value: 'USB-C cable, user manual, back-clip accessory' },
];

export const bluetoothInfo = {
  intro:
    'The NanoCore has a fully independent dual-mode Bluetooth module. Both modes can be turned on or off independently without interfering with each other.',
  modes: [
    {
      name: 'NanoCore Audio (BT Audio)',
      description:
        "Receives media audio from a phone or tablet. Once connected, your phone's music can be used as a backing track routed into the effects processor.",
    },
    {
      name: 'NanoCore MIDI (Wireless MIDI)',
      description:
        'Connects to the official mobile app for bidirectional parameter sync, control and editing — the wireless counterpart to this editor.',
    },
  ],
  note: 'The NanoCore MIDI module stays hidden until first paired from within the official mobile app; it only appears in your phone\'s Bluetooth settings after that initial pairing succeeds.',
};

export const companionSoftware = {
  description:
    'Livtra also publishes a free official companion app for comprehensive device management: tone adjustment, preset import/export, NAM (Neural Amp Modeler) file import, third-party IR loading, and factory reset.',
  platforms: 'Desktop (Windows, macOS) and mobile (Android, iOS).',
  url: 'https://www.livtramusic.com',
};

export const audioInterfaceInfo =
  'The device is a driver-free class-compliant USB audio interface — connect it to a computer and it shows up automatically as "Nanocore". It also supports direct connection to phones/tablets via USB OTG for high-quality on-the-go recording and live streaming.';

export const sourceDocuments = [
  { label: 'NANOCORE User Manual (PDF)', url: 'https://openparcelbox.com/manuals/NANOCORE-User-Manual.pdf' },
  {
    label: 'NANOCORE MIDI Control User Guide (PDF)',
    url: 'https://openparcelbox.com/manuals/NANOCORE-MIDI-Control-User-Guide.pdf',
  },
];
