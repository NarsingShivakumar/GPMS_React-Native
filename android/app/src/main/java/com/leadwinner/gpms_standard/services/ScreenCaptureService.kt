package com.leadwinner.gpms_standard.services

import android.app.Activity
import android.app.Notification
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
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.leadwinner.gpms_standard.modules.MirrorModule
import java.io.ByteArrayOutputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class ScreenCaptureService : Service() {

    companion object {
        private const val TAG          = "ScreenCaptureService"
        const val ACTION_START         = "START_CAPTURE"
        const val ACTION_STOP          = "STOP_CAPTURE"
        const val EXTRA_SHARE_CODE     = "EXTRA_SHARE_CODE"
        const val EXTRA_PORT           = "EXTRA_PORT"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID   = "screen_capture_channel"
        private const val CHANNEL_NAME = "Screen Capture Service"

        // ── FIX for MirrorModule errors #1 & #2 ──────────────────────────
        // MirrorModule calls ScreenCaptureService.isRunning() and
        // ScreenCaptureService.pendingEvents — both must live here as
        // companion object members so they are reachable as static-style calls.

        /** True while the foreground capture service is active. */
        private val _isRunning = AtomicBoolean(false)
        fun isRunning(): Boolean = _isRunning.get()

        /** Thread-safe queue; MirrorModule polls this every 500 ms. */
        val pendingEvents = CopyOnWriteArrayList<Pair<String, String>>()
    }

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay:  VirtualDisplay?  = null
    private var imageReader:     ImageReader?      = null
    private var streamingServer: StreamingServer?  = null

    private var screenWidth  = 0
    private var screenHeight = 0
    private var screenDpi    = 0

    private val isCapturing = AtomicBoolean(false)

    private lateinit var captureThread:  HandlerThread
    private lateinit var captureHandler: Handler

    // ── Lifecycle ─────────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        captureThread  = HandlerThread("CaptureThread").also { it.start() }
        captureHandler = Handler(captureThread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {

            ACTION_START -> {
                val shareCode = intent.getStringExtra(EXTRA_SHARE_CODE) ?: ""
                val port      = intent.getIntExtra(EXTRA_PORT, StreamingServer.DEFAULT_PORT)

                startForegroundWithNotification(shareCode)

                val resultCode: Int    = MirrorModule.pendingResultCode
                val resultData: Intent? = MirrorModule.pendingResultData as? Intent

                if (resultCode != Activity.RESULT_OK || resultData == null) {
                    Log.e(TAG, "Invalid MediaProjection token — " +
                            "resultCode=$resultCode data=$resultData")
                    broadcastEventToRN("onCaptureError", "MediaProjection token missing")
                    stopSelf()
                    return START_NOT_STICKY
                }

                initScreenMetrics()
                startStreamingServer(port, shareCode)
                startCapture(resultCode, resultData)
            }

            ACTION_STOP -> stopCapture()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopCapture()
        captureThread.quitSafely()
        super.onDestroy()
    }

    // ── Foreground notification ───────────────────────────────────────────

    private fun startForegroundWithNotification(shareCode: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Screen mirroring is active" }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }

        val stopIntent = PendingIntent.getService(
            this, 0,
            Intent(this, ScreenCaptureService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Screen Sharing Active")
            .setContentText("Code: $shareCode  •  Tap to stop")
            .setSmallIcon(android.R.drawable.ic_media_pause)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_delete, "Stop", stopIntent)
            .build()

        startForeground(NOTIFICATION_ID, notification)
        _isRunning.set(true)   // mark running after startForeground succeeds
    }

    // ── Screen metrics ────────────────────────────────────────────────────

    private fun initScreenMetrics() {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.currentWindowMetrics.bounds
            screenWidth  = bounds.width()
            screenHeight = bounds.height()
        } else {
            @Suppress("DEPRECATION")
            val dm = DisplayMetrics().also { wm.defaultDisplay.getRealMetrics(it) }
            screenWidth  = dm.widthPixels
            screenHeight = dm.heightPixels
        }
        screenDpi = resources.displayMetrics.densityDpi
        Log.d(TAG, "Screen: ${screenWidth}x${screenHeight} @ ${screenDpi}dpi")
    }

    // ── Streaming server ──────────────────────────────────────────────────

    private fun startStreamingServer(port: Int, shareCode: String) {
        streamingServer = StreamingServer(port).apply {
            setDeviceInfo(screenWidth, screenHeight, Build.MODEL)

            onControlCommand     = { json -> handleControlCommand(json) }

            onClientConnected    = { addr ->
                Log.d(TAG, "Viewer connected: $addr")
                broadcastEventToRN("onClientConnected", addr)
            }

            onClientDisconnected = { addr ->
                Log.d(TAG, "Viewer disconnected: $addr")
                broadcastEventToRN("onClientDisconnected", addr)
            }

            onClientAcknowledged = { addr ->
                Log.d(TAG, "Viewer acknowledged (stream live): $addr")
                broadcastEventToRN("onClientAcknowledged", addr)
            }

            onServerError = { ex -> Log.e(TAG, "Server error: ${ex.message}", ex) }

            start()
        }
        Log.d(TAG, "StreamingServer started — port=$port shareCode=$shareCode")
    }

    // ── MediaProjection capture ───────────────────────────────────────────

    private fun startCapture(resultCode: Int, resultData: Intent) {
        val mpManager = getSystemService(Context.MEDIA_PROJECTION_SERVICE)
                as MediaProjectionManager

        // getMediaProjection() returns MediaProjection? — unwrap safely with ?: return
        val projection: MediaProjection =
            mpManager.getMediaProjection(resultCode, resultData)
                ?: run {
                    Log.e(TAG, "getMediaProjection returned null — aborting capture")
                    broadcastEventToRN("onCaptureError", "Failed to obtain MediaProjection")
                    stopSelf()
                    return
                }

        // projection is non-null from here — no !! or ?. required on it
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                Log.w(TAG, "MediaProjection stopped by system")
                stopCapture()
            }
        }, captureHandler)

        mediaProjection = projection

        val captureWidth  = (screenWidth  * 0.75).toInt()
        val captureHeight = (screenHeight * 0.75).toInt()

        imageReader = ImageReader.newInstance(
            captureWidth, captureHeight, PixelFormat.RGBA_8888, 2
        ).apply {
            setOnImageAvailableListener({ reader ->
                if (!isCapturing.get()) return@setOnImageAvailableListener
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val plane       = image.planes[0]
                    val buffer      = plane.buffer
                    val pixelStride = plane.pixelStride
                    val rowStride   = plane.rowStride
                    val rowPadding  = rowStride - pixelStride * captureWidth

                    val bmp = Bitmap.createBitmap(
                        captureWidth + rowPadding / pixelStride,
                        captureHeight,
                        Bitmap.Config.ARGB_8888
                    )
                    bmp.copyPixelsFromBuffer(buffer)

                    val cropped = Bitmap.createBitmap(bmp, 0, 0, captureWidth, captureHeight)
                    bmp.recycle()

                    val out = ByteArrayOutputStream()
                    cropped.compress(Bitmap.CompressFormat.JPEG, 60, out)
                    cropped.recycle()

                    streamingServer?.broadcastFrame(out.toByteArray())
                } catch (e: Exception) {
                    Log.e(TAG, "Frame error: ${e.message}")
                } finally {
                    image.close()
                }
            }, captureHandler)
        }

        virtualDisplay = projection.createVirtualDisplay(
            "GPMS_Mirror",
            captureWidth, captureHeight, screenDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface,
            null,
            captureHandler
        )

        isCapturing.set(true)
        broadcastEventToRN("onCaptureStarted", "ok")
        Log.d(TAG, "Capture started: ${captureWidth}x${captureHeight}")
    }

    // ── Stop ──────────────────────────────────────────────────────────────

    private fun stopCapture() {
        if (!isCapturing.getAndSet(false)) return

        _isRunning.set(false)

        runCatching { virtualDisplay?.release()     }
        runCatching { imageReader?.close()          }
        runCatching { mediaProjection?.stop()       }
        runCatching { streamingServer?.stopServer() }

        virtualDisplay  = null
        imageReader     = null
        mediaProjection = null
        streamingServer = null

        broadcastEventToRN("onCaptureStopped", "ok")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }

        stopSelf()
        Log.d(TAG, "Capture stopped")
    }

    // ── Control command dispatcher ────────────────────────────────────────

    private fun handleControlCommand(json: org.json.JSONObject) {
        sendBroadcast(Intent("com.leadwinner.gpms_standard.CONTROL_COMMAND").apply {
            putExtra("command", json.toString())
        })
    }

    // ── RN event bridge ───────────────────────────────────────────────────
    // Events are enqueued here; MirrorModule drains the queue every 500 ms.
    // This avoids the ReactContext threading constraints from a background thread.

    private fun broadcastEventToRN(event: String, data: String) {
        pendingEvents.add(Pair(event, data))
    }
}