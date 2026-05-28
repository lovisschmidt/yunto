import { NativeModule, requireNativeModule } from "expo";
import type { HeadphoneButtonModuleEvents, InputState } from "./HeadphoneButton.types";

declare class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  playUri(uri: string, rate: number): void;
  stopPlayback(): void;
  refreshForegroundServiceType(): void;
  getInputState(): InputState | null;
  connectBluetoothSco(timeoutMs: number): Promise<boolean>;
  releaseBluetoothSco(): void;
}

export default requireNativeModule<HeadphoneButtonModule>("HeadphoneButton");
