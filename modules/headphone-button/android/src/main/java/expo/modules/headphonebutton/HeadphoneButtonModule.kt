package expo.modules.headphonebutton

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HeadphoneButtonModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HeadphoneButton")

    Events("onButtonEvent")

    Function("startListening") {
      val module = this@HeadphoneButtonModule
      HeadphoneButtonService.setModule(module)
      val ctx = appContext.reactContext ?: return@Function
      val intent = Intent(ctx, HeadphoneButtonService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    }

    Function("stopListening") {
      HeadphoneButtonService.clearModule(this@HeadphoneButtonModule)
      val ctx = appContext.reactContext ?: return@Function
      val intent = Intent(ctx, HeadphoneButtonService::class.java)
      ctx.stopService(intent)
    }
  }

  fun emitButtonEvent(type: String) {
    sendEvent("onButtonEvent", mapOf("type" to type))
  }
}
