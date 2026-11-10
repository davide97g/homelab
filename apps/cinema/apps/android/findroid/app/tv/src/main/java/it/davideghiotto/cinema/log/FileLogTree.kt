package it.davideghiotto.cinema.log

import android.content.Context
import android.os.Build
import android.util.Log
import java.io.File
import java.io.FileWriter
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import timber.log.Timber

/**
 * Timber tree that appends every log line to `files/logs/cinema.log`, so a session on the TV can be
 * read back after the fact (`apps/android/scripts/tv.sh logs --file`), even when adb was not
 * attached while it happened. One file of [MAX_BYTES], rotated once to `cinema.log.1`.
 *
 * Writes go through a single background thread: Timber calls come from the main thread and the
 * player, and the set has four slow cores.
 */
class FileLogTree(context: Context) : Timber.Tree() {
    private val dir = File(context.filesDir, "logs").apply { mkdirs() }
    private val file = File(dir, "cinema.log")
    private val writer = Executors.newSingleThreadExecutor { Thread(it, "cinema-log") }
    private val stamp = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)

    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        val line = buildString {
            append(stamp.format(Date()))
            append(' ')
            append(level(priority))
            append('/')
            append(tag ?: "Cinema")
            append(": ")
            append(message)
            if (t != null && !message.contains(t.javaClass.name)) {
                append('\n')
                append(stackTrace(t))
            }
            append('\n')
        }
        writer.execute { append(line) }
    }

    /** Synchronous: used from the crash handler, where the process is about to die. */
    fun appendNow(line: String) = append(line)

    @Synchronized
    private fun append(line: String) {
        try {
            if (file.length() > MAX_BYTES) {
                file.renameTo(File(dir, "cinema.log.1"))
            }
            FileWriter(file, true).use { it.write(line) }
        } catch (e: Exception) {
            Log.w("FileLogTree", "cannot write ${file.path}", e)
        }
    }

    companion object {
        private const val MAX_BYTES = 2L * 1024 * 1024

        private fun level(priority: Int) =
            when (priority) {
                Log.VERBOSE -> 'V'
                Log.DEBUG -> 'D'
                Log.INFO -> 'I'
                Log.WARN -> 'W'
                Log.ERROR -> 'E'
                else -> 'A'
            }

        private fun stackTrace(t: Throwable) =
            StringWriter().also { t.printStackTrace(PrintWriter(it)) }.toString()

        /**
         * Plant logcat + file logging, log who we are, and record uncaught exceptions to the file
         * before the default handler kills the process.
         */
        fun install(context: Context, versionName: String, buildType: String) {
            val fileTree = FileLogTree(context)
            Timber.plant(Timber.DebugTree(), fileTree)
            Timber.tag("Cinema")
                .i(
                    "start %s (%s) on %s %s, Android %s (SDK %d), ABI %s",
                    versionName,
                    buildType,
                    Build.MANUFACTURER,
                    Build.MODEL,
                    Build.VERSION.RELEASE,
                    Build.VERSION.SDK_INT,
                    Build.SUPPORTED_ABIS.joinToString(),
                )

            val previous = Thread.getDefaultUncaughtExceptionHandler()
            Thread.setDefaultUncaughtExceptionHandler { thread, e ->
                fileTree.appendNow(
                    "${SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(Date())} " +
                        "A/Crash: uncaught on ${thread.name}\n${stackTrace(e)}\n"
                )
                previous?.uncaughtException(thread, e)
            }
        }
    }
}
