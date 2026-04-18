package com.leadwinner.gpms_standard.services

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.leadwinner.gpms_standard.MainActivity  // FIX 1: was "ccom."
import com.leadwinner.gpms_standard.R
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {

    // FIX 5: Only ONE companion object — pendingEvents merged in here
    companion object {
        const val TAG = "ScreenCaptureService"
        const val ACTION_START = "ACTION_START_CAPTURE"
        const val ACTION_STOP = "ACTION_STOP_CAPTURE"
        const val EXTRA_RESULT_CODE = "RESULT_CODE"
        const val EXTRA_RESULT_DATA = "RESULT_DATA"
        const val EXTRA_SHARE_CODE = "SHARE_CODE"
        const val EXTRA_PORT = "PORT"
        const val NOTIFICATION_CHANNEL_ID = "medimirror_capture"
        const val NOTIFICATION_ID = 1001
        const val TARGET_FPS = 15
        const val JPEG_QUALITY = 55

        // Moved here from the duplicate companion object that caused the conflict
        val pendingEvents = ArrayDeque<Pair<String, String>>()

        @Volatile
        var instance: ScreenCaptureService? = null

        fun isRunning() = instance != null
    }

    private var mediaProjection: MediaProjection? = null
    private var imageReader: ImageReader? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var streamingServer: StreamingServer? = null
    private var captureHandlerThread: HandlerThread? = null
    private var captureHandler: Handler? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val isCapturing = AtomicBoolean(false)
    private var lastFrameTime = 0L
    private val frameIntervalMs = (1000L / TARGET_FPS)

    private var screenWidth = 0
    private var screenHeight = 0
    private var screenDensity = 0

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            Log.d(TAG, "MediaProjection stopped")
            stopCapture()
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                // ✅ MUST call startForeground() FIRST — Android 8+ kills the app
                // if startForeground() isn't called within 5s of startForegroundService()
                val shareCode = intent.getStringExtra(EXTRA_SHARE_CODE) ?: ""
                val port = intent.getIntExtra(EXTRA_PORT, StreamingServer.DEFAULT_PORT)
                startForegroundWithNotification(shareCode)  // ← moved UP before validation

                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val resultData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA)
                }

                if (resultCode != -1 && resultData != null) {
                    initScreenMetrics()
                    startStreamingServer(port)
                    startCapture(resultCode, resultData)
                } else {
                    Log.e(TAG, "Invalid MediaProjection data")
                    stopSelf()  // safe now — startForeground() already called
                }
            }
            ACTION_STOP -> {
                stopCapture()
                stopSelf()
            }
        }
        return START_NOT_STICKY  // ← also changed from START_STICKY (see note below)
    }
    private fun initScreenMetrics() {
        val windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            screenWidth = bounds.width()
            screenHeight = bounds.height()
            screenDensity = resources.displayMetrics.densityDpi
        } else {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            screenWidth = metrics.widthPixels
            screenHeight = metrics.heightPixels
            screenDensity = metrics.densityDpi
        }
        Log.d(TAG, "Screen: ${screenWidth}x${screenHeight} @ ${screenDensity}dpi")
    }

    private fun startStreamingServer(port: Int) {
        streamingServer = StreamingServer(port).apply {
            setDeviceInfo(screenWidth, screenHeight, Build.MODEL)
            onControlCommand = { json -> handleControlCommand(json) }
            onClientConnected = { addr ->
                Log.d(TAG, "Control device connected: $addr")
                broadcastEventToRN("onClientConnected", addr)
            }
            onClientDisconnected = { addr ->
                Log.d(TAG, "Control device disconnected: $addr")
                broadcastEventToRN("onClientDisconnected", addr)
            }
            onServerError = { ex ->
                Log.e(TAG, "Server error", ex)
            }
            start()
        }
    }

    private fun startCapture(resultCode: Int, data: Intent) {
        val projectionManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        mediaProjection = projectionManager.getMediaProjection(resultCode, data)
        mediaProjection?.registerCallback(projectionCallback, null)

        captureHandlerThread = HandlerThread("ScreenCapture").apply { start() }
        captureHandler = Handler(captureHandlerThread!!.looper)

        val captureWidth = (screenWidth * 0.8).toInt().let { if (it % 2 == 0) it else it - 1 }
        val captureHeight = (screenHeight * 0.8).toInt().let { if (it % 2 == 0) it else it - 1 }

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2)

        imageReader!!.setOnImageAvailableListener({ reader ->
            val now = System.currentTimeMillis()
            if (now - lastFrameTime < frameIntervalMs) {
                reader.acquireLatestImage()?.close()
                return@setOnImageAvailableListener
            }
            lastFrameTime = now
            processFrame(reader)
        }, captureHandler)

        virtualDisplay = mediaProjection!!.createVirtualDisplay(
            "MediMirror",
            captureWidth,
            captureHeight,
            screenDensity,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface,
            null,
            captureHandler
        )

        isCapturing.set(true)
        Log.d(TAG, "Screen capture started: ${captureWidth}x${captureHeight}")
    }

    private fun processFrame(reader: ImageReader) {
        var image: Image? = null
        try {
            image = reader.acquireLatestImage() ?: return

            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val rowPadding = rowStride - pixelStride * image.width

            val bitmapWidth = image.width + rowPadding / pixelStride
            val bitmap = Bitmap.createBitmap(bitmapWidth, image.height, Bitmap.Config.ARGB_8888)
            bitmap.copyPixelsFromBuffer(buffer)

            val finalBitmap = if (rowPadding > 0) {
                Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height).also {
                    bitmap.recycle()
                }
            } else bitmap

            val out = ByteArrayOutputStream(65536)
            finalBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            finalBitmap.recycle()

            streamingServer?.broadcastFrame(out.toByteArray())
        } catch (e: Exception) {
            Log.e(TAG, "Frame processing error", e)
        } finally {
            image?.close()
        }
    }

    private fun handleControlCommand(json: JSONObject) {
        try {
            when (json.getString("type")) {
                "touch" -> {
                    val action = json.getString("action")
                    val x = json.getDouble("x").toFloat()
                    val y = json.getDouble("y").toFloat()
                    MirrorAccessibilityService.performTouch(action, x, y,
                        json.optLong("duration", 50L))
                }
                "swipe" -> {
                    MirrorAccessibilityService.performSwipe(
                        json.getDouble("startX").toFloat(),
                        json.getDouble("startY").toFloat(),
                        json.getDouble("endX").toFloat(),
                        json.getDouble("endY").toFloat(),
                        json.optLong("duration", 300L)
                    )
                }
                "key" -> {
                    when (json.getString("action")) {
                        "back" -> MirrorAccessibilityService.performBack()
                        "home" -> MirrorAccessibilityService.performHome()
                        "recents" -> MirrorAccessibilityService.performRecents()
                        "power" -> MirrorAccessibilityService.performPowerDialog()
                        "notifications" -> MirrorAccessibilityService.performNotifications()
                    }
                }
                "ping" -> {
                    streamingServer?.broadcastSystemMessage("pong")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Control command error", e)
        }
    }

    private fun stopCapture() {
        isCapturing.set(false)
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        mediaProjection?.stop()
        mediaProjection = null
        captureHandlerThread?.quitSafely()
        captureHandlerThread = null
        streamingServer?.stopServer()
        streamingServer = null
    }

    private fun startForegroundWithNotification(shareCode: String) {
        val notifIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notifIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopIntent = Intent(this, ScreenCaptureService::class.java).apply {
            action = ACTION_STOP
        }
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("MediMirror Active")
            .setContentText("Sharing screen • Code: $shareCode")
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_delete, "Stop", stopPending)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            "Screen Sharing",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Active screen sharing notification"
            setShowBadge(false)
        }
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun acquireWakeLock() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "MediMirror:CaptureLock"
        ).apply { acquire(3600000L) }
    }

    private fun broadcastEventToRN(event: String, data: String) {
        // pendingEvents is now correctly in the single companion object above
        pendingEvents.add(Pair(event, data))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        stopCapture()
        serviceScope.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        instance = null
        Log.d(TAG, "ScreenCaptureService destroyed")
    }

    // *** NO second companion object here — that was the root cause of the conflict ***
}
