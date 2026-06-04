import { NativeModule, requireNativeModule } from "expo";
import type { HeadphoneButtonModuleEvents, InputState } from "./HeadphoneButton.types";

declare class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  startPcmStream(sampleRate: number, speed: number): void;
  feedPcm(base64: string): void;
  endPcmStream(): void;
  stopPcmStream(): void;
  refreshForegroundServiceType(): void;
  getInputState(): InputState | null;
  connectBluetoothSco(timeoutMs: number): Promise<boolean>;
  releaseBluetoothSco(): void;
}

export default requireNativeModule<HeadphoneButtonModule>("HeadphoneButton");
