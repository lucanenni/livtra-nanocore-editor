/**
 * Minimal ambient typings for the Web Bluetooth API — not part of the default TypeScript DOM
 * lib. Covers only what BleMidiTransport uses (GATT connect + one characteristic write).
 */
interface BluetoothRemoteGATTCharacteristic {
  readonly uuid: string;
  readonly properties: {
    readonly write: boolean;
    readonly writeWithoutResponse: boolean;
    readonly notify: boolean;
    readonly read: boolean;
  };
  writeValue(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse(value: Uint8Array): Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}

interface RequestDeviceOptions {
  filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>;
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface Bluetooth {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
}

interface Navigator {
  readonly bluetooth?: Bluetooth;
}
