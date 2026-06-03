package expo.modules.headphonebutton

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HeadphoneButtonModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HeadphoneButton")

    Events("onButtonEvent", "onPlaybackComplete", "onAudioInterrupted")

    AsyncFunction("startListening") {
      HeadphoneButtonService.setModule(this@HeadphoneButtonModule)
      appContext.reactContext?.also { ctx ->
        val intent = Intent(ctx, HeadphoneButtonService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
      }
    }

    AsyncFunction("stopListening") {
      HeadphoneButtonService.clearModule(this@HeadphoneButtonModule)
      appContext.reactContext?.also { ctx ->
        ctx.stopService(Intent(ctx, HeadphoneButtonService::class.java))
      }
    }

    Function("startPcmStream") { sampleRate: Int, speed: Float ->
      HeadphoneButtonService.startPcmStream(sampleRate, speed)
    }

    Function("feedPcm") { base64: String ->
      HeadphoneButtonService.feedPcm(base64)
    }

    Function("endPcmStream") {
      HeadphoneButtonService.endPcmStream()
    }

    Function("stopPcmStream") {
      HeadphoneButtonService.stopPcmStream()
    }
  }

  fun emitButtonEvent(type: String) {
    sendEvent("onButtonEvent", mapOf("type" to type))
  }

  fun emitPlaybackComplete() {
    sendEvent("onPlaybackComplete", emptyMap<String, Any>())
  }

  fun emitAudioInterrupted() {
    sendEvent("onAudioInterrupted", emptyMap<String, Any>())
  }
}
