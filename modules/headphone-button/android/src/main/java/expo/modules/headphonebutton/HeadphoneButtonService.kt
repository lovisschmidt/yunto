package expo.modules.headphonebutton

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.view.KeyEvent

class HeadphoneButtonService : Service() {

  private var mediaSession: MediaSession? = null
  private val handler = Handler(Looper.getMainLooper())
  private var pressCount = 0

  private val debounceRunnable = Runnable {
    val type = if (pressCount >= 2) "double" else "single"
    pressCount = 0
    currentModule?.emitButtonEvent(type)
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    startForeground(NOTIFICATION_ID, buildNotification())
    setupMediaSession()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(debounceRunnable)
    mediaSession?.apply {
      isActive = false
      release()
    }
    mediaSession = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun setupMediaSession() {
    val session = MediaSession(this, "YuntoHeadphoneButton")
    @Suppress("DEPRECATION")
    session.setFlags(
      MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
        MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS,
    )
    session.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or
            PlaybackState.ACTION_PAUSE or
            PlaybackState.ACTION_PLAY_PAUSE,
        )
        .setState(PlaybackState.STATE_PAUSED, 0, 1.0f)
        .build(),
    )
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
          if (keyEvent != null && keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
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
    private const val CHANNEL_ID = "yunto_headphone_button"
    private const val NOTIFICATION_ID = 1001
    private const val DEBOUNCE_MS = 300L

    @Volatile
    private var currentModule: HeadphoneButtonModule? = null

    fun setModule(module: HeadphoneButtonModule) {
      currentModule = module
    }

    fun clearModule(module: HeadphoneButtonModule) {
      if (currentModule === module) currentModule = null
    }
  }
}
