package it.davideghiotto.jarvistv

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.util.Log

/**
 * Exists only so the launcher may read other apps' media sessions. Android hands
 * `getActiveSessions` to an enabled notification listener and to nobody else a
 * sideloaded app can be; it is never asked for a notification.
 *
 * Enabled once over adb (deploy-tv.sh does it):
 *   cmd notification allow_listener it.davideghiotto.jarvistv/it.davideghiotto.jarvistv.MediaListener
 */
class MediaListener : NotificationListenerService()

/** What an app is playing right now, as its own media session describes it. */
data class NowPlaying(val pkg: String, val title: String, val subtitle: String?, val art: Bitmap?)

/**
 * Covers from whatever is playing: Spotify's album art, YouTube's thumbnail, any app
 * that publishes a media session. Without the listener permission this quietly
 * yields nothing and the cards fall back to their own colour.
 */
class MediaCovers(private val ctx: Context, private val onChange: (Map<String, NowPlaying>) -> Unit) {

    private val msm = ctx.getSystemService(MediaSessionManager::class.java)
    private val component = ComponentName(ctx, MediaListener::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val callbacks = mutableMapOf<MediaController, MediaController.Callback>()

    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { list ->
        watch(list.orEmpty())
    }

    fun start() {
        val sessions = runCatching { msm.getActiveSessions(component) }
            .onFailure { Log.i(TAG, "no media sessions (listener not allowed?): $it") }
            .getOrNull() ?: return
        runCatching { msm.addOnActiveSessionsChangedListener(sessionsChanged, component, main) }
        watch(sessions)
    }

    fun stop() {
        runCatching { msm.removeOnActiveSessionsChangedListener(sessionsChanged) }
        callbacks.forEach { (c, cb) -> c.unregisterCallback(cb) }
        callbacks.clear()
    }

    private fun watch(sessions: List<MediaController>) {
        callbacks.forEach { (c, cb) -> c.unregisterCallback(cb) }
        callbacks.clear()
        sessions.forEach { c ->
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
            }
            c.registerCallback(cb, main)
            callbacks[c] = cb
        }
        publish()
    }

    private fun publish() {
        val now = callbacks.keys.mapNotNull { c ->
            val m = c.metadata ?: return@mapNotNull null
            val title = m.getString(MediaMetadata.METADATA_KEY_TITLE)
                ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: return@mapNotNull null
            val art = m.getBitmap(MediaMetadata.METADATA_KEY_ART)
                ?: m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
                ?: m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            val sub = m.getString(MediaMetadata.METADATA_KEY_ARTIST)
                ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE)
            c.packageName to NowPlaying(c.packageName, title, sub, art)
        }.toMap()
        onChange(now)
    }

    private companion object { const val TAG = "MediaCovers" }
}
