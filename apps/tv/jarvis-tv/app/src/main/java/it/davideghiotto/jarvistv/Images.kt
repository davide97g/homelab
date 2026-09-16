package it.davideghiotto.jarvistv

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Backdrops, fetched from the JARVIS server and kept in memory.
 *
 * The images come from the Jellyfin on the NAS, which this TV has no route to at all —
 * the server proxies them, already resized. The cache is capped at an eighth of the
 * heap because the set has 2 GB of RAM in total and the launcher is the one process
 * that must never be the reason something else is killed.
 */
object Images {
    private const val TAG = "Images"

    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val cache = object : LruCache<String, Bitmap>(
        (Runtime.getRuntime().maxMemory() / 8).toInt()
    ) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }

    fun cached(url: String): Bitmap? = cache.get(url)

    suspend fun load(url: String, maxWidth: Int = 1280): Bitmap? = withContext(Dispatchers.IO) {
        cache.get(url)?.let { return@withContext it }
        runCatching {
            http.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return@use null
                val bytes = res.body?.bytes() ?: return@use null
                // decode bounds first: a 1280 px JPEG is fine, anything larger is
                // subsampled rather than allocated in full
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                var sample = 1
                while (opts.outWidth / sample > maxWidth) sample *= 2
                val bmp = BitmapFactory.decodeByteArray(
                    bytes, 0, bytes.size,
                    BitmapFactory.Options().apply {
                        inSampleSize = sample
                        inPreferredConfig = Bitmap.Config.RGB_565   // no alpha in a backdrop; half the bytes
                    }
                )
                bmp?.also { cache.put(url, it) }
            }
        }.onFailure { Log.w(TAG, "load $url failed: $it") }.getOrNull()
    }
}
