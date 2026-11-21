package it.davideghiotto.memoriestv

import android.app.Application
import android.os.Build
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import it.davideghiotto.memoriestv.data.MediaService
import it.davideghiotto.memoriestv.data.MockFetcher
import it.davideghiotto.memoriestv.data.MockService
import it.davideghiotto.memoriestv.net.Accounts
import it.davideghiotto.memoriestv.net.Immich
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient

/**
 * App-wide state: the HTTP client (which adds this TV's Immich token to Immich URLs, so Coil and
 * Media3 need nothing special), the accounts client, and the active [MediaService].
 */
class MemoriesApp : Application(), SingletonImageLoader.Factory {
    lateinit var prefs: Prefs
        private set
    lateinit var http: OkHttpClient
        private set
    lateinit var accounts: Accounts
        private set

    private val _service = MutableStateFlow<MediaService?>(null)
    /** Null while signed out. */
    val service: StateFlow<MediaService?> = _service

    override fun onCreate() {
        super.onCreate()
        instance = this
        prefs = Prefs(this)
        http = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request()
                val api = prefs.apiUrl
                val token = prefs.token
                if (api != null && token != null && req.header("Authorization") == null && req.url.toString().startsWith(api)) {
                    chain.proceed(req.newBuilder().header("Authorization", "Bearer $token").build())
                } else {
                    chain.proceed(req)
                }
            }
            .build()
        accounts = Accounts(http)
    }

    /** Restores the stored session, or the sample library with `--ez mock true`. */
    fun boot(mock: Boolean) {
        if (mock) { _service.value = MockService(); return }
        val api = prefs.apiUrl
        val token = prefs.token
        _service.value = if (api != null && token != null) immich(api, token) else null
    }

    private fun immich(api: String, token: String) = Immich(http, api, token, onUnauthorized = { forget() })

    /** After the phone approved: session -> Immich token -> API base. */
    suspend fun signIn(session: String) {
        val grant = accounts.immichToken(
            session = session,
            deviceId = prefs.deviceId,
            deviceName = deviceName(),
            version = BuildConfig.VERSION_NAME,
        )
        val api = Immich.discover(http, grant.serverUrl)
        prefs.apiUrl = api
        prefs.token = grant.accessToken
        val service = immich(api, grant.accessToken)
        prefs.userName = runCatching { service.me().name }.getOrNull()
        _service.value = service
    }

    fun startDemo() { _service.value = MockService() }

    suspend fun signOut() {
        _service.value?.signOut()
        forget()
    }

    private fun forget() {
        prefs.clearSession()
        _service.value = null
        SingletonImageLoader.get(this).memoryCache?.clear()
    }

    private fun deviceName(): String {
        val model = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ")
        return "TV · ${model.ifBlank { "Android TV" }}"
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = { http }))
                add(MockFetcher.Factory())
                add(MockFetcher.Key())
            }
            // 2 GB of RAM on the set: a modest memory cache, a generous disk one.
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.18).build() }
            .diskCache {
                DiskCache.Builder().directory(context.cacheDir.resolve("images")).maxSizeBytes(600L * 1024 * 1024).build()
            }
            .crossfade(180)
            .build()

    companion object {
        lateinit var instance: MemoriesApp
            private set
    }
}
