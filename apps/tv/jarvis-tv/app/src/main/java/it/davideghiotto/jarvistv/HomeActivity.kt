package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.RectF
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewTreeObserver
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import it.davideghiotto.jarvistv.databinding.ActivityHomeBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.random.Random

/**
 * Two screens on one reel: the apps and the orb. Down goes to JARVIS, up comes back
 * out, and the reel is the only thing that moves.
 *
 * The apps screen is a macOS desktop: the screensaver's painting as the wallpaper, a
 * menu bar along the top, and the apps in a dock along the bottom that magnifies
 * under the D-pad selector as left/right moves it.
 */
class HomeActivity : AppCompatActivity() {

    private enum class Zone { FLOW, TABS, JARVIS }

    private companion object {
        const val TAG = "JarvisHome"
        const val TAB_HOME = 0
        const val TAB_SETTINGS = 1
    }

    private lateinit var ui: ActivityHomeBinding
    private lateinit var prefs: Prefs
    private lateinit var ambilight: Ambilight
    private lateinit var speaker: Speaker
    private lateinit var media: MediaCovers

    private var client: JarvisClient? = null
    private var clockJob: Job? = null
    private var voiceJob: Job? = null
    private var showcaseJob: Job? = null

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    /** What is on the drum: the favourites and the "+" card, or everything. */
    private var apps: List<LaunchableApp> = emptyList()
    /** Every launchable app on the set, favourites first. */
    private var all: List<LaunchableApp> = emptyList()
    private var showAll = false
    private var zone = Zone.FLOW
    private var tab = TAB_HOME
    private var launching = false
    private var showcase: List<ShowcaseItem> = emptyList()
    /** Jellyfin's resume still, by package, fetched through jarvis-server. */
    private val backdrops = mutableMapOf<String, Bitmap>()
    /** Web apps, as the server (or, offline, the last copy in prefs) lists them. */
    private var sites: List<Site> = emptyList()
    /** Each site's own icon, by site id, fetched through jarvis-server. */
    private val siteIcons = mutableMapOf<String, Bitmap>()
    private var sitesJob: Job? = null
    /** What each app is playing, from its media session. */
    private var playing: Map<String, NowPlaying> = emptyMap()

    private val itLocale = Locale("it", "IT")
    /** The menu bar's clock: "gio 13 nov  13:11". */
    private val clockFmt = SimpleDateFormat("EEE d MMM   HH:mm", itLocale)

    private val tabs get() = listOf(ui.apps.tabHome, ui.apps.tabSettings)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ui = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(ui.root)

        prefs = Prefs(this)
        applyOverrides(intent)
        sites = WebApps.cached(this)

        ambilight = Ambilight(lifecycleScope)
        if (prefs.ambilightEnabled) ambilight.capture()

        speaker = Speaker(this) { speaking ->
            runOnUiThread { onSpeaking(speaking) }
        }

        media = MediaCovers(this) { now ->
            playing = now
            refreshArt()
        }

        ui.jarvis.orb.onColour = { colour -> if (zone == Zone.JARVIS) tintAmbilight(colour) }

