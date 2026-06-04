package expo.modules.headphonebutton

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Settle time after setCommunicationDevice succeeds, letting the physical SCO link come up
// before recording so the first words aren't clipped.
private const val SCO_SETTLE_MS = 300L

class HeadphoneButtonModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())

  private var scoPromise: Promise? = null
  private var scoTimeout: Runnable? = null
  private var scoReceiver: BroadcastReceiver? = null
  private var deviceCallback: AudioDeviceCallback? = null

  @Volatile private var expectingTeardown = false

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("HeadphoneButton")

    Events(
      "onButtonEvent",
      "onPlaybackComplete",
      "onAudioInterrupted",
      "onBluetoothScoChanged",
      "onBluetoothMicAvailabilityChanged",
    )

    OnCreate {
      registerDeviceCallback()
    }

    OnDestroy {
      mainHandler.post {
        teardownSco()
        unregisterDeviceCallback()
      }
    }

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

    // Re-applies the foreground service type once RECORD_AUDIO is granted, so the
    // service can carry the microphone type required for screen-off recording on
    // Android 14+ (declaring it before the permission is granted would crash startForeground).
    Function("refreshForegroundServiceType") {
      HeadphoneButtonService.refreshForegroundServiceType()
    }

    // Returns the input-device ids (matching expo-audio's recorder.setInput uid scheme,
    // which keys on AudioDeviceInfo.id) so JS can route the recorder. bluetooth is null
    // when no SCO headset is connected or the OS predates setInput support (API < 29).
    Function("getInputState") {
      val am = audioManager ?: return@Function null
      val inputs = am.getDevices(AudioManager.GET_DEVICES_INPUTS)
      val builtIn = inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
      val bt =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          inputs.firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        } else {
          null
        }
      mapOf(
        "builtInUid" to builtIn?.id?.toString(),
        "bluetoothUid" to bt?.id?.toString(),
        "bluetoothName" to (bt?.productName?.toString()),
      )
    }

    // Establishes the Bluetooth SCO link and resolves true once connected, false on
    // timeout/failure. The recorder's preferred device is bound separately in JS via
    // recorder.setInput(uid); this owns the communication device + audio mode so we get
    // a reliable connected signal to gate the start cue.
    AsyncFunction("connectBluetoothSco") { timeoutMs: Int, promise: Promise ->
      mainHandler.post { connectSco(timeoutMs, promise) }
    }

    Function("releaseBluetoothSco") {
      // Suppress the disconnect event that the intentional teardown will trigger.
      expectingTeardown = true
      mainHandler.post { teardownSco() }
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

  private fun connectSco(timeoutMs: Int, promise: Promise) {
    val am = audioManager
    if (am == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.resolve(false)
      return
    }

    // Abandon any in-flight attempt before starting a new one.
    resolveScoPromise(false)
    expectingTeardown = false
    scoPromise = promise

    // On timeout, tear the route back down so a slow/failed link never leaves the
    // session stuck in communication ("call") mode.
    scoTimeout =
      Runnable { teardownSco() }.also {
        mainHandler.postDelayed(it, timeoutMs.toLong())
      }

    am.mode = AudioManager.MODE_IN_COMMUNICATION

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val scoDevice =
        am.availableCommunicationDevices.firstOrNull {
          it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        }
      if (scoDevice == null || !am.setCommunicationDevice(scoDevice)) {
        teardownSco()
        return
      }
      // setCommunicationDevice succeeded — trust that routing rather than re-reading
      // communicationDevice (which can briefly report stale/null and cause false fallbacks).
      // Allow a short settle for the physical link so the first words aren't clipped.
      mainHandler.postDelayed({ resolveScoPromise(true) }, SCO_SETTLE_MS)
    } else {
      // API 29-30: startBluetoothSco is asynchronous; wait for the connected broadcast.
      registerScoReceiver(am)
      @Suppress("DEPRECATION")
      am.startBluetoothSco()
    }
  }

  private fun registerScoReceiver(am: AudioManager) {
    unregisterScoReceiver()
    @Suppress("DEPRECATION")
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          val state =
            intent?.getIntExtra(
              AudioManager.EXTRA_SCO_AUDIO_STATE,
              AudioManager.SCO_AUDIO_STATE_ERROR,
            ) ?: AudioManager.SCO_AUDIO_STATE_ERROR
          when (state) {
            AudioManager.SCO_AUDIO_STATE_CONNECTED -> resolveScoPromise(true)
            AudioManager.SCO_AUDIO_STATE_ERROR -> teardownSco()
          }
        }
      }
    appContext.reactContext?.registerReceiver(
      receiver,
      IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED),
    )
    scoReceiver = receiver
  }

  private fun unregisterScoReceiver() {
    scoReceiver?.let {
      try {
        appContext.reactContext?.unregisterReceiver(it)
      } catch (_: Exception) {
      }
    }
    scoReceiver = null
  }

  private fun resolveScoPromise(connected: Boolean) {
    scoTimeout?.let { mainHandler.removeCallbacks(it) }
    scoTimeout = null
    unregisterScoReceiver()
    val p = scoPromise ?: return
    scoPromise = null
    p.resolve(connected)
  }

  private fun teardownSco() {
    // Suppress the SCO device-removal callback that clearing the route triggers, so a teardown
    // (including a failed-connect cleanup) is never mistaken for an unexpected headset drop.
    expectingTeardown = true
    resolveScoPromise(false)
    val am = audioManager
    if (am != null) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        am.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        am.stopBluetoothSco()
      }
      am.mode = AudioManager.MODE_NORMAL
    }
    // Keep the teardown grace window long enough to swallow the SCO device-removal callback.
    mainHandler.postDelayed({ expectingTeardown = false }, 1500)
  }

  private fun registerDeviceCallback() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val am = audioManager ?: return
    unregisterDeviceCallback()
    val callback =
      object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) {
          if (addedDevices == null) return
          val btRelated =
            addedDevices.any {
              it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || isBtOutput(it.type)
            }
          if (btRelated) {
            sendEvent("onBluetoothMicAvailabilityChanged", emptyMap<String, Any>())
          }
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
          if (removedDevices == null) return
          val outputRemoved = removedDevices.any { isBtOutput(it.type) }
          // BT output removal = the headset is genuinely gone. We never intentionally remove
          // the output device, so this bypasses expectingTeardown — otherwise a disconnect
          // that coincides with our own SCO teardown would get swallowed by the grace window.
          if (outputRemoved) {
            sendEvent("onBluetoothScoChanged", mapOf("state" to "disconnected"))
            sendEvent("onBluetoothMicAvailabilityChanged", emptyMap<String, Any>())
            return
          }
          // SCO-only removals during our teardown are expected; suppress them (including the
          // availability event, so the badge doesn't flicker to "Phone mic" on a normal turn end).
          if (expectingTeardown) return
          val scoRemoved = removedDevices.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
          if (!scoRemoved) return
          // SCO dropped, output still listed → user ended the call (hang-up) on a headset that
          // surfaces it. Re-check the live output list in case the A2DP removal is queued.
          val outputStillConnected =
            audioManager?.getDevices(AudioManager.GET_DEVICES_OUTPUTS)?.any { isBtOutput(it.type) } == true
          val state = if (outputStillConnected) "stop" else "disconnected"
          sendEvent("onBluetoothScoChanged", mapOf("state" to state))
          sendEvent("onBluetoothMicAvailabilityChanged", emptyMap<String, Any>())
        }
      }
    am.registerAudioDeviceCallback(callback, mainHandler)
    deviceCallback = callback
  }

  private fun unregisterDeviceCallback() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    deviceCallback?.let { audioManager?.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
  }

  // A connected BT headset's output device — present while the headset is connected even when
  // SCO (the mic call) is not. TYPE_BLE_HEADSET is included to generalize to LE Audio later.
  private fun isBtOutput(type: Int): Boolean =
    type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || type == AudioDeviceInfo.TYPE_BLE_HEADSET
}
