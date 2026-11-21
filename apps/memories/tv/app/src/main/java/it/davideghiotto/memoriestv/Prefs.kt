package it.davideghiotto.memoriestv

import android.content.Context
import java.util.UUID

/**
 * What survives a restart: the Immich API base this TV was handed, its own token, and a stable
 * device id (the broker names the Immich session after it, so an admin can revoke this TV alone).
 */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("memories", Context.MODE_PRIVATE)

    /** e.g. `https://memories.davideghiotto.it/immich/api`. */
    var apiUrl: String?
        get() = sp.getString("apiUrl", null)
        set(v) = sp.edit().putString("apiUrl", v).apply()

    var token: String?
        get() = sp.getString("token", null)
        set(v) = sp.edit().putString("token", v).apply()

    var userName: String?
        get() = sp.getString("userName", null)
        set(v) = sp.edit().putString("userName", v).apply()

    val deviceId: String
        get() = sp.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
            sp.edit().putString("deviceId", it).apply()
        }

    val signedIn get() = apiUrl != null && token != null

    fun clearSession() {
        sp.edit().remove("apiUrl").remove("token").remove("userName").apply()
    }
}
