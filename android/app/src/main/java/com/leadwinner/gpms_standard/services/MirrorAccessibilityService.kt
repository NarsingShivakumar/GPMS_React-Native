package com.leadwinner.gpms_standard.services

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.Log
import android.view.accessibility.AccessibilityEvent

class MirrorAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "MirrorA11yService"

        @Volatile
        var instance: MirrorAccessibilityService? = null

        fun isEnabled() = instance != null

        fun performTouch(action: String, x: Float, y: Float, duration: Long = 50L) {
            val service = instance ?: run {
                Log.w(TAG, "AccessibilityService not running")
                return
            }
            when (action) {
                "tap", "down_up" -> service.dispatchTap(x, y, duration)
                "down"           -> service.dispatchTouchDown(x, y)
                "up"             -> service.dispatchTouchUp(x, y)
            }
        }

        fun performSwipe(
            startX: Float, startY: Float,
            endX: Float,   endY: Float,
            duration: Long = 300L
        ) {
            instance?.dispatchSwipe(startX, startY, endX, endY, duration)
        }

        fun performBack()          { instance?.performGlobalAction(GLOBAL_ACTION_BACK) }
        fun performHome()          { instance?.performGlobalAction(GLOBAL_ACTION_HOME) }
        fun performRecents()       { instance?.performGlobalAction(GLOBAL_ACTION_RECENTS) }
        fun performNotifications() { instance?.performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS) }
        fun performPowerDialog()   { instance?.performGlobalAction(GLOBAL_ACTION_POWER_DIALOG) }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d(TAG, "AccessibilityService connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Not needed for gesture dispatch only
    }

    override fun onInterrupt() {
        Log.d(TAG, "AccessibilityService interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
        Log.d(TAG, "AccessibilityService destroyed")
    }

    // ── private gesture helpers ─────────────────────────────────────────────

    private fun dispatchTap(x: Float, y: Float, duration: Long = 50L) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration.coerceAtLeast(1L))
        dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            object : GestureResultCallback() {
                override fun onCompleted(g: GestureDescription?) = Unit
                override fun onCancelled(g: GestureDescription?) {
                    Log.v(TAG, "Tap cancelled at ($x,$y)")
                }
            }, null
        )
    }

    private fun dispatchTouchDown(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        // willContinue = true → gesture stays "held" until a follow-up stroke
        val stroke = GestureDescription.StrokeDescription(path, 0, 10_000L, true)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun dispatchTouchUp(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 50L, false)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun dispatchSwipe(
        startX: Float, startY: Float,
        endX: Float,   endY: Float,
        duration: Long
    ) {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration.coerceAtLeast(1L))
        dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            object : GestureResultCallback() {
                override fun onCompleted(g: GestureDescription?) = Unit
            }, null
        )
    }
}