import { registerWebModule, NativeModule } from "expo";
import type { HeadphoneButtonModuleEvents } from "./HeadphoneButton.types";

class HeadphoneButtonModule extends NativeModule<HeadphoneButtonModuleEvents> {
  startListening(): void {}
  stopListening(): void {}
}

export default registerWebModule(HeadphoneButtonModule, "HeadphoneButtonModule");
