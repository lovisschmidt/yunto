export type ButtonEventType = "single" | "double";

export type ButtonEventPayload = {
  type: ButtonEventType;
};

export type BluetoothScoState = "stop" | "disconnected";

export type BluetoothScoEventPayload = {
  state: BluetoothScoState;
};

export type InputState = {
  builtInUid: string | null;
  bluetoothUid: string | null;
  bluetoothName: string | null;
};

export type HeadphoneButtonModuleEvents = {
  onButtonEvent: (params: ButtonEventPayload) => void;
  onPlaybackComplete: (params: Record<string, never>) => void;
  onAudioInterrupted: (params: Record<string, never>) => void;
  onBluetoothScoChanged: (params: BluetoothScoEventPayload) => void;
  onBluetoothMicAvailabilityChanged: (params: Record<string, never>) => void;
};