        setJarvisState(OrbView.State.IDLE)
        renderTabs()
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
        fetchShowcase()
        fetchSites()
        if (launching) {
            // coming back from an app the takeover opened
            launching = false
            ui.takeover.close { }
        }
        media.start()
        if (zone == Zone.JARVIS) ui.jarvis.orb.start()
    }

    override fun onPause() {
        super.onPause()
        clockJob?.cancel()
        media.stop()
        ui.jarvis.orb.stop()
        // Hand Ambilight back before whatever the viewer launched takes the screen,
        // otherwise a manual-mode pulse would freeze over their film.
        ambilight.stopPulse()
    }

    override fun onDestroy() {
        super.onDestroy()
        client?.stop()
        speaker.shutdown()
    }

    /** A launcher swallows BACK when it is already at the top. */
    override fun onBackPressed() {
        when (zone) {
            Zone.FLOW -> if (showAll) setShowAll(false)
            Zone.TABS -> goTo(Zone.FLOW)
            Zone.JARVIS -> goTo(Zone.FLOW)
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) {
            openSettings(); return true
        }
        if (launching) return true
        val ok = keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
        return when (zone) {
            Zone.FLOW -> when {
                keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> { turn(1); true }
                keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> { turn(-1); true }
                keyCode == KeyEvent.KEYCODE_DPAD_UP -> { tab = TAB_HOME; goTo(Zone.TABS); true }
                keyCode == KeyEvent.KEYCODE_DPAD_DOWN -> { goTo(Zone.JARVIS); true }
                ok -> { openPicked(); true }
                else -> super.onKeyDown(keyCode, event)
            }
            Zone.TABS -> when {
                keyCode == KeyEvent.KEYCODE_DPAD_LEFT -> { tab = (tab - 1).coerceAtLeast(0); renderTabs(); true }
                keyCode == KeyEvent.KEYCODE_DPAD_RIGHT -> { tab = (tab + 1).coerceAtMost(TAB_SETTINGS); renderTabs(); true }
                keyCode == KeyEvent.KEYCODE_DPAD_DOWN -> { goTo(Zone.FLOW); true }
                ok -> {
                    when (tab) {
                        TAB_SETTINGS -> { goTo(Zone.FLOW); openSettings() }
                        else -> goTo(Zone.FLOW)
                    }
                    true
                }
                else -> super.onKeyDown(keyCode, event)
            }
            Zone.JARVIS -> when (keyCode) {
                KeyEvent.KEYCODE_DPAD_UP -> { goTo(Zone.FLOW); true }
                else -> super.onKeyDown(keyCode, event)
            }
        }
    }

    private fun openSettings() = startActivity(Intent(this, SettingsActivity::class.java))

    // ── navigation ───────────────────────────────────────────────────────────────

    private fun goTo(next: Zone) {
        zone = next
        ui.reel.goTo(
            when (next) {
                Zone.FLOW, Zone.TABS -> 0
                Zone.JARVIS -> 1
            }
        )
        // the painting steps back off the desktop and all but disappears behind the
        // orb, which is the only lit thing on its screen
        ui.wallpaper.dim = when (next) {
            Zone.FLOW, Zone.TABS -> 1f
            Zone.JARVIS -> .06f
        }
        renderTabs()

        // the orb costs a frame of canvas work, so it only runs while it is on screen
        if (next == Zone.JARVIS) ui.jarvis.orb.start() else ui.jarvis.orb.stop()
        if (next == Zone.JARVIS) tintAmbilight(orbColour()) else tintAmbilight(pickedAccent())
    }

    private fun renderTabs() {
        val here = when (zone) {
            Zone.JARVIS -> -1
            else -> TAB_HOME
        }
        tabs.forEachIndexed { i, t ->
            t.current = i == here
            t.lit = zone == Zone.TABS && i == tab
        }
    }

    private fun turn(by: Int) {
        if (apps.isEmpty()) return
        ui.apps.dock.move(by)
        renderPicked()
    }

    private val picked get() = ui.apps.dock.index

    private fun pickedAccent(): Int =
        apps.getOrNull(picked)?.accent ?: ContextCompat.getColor(this, R.color.accent)

    // ── apps ─────────────────────────────────────────────────────────────────────

    private fun loadApps() {
        lifecycleScope.launch {
            all = withContext(Dispatchers.IO) { Apps.load(this@HomeActivity) }
            val next = drum()
            if (next.map { it.pkg } == apps.map { it.pkg }) return@launch
            show(next, keep = apps.getOrNull(picked)?.pkg)
        }
    }

    /**
     * Only the favourites that are installed, then a "+" card for the rest; with it
     * open, everything and a "−" card to fold it back. No card when it would show or
     * hide nothing.
     */
    private fun drum(): List<LaunchableApp> {
        val web = sites.map { WebApps.entry(this, it, siteIcons[it.id]) }
        val favs = all.filter(Apps::isFavourite)
        if (favs.isEmpty() || favs.size == all.size) return all + web
        return if (showAll) all + web + toggleCard(R.string.fewer_apps)
        else favs + web + toggleCard(R.string.more_apps)
    }

    /** Rebuild the dock in place, keeping the selection on the same entry. */
    private fun refreshDock() {
        if (all.isEmpty()) return
        show(drum(), keep = apps.getOrNull(picked)?.pkg)
    }

    // ── web apps ─────────────────────────────────────────────────────────────────

    private fun onSites(next: List<Site>) {
        val changed = next != sites
        sites = next
        WebApps.remember(this, next)
        // a site whose address changed may have a different icon now
        siteIcons.keys.retainAll(next.map { it.id }.toSet())
        if (changed) refreshDock()
        fetchSiteIcons(force = changed)
    }

    /** The socket pushes the list too; this covers a TV that comes back while it is down. */
    private fun fetchSites() {
        sitesJob?.cancel()
        sitesJob = lifecycleScope.launch {
            val base = "http://${prefs.serverHost}:${prefs.serverPort}"
            val list = withContext(Dispatchers.IO) {
                runCatching {
                    http.newCall(Request.Builder().url("$base/api/sites").build()).execute().use { res ->
                        if (!res.isSuccessful) null
                        else Site.parseAll(JSONObject(res.body?.string() ?: "{}").optJSONArray("sites"))
                    }
                }.onFailure { Log.w(TAG, "sites failed: $it") }.getOrNull()
            } ?: return@launch
            onSites(list)
        }
    }

    private fun fetchSiteIcons(force: Boolean = false) {
        val base = "http://${prefs.serverHost}:${prefs.serverPort}"
        val missing = sites.filter { force || it.id !in siteIcons }
        if (missing.isEmpty()) return
        lifecycleScope.launch {
            var got = false
            for (site in missing) {
                val bmp = withContext(Dispatchers.IO) {
                    runCatching {
                        http.newCall(Request.Builder().url("$base/api/sites/${site.id}/icon").build()).execute().use { res ->
                            val bytes = if (res.isSuccessful) res.body?.bytes() else null
                            // ARGB, not Images' RGB_565: icons have transparent corners
                            bytes?.let { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) }
                        }
                    }.getOrNull()
                }
                if (bmp != null) { siteIcons[site.id] = bmp; got = true }
            }
            if (got) refreshDock()
        }
    }

    private fun toggleCard(label: Int) = LaunchableApp(
        label = getString(label),
        pkg = Apps.MORE,
        banner = null,
        icon = ContextCompat.getDrawable(this, R.drawable.ic_studio_plus)!!,
        accent = 0xFF6E625B.toInt(),
    )

    private fun show(next: List<LaunchableApp>, keep: String?) {
        apps = next
        val focus = apps.indexOfFirst { it.pkg == keep }.coerceAtLeast(0)
        ui.apps.dock.setApps(apps, focus)
        pushStatus()
        renderPicked()
    }

    /** Opening lands on the first app it revealed; closing lands back on the "+". */
    private fun setShowAll(on: Boolean) {
        if (showAll == on) return
        showAll = on
        val keep = if (on) all.firstOrNull { !Apps.isFavourite(it) }?.pkg else Apps.MORE
        show(drum(), keep)
    }

    /**
     * Every picture the launcher can honestly get, for the takeover: what an app is
     * playing beats what Jellyfin says it is part way through.
     */
    private fun covers(): Map<String, Bitmap> =
        backdrops + playing.mapNotNull { (pkg, p) -> p.art?.let { pkg to it } }

    private fun progress(): Map<String, Float> =
        showcase.firstOrNull()?.takeIf { it.progress > 0f }?.let { mapOf(it.pkg to it.progress) }
            ?: emptyMap()

    /** The running dots, the progress on the Jellyfin icon, and each tooltip's second line. */
    private fun pushStatus() {
        val subs = apps.mapNotNull { a -> subtitleFor(a)?.let { a.pkg to it } }.toMap()
        val running = playing.keys + showcase.filter { it.progress > 0f }.map { it.pkg }
        ui.apps.dock.setStatus(running, progress(), subs)
    }

    private fun refreshArt() {
        pushStatus()
        renderPicked()
    }

    /**
     * Opening an app: the takeover grows out of the front card and the activity starts
     * underneath it. The animation is the loading state — a cold start on this set is
     * 300–900 ms — so the app is asked for part way through rather than at the end.
     */
    private fun openPicked() {
        val app = apps.getOrNull(picked) ?: return
        if (app.pkg == Apps.MORE) { setShowAll(!showAll); return }
        val icon = ui.apps.dock.selectedRect() ?: return
        if (icon.width() <= 0f || launching) return
        launching = true

        val root = IntArray(2).also { ui.root.getLocationInWindow(it) }
        val at = IntArray(2).also { ui.apps.dock.getLocationInWindow(it) }
        icon.offset((at[0] - root[0]).toFloat(), (at[1] - root[1]).toFloat())

        // the dock bounce first, as macOS does, then the window grows out of the icon
        ui.apps.dock.bounce()
        ui.takeover.postDelayed({
            ui.takeover.open(icon, covers()[app.pkg], app.icon, app.accent, app.label)
        }, 380)
        ui.takeover.postDelayed({
            if (!Apps.launch(this, app)) {
                Log.w(TAG, "cannot launch ${app.pkg}")
                launching = false
                ui.takeover.close { }
            }
        }, 1200)
    }

    // ── showcase ─────────────────────────────────────────────────────────────────

    /**
     * What the TV is part way through, from Jellyfin by way of the server. The TV has
     * no route to that Jellyfin — it is on the NAS, reached over Tailscale from the
     * mini PC — so both the list and the artwork come through the JARVIS server.
     */
    private fun fetchShowcase() {
        showcaseJob?.cancel()
        showcaseJob = lifecycleScope.launch {
            val base = "http://${prefs.serverHost}:${prefs.serverPort}"
            val json = withContext(Dispatchers.IO) {
                runCatching {
                    http.newCall(Request.Builder().url("$base/api/showcase").build()).execute()
                        .use { res -> res.body?.string()?.let { JSONObject(it) } }
                }.onFailure { Log.w(TAG, "showcase failed: $it") }.getOrNull()
            } ?: return@launch

            showcase = ShowcaseItem.parseAll(json)
            val first = showcase.firstOrNull() ?: return@launch
            first.imagePath?.let { path ->
                Images.load(base + path)?.let { backdrops[first.pkg] = it }
            }
            refreshArt()
        }
    }

    /** The dock draws the selection itself; the room's light follows it. */
    private fun renderPicked() {
        if (zone == Zone.FLOW || zone == Zone.TABS) tintAmbilight(pickedAccent())
    }

    /** The tooltip's second line, or nothing when the launcher knows nothing. */
    private fun subtitleFor(app: LaunchableApp): String? {
        if (app.pkg == Apps.MORE) {
            return if (showAll) getString(R.string.fewer_apps_hint)
            else getString(R.string.more_apps_hint, all.count { !Apps.isFavourite(it) })
        }
        app.url?.let { return android.net.Uri.parse(it).host?.removePrefix("www.") }
        playing[app.pkg]?.let { p ->
            return "${getString(R.string.now_playing)} — ${p.title}" + (p.subtitle?.let { " · $it" } ?: "")
        }
        showcase.firstOrNull { it.pkg == app.pkg }?.let { item ->
            return "${getString(R.string.keep_watching)} — ${item.title}" +
                (item.remaining()?.let { " · $it" } ?: "")
        }
        return null
    }

    // ── clock ────────────────────────────────────────────────────────────────────

    private fun startClock() {
        clockJob?.cancel()
        clockJob = lifecycleScope.launch {
            while (isActive) {
                ui.apps.clock.text = clockFmt.format(Date())
                delay(10_000)
            }
        }
    }

    // ── jarvis ───────────────────────────────────────────────────────────────────

    private fun startClient() {
        client?.stop()
        client = JarvisClient(
            ctx = this,
            prefs = prefs,
            onLink = { up -> runOnUiThread { renderLink(up) } },
            onSnapshot = { },   // homelab status: no longer shown on the TV
            onTranscript = { text -> runOnUiThread { onTranscript(text) } },
            onSay = { text, lang ->
                runOnUiThread { onReply(text) }
                speaker.say(text, lang)
            },
            onLaunch = { pkg ->
                runOnUiThread {
                    if (!Apps.launch(this, pkg)) Log.w(TAG, "cannot launch $pkg")
                }
            },
            onSites = { list -> runOnUiThread { onSites(list) } },
            onOpenUrl = { name, url -> runOnUiThread { WebApps.open(this, name, url) } },
        ).also { it.start() }
    }

    private fun setJarvisState(state: OrbView.State) {
        ui.jarvis.orb.state = state
        if (state == OrbView.State.IDLE && ui.jarvis.jarvisReply.text.isNullOrBlank()) {
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_hint_phone)
        }
        ui.jarvis.orbState.setText(
            when (state) {
                OrbView.State.IDLE -> R.string.orb_idle
                OrbView.State.LISTENING -> R.string.orb_listening
                OrbView.State.THINKING -> R.string.orb_thinking
                OrbView.State.SPEAKING -> R.string.orb_speaking
                OrbView.State.ERROR -> R.string.orb_error
            }
        )
    }

    private fun orbColour(): Int = when (ui.jarvis.orb.state) {
        OrbView.State.THINKING -> 0xFFC9B6FD.toInt()
        OrbView.State.SPEAKING -> 0xFFFBBF24.toInt()
        OrbView.State.ERROR -> 0xFFF87171.toInt()
        else -> 0xFFE8A87C.toInt()
    }

    private fun onTranscript(text: String) {
        ui.jarvis.jarvisPrompt.text = "“$text”"
        ui.jarvis.jarvisReply.text = ""
        setJarvisState(OrbView.State.THINKING)
        // the question was asked on the phone, so the answer belongs on the screen
        // that is about answering it
        if (zone != Zone.JARVIS) goTo(Zone.JARVIS)
    }

    private fun onReply(text: String) {
        ui.jarvis.jarvisReply.text = text
        setJarvisState(OrbView.State.SPEAKING)
    }

    private fun onSpeaking(speaking: Boolean) {
        if (speaking) {
            setJarvisState(OrbView.State.SPEAKING)
            startEnvelope()
            if (prefs.ambilightEnabled) ambilight.startPulse(0xFB, 0xBF, 0x24)
        } else {
            stopEnvelope()
            // the question stays on screen under the answer it produced; the phone
            // hint only comes back once there is no answer to read
            setJarvisState(OrbView.State.IDLE)
            if (prefs.ambilightEnabled) ambilight.stopPulse()
        }
    }

    /**
     * A stand-in envelope. Android's TTS gives no level while it speaks — the nearest
     * real signal is `onRangeStart`, which arrives per word — so the orb is driven by a
     * smoothed random walk at speech tempo rather than pretending to a waveform.
     */
    private fun startEnvelope() {
        stopEnvelope()
        voiceJob = lifecycleScope.launch {
            var level = .5f
            while (isActive) {
                level = (level * .6f + Random.nextFloat() * .4f + .12f).coerceIn(0f, 1f)
                ui.jarvis.orb.amplitude = level
                delay(90)
            }
        }
    }

    private fun stopEnvelope() {
        voiceJob?.cancel()
        voiceJob = null
        ui.jarvis.orb.amplitude = 0f
    }

    private fun tintAmbilight(colour: Int) {
        if (!prefs.ambilightEnabled) return
        ambilight.setColour(colour)
    }

    // ── link ─────────────────────────────────────────────────────────────────────

    private fun renderLink(up: Boolean) {
        if (!up) {
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_offline)
            ui.jarvis.jarvisReply.text = ""
            setJarvisState(OrbView.State.ERROR)
        } else if (ui.jarvis.orb.state == OrbView.State.ERROR) {
            setJarvisState(OrbView.State.IDLE)
            ui.jarvis.jarvisPrompt.setText(R.string.jarvis_hint_phone)
        }
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
}
