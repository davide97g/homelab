package it.davideghiotto.jarvistv

import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import it.davideghiotto.jarvistv.databinding.ActivityHomeBinding
import it.davideghiotto.jarvistv.databinding.ItemServiceBinding
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

class HomeActivity : AppCompatActivity() {

    private companion object { const val TAG = "JarvisHome" }

    private lateinit var ui: ActivityHomeBinding
    private lateinit var prefs: Prefs
    private lateinit var ambilight: Ambilight
    private lateinit var speaker: Speaker
    private var client: JarvisClient? = null
    private var clockJob: Job? = null

    private val itLocale = Locale("it", "IT")
    private val timeFmt = SimpleDateFormat("HH:mm", itLocale)
    private val dateFmt = SimpleDateFormat("EEEE d MMMM", itLocale)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(ui.root)

        prefs = Prefs(this)
        applyOverrides(intent)

        ambilight = Ambilight(lifecycleScope)
        if (prefs.ambilightEnabled) ambilight.capture()

        ui.gear.setOnClickListener { openSettings() }

        speaker = Speaker(this) { speaking ->
            runOnUiThread {
                if (!prefs.ambilightEnabled) return@runOnUiThread
                if (speaking) ambilight.startPulse() else ambilight.stopPulse()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // HOME is singleTask, so pressing the home key re-enters here rather than
        // recreating; re-read any adb-supplied overrides. onResume always follows and
        // opens the socket, so connecting here too would just open a second one.
        applyOverrides(intent)
    }

    override fun onResume() {
        super.onResume()
        loadApps()
        startClock()
        startClient()
    }

    override fun onPause() {
        super.onPause()
        clockJob?.cancel()
        // Hand Ambilight back before whatever the viewer launched takes the screen,
        // otherwise a manual-mode pulse would freeze over their film.
        ambilight.stopPulse()
    }

    override fun onDestroy() {
        super.onDestroy()
        client?.stop()
        speaker.shutdown()
    }

    /** A launcher swallows BACK: there is nothing behind it to go back to. */
    override fun onBackPressed() = Unit

    override fun onKeyDown(keyCode: Int, event: android.view.KeyEvent?): Boolean {
        if (keyCode == android.view.KeyEvent.KEYCODE_MENU ||
            keyCode == android.view.KeyEvent.KEYCODE_SETTINGS
        ) {
            openSettings()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    // ── wiring ───────────────────────────────────────────────────────────────────

    private fun applyOverrides(intent: Intent?) {
        intent?.getStringExtra("server_host")
            ?.takeIf { it.isNotBlank() }
            ?.let { prefs.serverHost = it }
        intent?.getIntExtra("server_port", -1)?.takeIf { it > 0 }?.let { prefs.serverPort = it }
        if (intent?.hasExtra("ambilight") == true) {
            prefs.ambilightEnabled = intent.getBooleanExtra("ambilight", true)
        }
    }

    private fun loadApps() {
        val apps = Apps.load(this)
        ui.appsRow.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        ui.appsRow.adapter = AppsAdapter(apps) { Apps.launch(this, it) }
        // The first tile takes focus so the remote is useful the moment the screen paints.
        ui.appsRow.post { ui.appsRow.getChildAt(0)?.requestFocus() }
    }

    private fun startClock() {
        clockJob?.cancel()
        clockJob = lifecycleScope.launch {
            while (isActive) {
                val now = Date()
                ui.clock.text = timeFmt.format(now)
                ui.date.text = dateFmt.format(now).replaceFirstChar { it.uppercase() }
                ui.greeting.text = greeting()
                delay(10_000)
            }
        }
    }

    private fun greeting(): String {
        val h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val part = when (h) {
            in 5..12 -> "Buongiorno"
            in 13..17 -> "Buon pomeriggio"
            else -> "Buonasera"
        }
        return "$part, Davide"
    }

    private fun startClient() {
        client?.stop()
        client = JarvisClient(
            ctx = this,
            prefs = prefs,
            onLink = { up -> runOnUiThread { renderLink(up) } },
            onSnapshot = { snap -> runOnUiThread { renderHomelab(snap) } },
            onTranscript = { text -> runOnUiThread { renderTranscript(text) } },
            onSay = { text, lang ->
                runOnUiThread { renderReply(text) }
                speaker.say(text, lang)
            },
            onLaunch = { pkg ->
                runOnUiThread {
                    if (!Apps.launch(this, pkg)) Log.w(TAG, "cannot launch $pkg")
                }
            },
        ).also { it.start() }
    }

    // ── rendering ────────────────────────────────────────────────────────────────

    private fun renderLink(up: Boolean) {
        val colour = ContextCompat.getColor(this, if (up) R.color.ok else R.color.text_faint)
        // mutate() first: every dot inflates from the same drawable and so shares one
        // ConstantState, and tinting without it recolours all of them at once.
        ui.linkDot.background.mutate().setTint(colour)
        ui.linkText.setText(if (up) R.string.status_online else R.string.status_offline)
        ui.linkText.setTextColor(
            ContextCompat.getColor(this, if (up) R.color.text_secondary else R.color.text_faint)
        )
        if (!up) {
            ui.jarvisPrompt.setText(R.string.jarvis_offline)
            ui.hostLine.setText(R.string.homelab_unreachable)
            ui.servicesRow.removeAllViews()
            ui.servicesRow.visibility = View.GONE
        } else {
            ui.jarvisPrompt.setText(R.string.jarvis_idle)
        }
    }

    private fun renderHomelab(snap: Snapshot) {
        ui.hostLine.text = snap.host?.line() ?: getString(R.string.homelab_unreachable)

        ui.servicesRow.removeAllViews()
        // An empty row is not zero-height: its top margin still pushes the panel down
        // far enough to close the gap under it. Collapse it outright instead.
        ui.servicesRow.visibility = if (snap.services.isEmpty()) View.GONE else View.VISIBLE
        val inflater = LayoutInflater.from(this)
        snap.services.forEach { svc ->
            val row = ItemServiceBinding.inflate(inflater, ui.servicesRow, false)
            row.serviceName.text = svc.name
            row.serviceDot.background.mutate().setTint(
                ContextCompat.getColor(this, if (svc.up) R.color.ok else R.color.err)
            )
            ui.servicesRow.addView(row.root)
        }
    }

    private fun renderTranscript(text: String) {
        ui.jarvisPrompt.text = "“$text”"
        ui.jarvisPrompt.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
        ui.jarvisReply.visibility = View.GONE
    }

    private fun renderReply(text: String) {
        ui.jarvisReply.text = text
        ui.jarvisReply.visibility = View.VISIBLE
    }
}
