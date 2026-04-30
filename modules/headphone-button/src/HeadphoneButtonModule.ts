import { NativeModule, requireNativeModule } from "expo";
import type { HeadphoneButtonModuleEvents } from "./HeadphoneButton.types";

declare class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): void;
  stopListening(): void;
}

export default requireNativeModule<HeadphoneButtonModule>("HeadphoneButton");
