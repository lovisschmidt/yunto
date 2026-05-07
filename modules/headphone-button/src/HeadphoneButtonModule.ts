import { NativeModule, requireNativeModule } from "expo";
import type { HeadphoneButtonModuleEvents } from "./HeadphoneButton.types";

declare class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  playUri(uri: string, rate: number): void;
  stopPlayback(): void;
}

export default requireNativeModule<HeadphoneButtonModule>("HeadphoneButton");
