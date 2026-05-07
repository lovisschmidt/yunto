package expo.modules.headphonebutton

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.view.KeyEvent

class HeadphoneButtonService : Service() {

  private var mediaSession: MediaSession? = null
  private val handler = Handler(Looper.getMainLooper())
  private var pressCount = 0
  private var audioFocusRequest: AudioFocusRequest? = null

  private val debounceRunnable = Runnable {
    val type = if (pressCount >= 2) "double" else "single"
    pressCount = 0
    currentModule?.emitButtonEvent(type)
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    Log.d(TAG, "onCreate — service starting")
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    setupMediaSession()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return START_STICKY
  }

  override fun onDestroy() {
    instance = null
    handler.removeCallbacks(debounceRunnable)
    abandonAudioFocus()
    mediaSession?.apply {
      isActive = false
      release()
    }
    mediaSession = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // Called when JS startListening() fires. Sets STATE_PLAYING and requests audio
  // focus so Android routes the button here instead of resuming a paused Spotify.
  fun claim() {
    Log.d(TAG, "claim() — mediaSession=${mediaSession?.sessionToken}")
    Handler(Looper.getMainLooper()).post {
      requestAudioFocus()
      mediaSession?.let { session ->
        session.setPlaybackState(buildState(PlaybackState.STATE_PLAYING))
        session.isActive = false
        session.isActive = true
        Log.d(TAG, "claim() — session reactivated, state=PLAYING")
      }
    }
  }

  // Called when JS stopListening() fires. Reverts to PAUSED and releases focus.
  fun release() {
    Handler(Looper.getMainLooper()).post {
      abandonAudioFocus()
      mediaSession?.setPlaybackState(buildState(PlaybackState.STATE_PAUSED))
    }
  }

  private fun requestAudioFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setWillPauseWhenDucked(false)
          .build()
      am.requestAudioFocus(req)
      audioFocusRequest = req
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
    }
  }

  private fun abandonAudioFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(null)
    }
  }

  private fun buildState(state: Int): PlaybackState =
    PlaybackState.Builder()
      .setActions(
        PlaybackState.ACTION_PLAY or
          PlaybackState.ACTION_PAUSE or
          PlaybackState.ACTION_PLAY_PAUSE,
      )
      .setState(state, 0, 1.0f)
      .build()

  private fun setupMediaSession() {
    val session = MediaSession(this, "YuntoHeadphoneButton")
    @Suppress("DEPRECATION")
    session.setFlags(
      MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS,
    )
    session.setPlaybackState(buildState(PlaybackState.STATE_PAUSED))
    session.setCallback(
      object : MediaSession.Callback() {
        override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
          val keyEvent: KeyEvent? =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
              mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
            } else {
              @Suppress("DEPRECATION")
              mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
            }
          Log.d(TAG, "onMediaButtonEvent keyCode=${keyEvent?.keyCode} action=${keyEvent?.action}")
          if (keyEvent != null &&
            (keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
              keyEvent.keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
              keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
              keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE)
          ) {
            if (keyEvent.action == KeyEvent.ACTION_DOWN) {
              onButtonPress()
            }
            return true
          }
          return super.onMediaButtonEvent(mediaButtonIntent)
        }
      },
    )
    session.isActive = true
    mediaSession = session
  }

  private fun onButtonPress() {
    pressCount++
    handler.removeCallbacks(debounceRunnable)
    handler.postDelayed(debounceRunnable, DEBOUNCE_MS)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel =
        NotificationChannel(CHANNEL_ID, "Yunto", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Yunto is running"
          setShowBadge(false)
        }
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val openIntent =
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        PendingIntent.getActivity(
          this,
          0,
          it,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      }

    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
        .setContentTitle("Yunto")
        .setContentText("Yunto is running")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentIntent(openIntent)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle("Yunto")
        .setContentText("Yunto is running")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentIntent(openIntent)
        .setOngoing(true)
        .build()
    }
  }

  companion object {
    private const val TAG = "YuntoHeadphone"
    private const val CHANNEL_ID = "yunto_headphone_button"
    private const val NOTIFICATION_ID = 1001
    private const val DEBOUNCE_MS = 300L

    @Volatile
    private var currentModule: HeadphoneButtonModule? = null

    @Volatile
    private var instance: HeadphoneButtonService? = null

    fun setModule(module: HeadphoneButtonModule) {
      currentModule = module
      instance?.claim()
    }

    fun clearModule(module: HeadphoneButtonModule) {
      if (currentModule === module) {
        currentModule = null
        instance?.release()
      }
    }
  }
}
