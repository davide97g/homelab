package it.davideghiotto.jarvistv

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import it.davideghiotto.jarvistv.databinding.ActivitySettingsBinding

/**
 * The launcher's own settings, reachable from the gear in the header or the remote's
 * MENU key. Its whole reason to exist is the escape hatch: JARVIS makes itself HOME by
 * disabling the stock Google launcher (the only method Google TV honours), and a
 * disabled app cannot re-enable itself. What *can* be done without any special
 * permission is open the stock launcher's app-details page, where a disabled system
 * app shows an "Attiva" button — one click and Google is back. No computer needed.
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var ui: ActivitySettingsBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(ui.root)

        ui.settingsMeta.text = "JARVIS ${BuildConfig.VERSION_NAME}"

        ui.restoreLauncher.setOnClickListener { openAppDetails(STOCK_LAUNCHER) }
        ui.openTvSettings.setOnClickListener {
            startActivitySafely(Intent(Settings.ACTION_SETTINGS))
        }

        ui.restoreLauncher.requestFocus()
    }

    private fun openAppDetails(pkg: String) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", pkg, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivitySafely(intent)
    }

    private fun startActivitySafely(intent: Intent) {
        runCatching { startActivity(intent) }
            .onFailure { Toast.makeText(this, "Non disponibile su questa TV", Toast.LENGTH_SHORT).show() }
    }

    private companion object {
        const val STOCK_LAUNCHER = "com.google.android.tvlauncher"
    }
}
