package expo.modules.headphonebutton

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.PlaybackParams
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Base64
import android.view.KeyEvent
import java.util.concurrent.LinkedBlockingQueue

class HeadphoneButtonService : Service() {

  private var mediaSession: MediaSession? = null
  private val handler = Handler(Looper.getMainLooper())
  private var pressCount = 0
  private var audioFocusRequest: AudioFocusRequest? = null

  // Streaming PCM playback (TTS). Only the writer thread touches the track after
  // creation, except the immediate pause/flush in stopPcmStream() for barge-in.
  @Volatile private var audioTrack: AudioTrack? = null
  private var writerThread: Thread? = null
  private val pcmQueue = LinkedBlockingQueue<ByteArray>()
  private val endPill = ByteArray(0) // sentinel; compared by identity (===)
  private var totalFramesWritten: Long = 0L
  @Volatile private var streaming: Boolean = false

  private val focusListener =
    AudioManager.OnAudioFocusChangeListener { focusChange ->
      if (streaming &&
        (focusChange == AudioManager.AUDIOFOCUS_LOSS ||
          focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
      ) {
        stopPcmStream()
        currentModule?.emitAudioInterrupted()
      }
    }

  private val debounceRunnable = Runnable {
    val type = if (pressCount >= 2) "double" else "single"
    pressCount = 0
    currentModule?.emitButtonEvent(type)
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
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
    stopPcmStream()
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
    handler.post {
      requestAudioFocus()
      mediaSession?.let { session ->
        session.setPlaybackState(buildState(PlaybackState.STATE_PLAYING))
        session.isActive = false
        session.isActive = true
      }
    }
  }

  // Called when JS stopListening() fires. Reverts to PAUSED and releases focus.
  fun release() {
    handler.post {
      abandonAudioFocus()
      mediaSession?.setPlaybackState(buildState(PlaybackState.STATE_PAUSED))
    }
  }

  // Open a gapless PCM stream. Audio is fed via feedPcm and played on a dedicated
  // writer thread; endPcmStream/stopPcmStream tear it down.
  fun startPcmStream(sampleRate: Int, speed: Float) {
    stopPcmStream()
    pcmQueue.clear()
    totalFramesWritten = 0L

    val minBuf =
      AudioTrack.getMinBufferSize(
        sampleRate,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
    val bufferSize = maxOf(minBuf, minBuf * 4)

    val track =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(sampleRate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build(),
        )
        .setBufferSizeInBytes(bufferSize)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()

    track.play()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && speed != 1.0f) {
      try { track.playbackParams = PlaybackParams().setSpeed(speed) } catch (_: Exception) {}
    }

    audioTrack = track
    streaming = true

    val thread =
      Thread {
        var completedNaturally = false
        try {
          while (true) {
            val chunk = pcmQueue.take()
            if (chunk === endPill) {
              completedNaturally = true
              break
            }
            if (!streaming) break
            try { track.write(chunk, 0, chunk.size) } catch (_: Exception) {}
            totalFramesWritten += chunk.size / 2
          }
        } catch (_: InterruptedException) {
          // barge-in / interruption
        }

        // After a natural end, wait for the track to drain before signalling completion.
        if (completedNaturally && streaming) {
          try {
            while (streaming && track.playbackHeadPosition.toLong() < totalFramesWritten) {
              Thread.sleep(20)
            }
          } catch (_: Exception) {}
          if (streaming) currentModule?.emitPlaybackComplete()
        }

        try { track.pause() } catch (_: Exception) {}
        try { track.flush() } catch (_: Exception) {}
        try { track.stop() } catch (_: Exception) {}
        try { track.release() } catch (_: Exception) {}
        // Only reset shared state if a newer startPcmStream() hasn't taken over.
        if (audioTrack === track) {
          audioTrack = null
          streaming = false
        }
      }
    thread.start()
    writerThread = thread
  }

  fun feedPcm(base64: String) {
    if (!streaming) return
    val bytes =
      try { Base64.decode(base64, Base64.DEFAULT) } catch (_: Exception) { return }
    pcmQueue.put(bytes)
  }

  fun endPcmStream() {
    if (!streaming) return
    pcmQueue.put(endPill)
  }

  // Immediate teardown for barge-in / interruption — no onPlaybackComplete.
  fun stopPcmStream() {
    streaming = false
    val track = audioTrack
    try { track?.pause() } catch (_: Exception) {}
    try { track?.flush() } catch (_: Exception) {}
    pcmQueue.clear()
    writerThread?.interrupt()
  }

  private fun requestAudioFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val req =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
          .setWillPauseWhenDucked(false)
          .setOnAudioFocusChangeListener(focusListener, handler)
          .build()
      am.requestAudioFocus(req)
      audioFocusRequest = req
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(
        focusListener,
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
      )
    }
  }

  private fun abandonAudioFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let { am.abandonAudioFocusRequest(it) }
      audioFocusRequest = null
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(focusListener)
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
          if (keyEvent == null) return super.onMediaButtonEvent(mediaButtonIntent)

          if (keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) {
            if (keyEvent.action == KeyEvent.ACTION_DOWN) {
              currentModule?.emitButtonEvent("double")
            }
            return true
          }

          if (keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
            keyEvent.keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
            keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
            keyEvent.keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE
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
    // If JS called setModule() before onCreate() completed, instance was null at that point
    // and claim() was a no-op. Apply the pending claim now that the session is ready.
    if (claimPending) {
      claimPending = false
      claim()
    }
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

    @Volatile
    private var instance: HeadphoneButtonService? = null

    @Volatile
    private var claimPending = false

    fun setModule(module: HeadphoneButtonModule) {
      currentModule = module
      val inst = instance
      if (inst != null) {
        inst.claim()
      } else {
        claimPending = true
      }
    }

    fun clearModule(module: HeadphoneButtonModule) {
      if (currentModule === module) {
        claimPending = false
        currentModule = null
        instance?.release()
      }
    }

    fun startPcmStream(sampleRate: Int, speed: Float) {
      instance?.startPcmStream(sampleRate, speed)
    }

    fun feedPcm(base64: String) {
      instance?.feedPcm(base64)
    }

    fun endPcmStream() {
      instance?.endPcmStream()
    }

    fun stopPcmStream() {
      instance?.stopPcmStream()
    }
  }
}
