package com.leadwinner.gpms_standard.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import org.json.JSONObject
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors

/**
 * Receives touch/key commands from ScreenCaptureService (via broadcast)
 * and injects them as real gestures on the host screen using dispatchGesture().
 *
 * Command JSON format (same as WebSocket protocol):
 *   { type:"touch",  action:"tap"|"down"|"up", x:0..1, y:0..1, duration:50 }
 *   { type:"swipe",  startX:0..1, startY:0..1, endX:0..1, endY:0..1, duration:300 }
 *   { type:"longpress", x:0..1, y:0..1 }
 *   { type:"pinch",  cx:0..1, cy:0..1, scale:0.5..2.0, duration:400 }
 *   { type:"key",    action:"back"|"home"|"recents"|"notifications"|"lock" }
 *
 * Coordinates are NORMALISED (0.0 – 1.0) so they are resolution-independent.
 * The service scales them to the real screen size it reads from WindowManager.
 */
class MirrorAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "MirrorA11y"
        const val ACTION_CONTROL = "com.leadwinner.gpms_standard.CONTROL_COMMAND"

        // Singleton reference — ScreenCaptureService posts here directly
        @Volatile
        private var instance: MirrorAccessibilityService? = null

        fun isEnabled(): Boolean = instance != null

        /** Called by ScreenCaptureService.handleControlCommand() */
        fun dispatchCommand(json: JSONObject) {
            instance?.enqueueCommand(json)
        }
    }

    // Real screen dimensions — populated in onServiceConnected
    private var screenW = 1080
    private var screenH = 1920

    // Serial executor — gesture dispatch is single-threaded to avoid contention
    private val executor = Executors.newSingleThreadExecutor()
    private val queue    = ConcurrentLinkedQueue<JSONObject>()

    // Broadcast receiver for commands arriving via sendBroadcast()
    private val commandReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val raw = intent?.getStringExtra("command") ?: return
            runCatching { enqueueCommand(JSONObject(raw)) }
                .onFailure { Log.e(TAG, "Bad command JSON: $raw") }
        }
    }

    // ── Service lifecycle ─────────────────────────────────────────────────

    override fun onServiceConnected() {
        instance = this
        readScreenSize()

        val filter = IntentFilter(ACTION_CONTROL)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(commandReceiver, filter)
        }
        Log.i(TAG, "AccessibilityService connected — screen ${screenW}x${screenH}")
    }

    override fun onDestroy() {
        instance = null
        runCatching { unregisterReceiver(commandReceiver) }
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    // ── Command dispatcher ────────────────────────────────────────────────

    private fun enqueueCommand(json: JSONObject) {
        queue.offer(json)
        executor.submit {
            val cmd = queue.poll() ?: return@submit
            runCatching { executeCommand(cmd) }
                .onFailure { Log.e(TAG, "Error executing command: ${cmd}", it) }
        }
    }

    private fun executeCommand(json: JSONObject) {
        when (json.optString("type")) {
            "touch"     -> handleTouch(json)
            "swipe"     -> handleSwipe(json)
            "longpress" -> handleLongPress(json)
            "pinch"     -> handlePinch(json)
            "key"       -> handleKey(json)
            else        -> Log.w(TAG, "Unknown command type: ${json.optString("type")}")
        }
    }

    // ── Touch ─────────────────────────────────────────────────────────────

    private fun handleTouch(json: JSONObject) {
        val nx       = json.optDouble("x", 0.5)
        val ny       = json.optDouble("y", 0.5)
        val action   = json.optString("action", "tap")
        val duration = json.optLong("duration", 50L)

        val px = (nx * screenW).toFloat()
        val py = (ny * screenH).toFloat()

        when (action) {
            "tap" -> dispatchTap(px, py, duration)
            "down", "up" -> dispatchTap(px, py, duration)  // simplified — full multi-touch not needed for remote control
        }
    }

    private fun dispatchTap(x: Float, y: Float, durationMs: Long = 50L) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        dispatchGesture(gesture, null, null)
    }

    // ── Swipe / Drag ──────────────────────────────────────────────────────

    private fun handleSwipe(json: JSONObject) {
        val sx = (json.optDouble("startX", 0.5) * screenW).toFloat()
        val sy = (json.optDouble("startY", 0.5) * screenH).toFloat()
        val ex = (json.optDouble("endX",   0.5) * screenW).toFloat()
        val ey = (json.optDouble("endY",   0.5) * screenH).toFloat()
        val duration = json.optLong("duration", 300L)

        val path = Path().apply {
            moveTo(sx, sy)
            lineTo(ex, ey)
        }
        val stroke  = GestureDescription.StrokeDescription(path, 0L, duration)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        dispatchGesture(gesture, null, null)
    }

    // ── Long Press ────────────────────────────────────────────────────────

    private fun handleLongPress(json: JSONObject) {
        val px = (json.optDouble("x", 0.5) * screenW).toFloat()
        val py = (json.optDouble("y", 0.5) * screenH).toFloat()
        dispatchTap(px, py, 800L)   // 800ms = long press threshold
    }

    // ── Pinch (two-finger zoom) ───────────────────────────────────────────

    private fun handlePinch(json: JSONObject) {
        val cx       = (json.optDouble("cx", 0.5)  * screenW).toFloat()
        val cy       = (json.optDouble("cy", 0.5)  * screenH).toFloat()
        val scale    = json.optDouble("scale", 0.8).toFloat()
        val duration = json.optLong("duration", 400L)

        // Two fingers: one above centre, one below
        val startSpread = 200f
        val endSpread   = startSpread * scale

        // Finger 1: top → moves outward or inward
        val path1 = Path().apply {
            moveTo(cx, cy - startSpread)
            lineTo(cx, cy - endSpread)
        }
        // Finger 2: bottom → mirror
        val path2 = Path().apply {
            moveTo(cx, cy + startSpread)
            lineTo(cx, cy + endSpread)
        }

        val stroke1 = GestureDescription.StrokeDescription(path1, 0L, duration)
        val stroke2 = GestureDescription.StrokeDescription(path2, 0L, duration)
        val gesture = GestureDescription.Builder()
            .addStroke(stroke1)
            .addStroke(stroke2)
            .build()

        dispatchGesture(gesture, null, null)
    }

    // ── System keys ───────────────────────────────────────────────────────

    private fun handleKey(json: JSONObject) {
        when (json.optString("action")) {
            "back"          -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home"          -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents"       -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "notifications" -> performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
            "lock"          -> performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN)
        }
    }

    // ── Screen size ───────────────────────────────────────────────────────

    private fun readScreenSize() {
        try {
            val wm = getSystemService(WINDOW_SERVICE) as android.view.WindowManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val bounds = wm.currentWindowMetrics.bounds
                screenW = bounds.width()
                screenH = bounds.height()
            } else {
                val dm = android.util.DisplayMetrics()
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealMetrics(dm)
                screenW = dm.widthPixels
                screenH = dm.heightPixels
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not read screen size", e)
        }
    }
}