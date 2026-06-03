import { NativeModule, requireNativeModule } from "expo";
import type { HeadphoneButtonModuleEvents } from "./HeadphoneButton.types";

declare class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  startPcmStream(sampleRate: number, speed: number): void;
  feedPcm(base64: string): void;
  endPcmStream(): void;
  stopPcmStream(): void;
}

export default requireNativeModule<HeadphoneButtonModule>("HeadphoneButton");
