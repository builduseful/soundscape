package com.builduseful.soundscape.diagnostics

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.StrictMode
import android.os.SystemClock
import androidx.profileinstaller.ProfileVerifier
import com.builduseful.soundscape.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * TEMPORARY: a log of how the app is used and how it performs, to read after
 * using it for a while, then remove with every `Diagnostics.` call. See
 * android/AGENTS.md.
 *
 * Lines go to the app's external files folder, where `adb pull` reaches them
 * on any build. One background thread writes them, so no caller touches the
 * disk, and the render thread logs only when the sound has glitched. Each line is
 * `<local time> <uptime ms> <area>: <what happened>`.
 */
@SuppressLint("StaticFieldLeak")
internal object Diagnostics {
    private val writer by lazy {
        Executors.newSingleThreadExecutor { runnable ->
            Thread({
                Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
                runnable.run()
            }, "soundscape-diagnostics")
        }
    }
    private val clock by lazy { SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.ROOT) }
    @Volatile private var file: File? = null
    // The application's context, which lives as long as the process anyway.
    @SuppressLint("StaticFieldLeak")
    private lateinit var app: Context
    private val reported = HashSet<String>()

    /** Idempotent: the activity and the service each start it, whichever comes first. */
    /** Off, nothing is watched or written, and R8 drops the code behind each check. */
    const val ENABLED = BuildConfig.DIAGNOSTICS

    fun start(context: Context) {
        if (!ENABLED) return
        if (file != null) return
        app = context.applicationContext
        file = File(app.getExternalFilesDir(null), FILE_NAME)
        log("process", "started ${sinceProcessStart()} ms ago, pid ${Process.myPid()}")
        writer.execute { device() }
        catchCrashes()
        watchMainThread()
        watchStrictMode()
        watchMemory()
        watchAudioDevices()
        watchScreen()
        previousExits()
        profileStatus()
    }

    fun log(area: String, event: String) {
        if (!ENABLED) return
        val target = file ?: return
        val now = System.currentTimeMillis()
        val uptime = SystemClock.uptimeMillis()
        writer.execute {
            if (target.length() > MAX_BYTES) target.renameTo(File(target.parentFile, "$FILE_NAME.1"))
            target.appendText("${clock.format(Date(now))} $uptime $area: $event\n")
        }
    }

    fun sinceProcessStart(): Long = SystemClock.uptimeMillis() - Process.getStartUptimeMillis()

    /** The battery at one moment, to compare with another. */
    class Battery(val at: Long, val percent: Int, val chargeMicroAh: Int?, val celsius: Float?, val charging: Boolean) {
        override fun toString() = "battery $percent%${if (charging) " charging" else ""}" +
            (chargeMicroAh?.let { ", ${it / 1000} mAh in it" } ?: "") +
            (celsius?.let { String.format(Locale.ROOT, ", %.1f °C", it) } ?: "")

        /** What the whole phone drew from [earlier] to this, not the app alone. */
        fun since(earlier: Battery): String {
            val hours = (at - earlier.at) / 3_600_000.0
            if (charging || earlier.charging || hours <= 0) return "charging, so no drain"
            val used = if (chargeMicroAh != null && earlier.chargeMicroAh != null) earlier.chargeMicroAh - chargeMicroAh else null
            return String.format(Locale.ROOT, "%d%% used in %.1f min", earlier.percent - percent, hours * 60) +
                (used?.let { String.format(Locale.ROOT, " (%d mAh, about %.0f mA)", it / 1000, it / 1000 / hours) } ?: "")
        }
    }

    // Read from the battery service and its last sticky broadcast: nothing is
    // registered, so nothing is woken to keep it current.
    fun battery(): Battery {
        val battery = app.getSystemService(BatteryManager::class.java)
        val sticky = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val tenths = sticky?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)?.takeIf { it != Int.MIN_VALUE }
        return Battery(
            SystemClock.elapsedRealtime(),
            battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY),
            battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER).takeIf { it > 0 },
            tenths?.div(10f),
            battery.isCharging,
        )
    }

    /** Battery, power saver, Doze, thermal state, the screen and the media volume, in one phrase. */
    fun power(battery: Battery = battery()): String {
        val power = app.getSystemService(PowerManager::class.java)
        val audio = app.getSystemService(AudioManager::class.java)
        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ", thermal ${thermalName(power.currentThermalStatus)}" else ""
        return "$battery" +
            (if (power.isPowerSaveMode) ", power saver" else "") +
            (if (power.isDeviceIdleMode) ", dozing" else "") + thermal +
            ", screen ${if (power.isInteractive) "on" else "off"}" +
            ", media volume ${audio.getStreamVolume(AudioManager.STREAM_MUSIC)}/${audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)}"
    }

    private fun thermalName(status: Int) = when (status) {
        PowerManager.THERMAL_STATUS_NONE -> "normal"
        PowerManager.THERMAL_STATUS_LIGHT -> "light"
        PowerManager.THERMAL_STATUS_MODERATE -> "moderate"
        PowerManager.THERMAL_STATUS_SEVERE -> "severe (throttling)"
        PowerManager.THERMAL_STATUS_CRITICAL -> "critical"
        PowerManager.THERMAL_STATUS_EMERGENCY -> "emergency"
        PowerManager.THERMAL_STATUS_SHUTDOWN -> "shutting down"
        else -> "status $status"
    }

    fun memory(): String {
        val runtime = Runtime.getRuntime()
        return "heap ${(runtime.totalMemory() - runtime.freeMemory()) / 1024} KB of ${runtime.maxMemory() / 1024} KB, " +
            "native ${android.os.Debug.getNativeHeapAllocatedSize() / 1024} KB"
    }

    /** A thread's CPU time in ms and how often it has slept, from /proc. */
    fun threadStats(tid: Int): Pair<Long, Long>? = if (tid == 0) null else runCatching {
        val task = "/proc/${Process.myPid()}/task/$tid"
        val stat = File("$task/stat").readText().substringAfterLast(')').trim().split(' ')
        val sleeps = File("$task/status").readLines().first { it.startsWith("voluntary_ctxt_switches:") }
            .substringAfter(':').trim().toLong()
        (stat[11].toLong() + stat[12].toLong()) * 10 to sleeps
    }.getOrNull()

    fun deviceName(device: AudioDeviceInfo?): String = if (device == null) "nothing" else when (device.type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired headphones"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP -> "Bluetooth (A2DP)"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth (SCO)"
        AudioDeviceInfo.TYPE_USB_HEADSET -> "USB headset"
        AudioDeviceInfo.TYPE_USB_DEVICE -> "USB device"
        AudioDeviceInfo.TYPE_HDMI -> "HDMI"
        AudioDeviceInfo.TYPE_BLE_HEADSET -> "Bluetooth LE headset"
        AudioDeviceInfo.TYPE_BLE_SPEAKER -> "Bluetooth LE speaker"
        AudioDeviceInfo.TYPE_BLE_BROADCAST -> "Bluetooth LE broadcast"
        AudioDeviceInfo.TYPE_HEARING_AID -> "hearing aid"
        AudioDeviceInfo.TYPE_TELEPHONY -> "telephony"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> "speaker (safe)"
        AudioDeviceInfo.TYPE_DOCK -> "dock"
        AudioDeviceInfo.TYPE_LINE_ANALOG, AudioDeviceInfo.TYPE_LINE_DIGITAL, AudioDeviceInfo.TYPE_AUX_LINE -> "line out"
        AudioDeviceInfo.TYPE_REMOTE_SUBMIX -> "remote submix (casting or recording)"
        else -> "type ${device.type}"
    } + (device.productName?.takeIf { it.isNotBlank() }?.let { " \"$it\"" } ?: "")

    private fun device() {
        val activities = app.getSystemService(ActivityManager::class.java)
        val ram = ActivityManager.MemoryInfo().also(activities::getMemoryInfo)
        val audio = app.getSystemService(AudioManager::class.java)
        log(
            "device",
            "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), " +
                "RAM ${ram.totalMem / 1048576} MB${if (activities.isLowRamDevice) " (low-RAM device)" else ""}, " +
                "app heap class ${activities.memoryClass} MB",
        )
        log(
            "device",
            "audio output ${audio.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)} Hz, " +
                "${audio.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)} frames a buffer; " +
                "app ${BuildConfig.BUILD_TYPE} ${BuildConfig.VERSION_NAME}; ${power()}",
        )
    }

    // Dying, so written at once rather than queued; then the usual handler.
    private fun catchCrashes() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                file?.appendText(
                    "${clock.format(Date())} ${SystemClock.uptimeMillis()} crash: on ${thread.name}: " +
                        error.stackTraceToString().replace("\n", "\n    ") + "\n",
                )
            }
            previous?.uncaughtException(thread, error)
        }
    }

    // Each message the main thread handles is bracketed by the looper's own
    // log lines; one that runs long is a stall the screen or a key felt.
    private fun watchMainThread() {
        var started = 0L
        Looper.getMainLooper().setMessageLogging { line ->
            if (line.startsWith(">")) {
                started = SystemClock.uptimeMillis()
            } else if (started != 0L) {
                val took = SystemClock.uptimeMillis() - started
                if (took >= STALL_MS) log("stall", "main thread busy $took ms: ${line.substringAfter("Finished to ").take(160)}")
            }
        }
    }

    // Disk or network on the main thread, a leaked resource and the like: each
    // kind once per process, where in our code it came from.
    private fun watchStrictMode() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        val report = { violation: Throwable ->
            val ours = violation.stackTrace.firstOrNull { it.className.startsWith("com.builduseful") }
            val key = "${violation.javaClass.simpleName} at $ours"
            if (synchronized(reported) { reported.add(key) }) log("strictmode", key)
        }
        StrictMode.setThreadPolicy(StrictMode.ThreadPolicy.Builder().detectAll().penaltyListener(writer) { report(it) }.build())
        StrictMode.setVmPolicy(StrictMode.VmPolicy.Builder().detectAll().penaltyListener(writer) { report(it) }.build())
    }

    private fun watchMemory() {
        app.registerComponentCallbacks(object : ComponentCallbacks2 {
            override fun onTrimMemory(level: Int) = log("memory", "asked to trim (${trimName(level)}), ${memory()}")

            override fun onConfigurationChanged(newConfig: Configuration) = Unit

            @Deprecated("Deprecated in Java")
            override fun onLowMemory() = log("memory", "low, ${memory()}")
        })
    }

    @Suppress("DEPRECATION")
    private fun trimName(level: Int) = when (level) {
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> "running, memory moderate"
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "running, memory low"
        ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> "running, memory critical"
        ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN -> "screen hidden"
        ComponentCallbacks2.TRIM_MEMORY_BACKGROUND -> "in the background"
        ComponentCallbacks2.TRIM_MEMORY_MODERATE -> "in the background, memory moderate"
        ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "next to be killed"
        else -> "level $level"
    }

    // Called at once with every device already there, then on each change:
    // where the sound goes, and when that changes under it.
    private fun watchAudioDevices() {
        app.getSystemService(AudioManager::class.java).registerAudioDeviceCallback(object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
                added.filter { it.isSink }.forEach { log("route", "output available: ${deviceName(it)}") }
            }

            override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) {
                removed.filter { it.isSink }.forEach { log("route", "output gone: ${deviceName(it)}") }
            }
        }, Handler(Looper.getMainLooper()))
    }

    private fun watchScreen() {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
            addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED)
        }
        // Each is sent only when the state changes, so listening costs nothing between.
        app.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val power = app.getSystemService(PowerManager::class.java)
                val what = when (intent.action) {
                    PowerManager.ACTION_POWER_SAVE_MODE_CHANGED -> "power saver ${if (power.isPowerSaveMode) "on" else "off"}"
                    PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED -> "Doze ${if (power.isDeviceIdleMode) "on" else "off"}"
                    else -> intent.action.orEmpty().substringAfterLast('.').lowercase(Locale.ROOT).replace('_', ' ')
                }
                log("system", "$what; ${battery()}")
            }
        }, filter)
    }

    // How each earlier run of the app ended, as Android recorded it (11 and
    // later): a crash, an ANR, killed for memory, stopped by the person.
    private fun previousExits() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        writer.execute {
            val seen = app.getSharedPreferences("diagnostics", Context.MODE_PRIVATE)
            val since = seen.getLong("lastExit", 0)
            val exits = app.getSystemService(ActivityManager::class.java)
                .getHistoricalProcessExitReasons(app.packageName, 0, 10)
                .filter { it.timestamp > since }
                .sortedBy { it.timestamp }
            for (exit in exits) {
                log(
                    "previous run",
                    "ended ${clock.format(Date(exit.timestamp))}: ${exitReason(exit.reason)}" +
                        (exit.description?.let { " ($it)" } ?: "") +
                        ", importance ${exit.importance}, pss ${exit.pss} KB, rss ${exit.rss} KB",
                )
            }
            exits.lastOrNull()?.let { seen.edit().putLong("lastExit", it.timestamp).apply() }
        }
    }

    private fun exitReason(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_EXIT_SELF -> "exited itself"
        ApplicationExitInfo.REASON_SIGNALED -> "signalled"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "killed for low memory"
        ApplicationExitInfo.REASON_CRASH -> "crashed"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "crashed (native)"
        ApplicationExitInfo.REASON_ANR -> "not responding (ANR)"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "failed to start"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission changed"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "killed for excessive resource use"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "stopped by the user"
        ApplicationExitInfo.REASON_USER_STOPPED -> "user stopped"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "a dependency died"
        ApplicationExitInfo.REASON_OTHER -> "killed by the system (other)"
        else -> "reason $reason"
    }

    // Whether the startup profile has been compiled yet: a first launch after
    // a sideload runs without it, which the launch times need read against.
    private fun profileStatus() {
        val status = ProfileVerifier.getCompilationStatusAsync()
        status.addListener({
            val result = status.get()
            log(
                "profile",
                "install result ${profileResult(result.profileInstallResultCode)}, compiled with it ${result.isCompiledWithProfile}, " +
                    "waiting to compile ${result.hasProfileEnqueuedForCompilation()}",
            )
        }, writer)
    }

    private fun profileResult(code: Int) = when (code) {
        ProfileVerifier.CompilationStatus.RESULT_CODE_NO_PROFILE_INSTALLED -> "no profile installed"
        ProfileVerifier.CompilationStatus.RESULT_CODE_COMPILED_WITH_PROFILE -> "compiled with the profile"
        ProfileVerifier.CompilationStatus.RESULT_CODE_PROFILE_ENQUEUED_FOR_COMPILATION -> "waiting to compile"
        ProfileVerifier.CompilationStatus.RESULT_CODE_COMPILED_WITH_PROFILE_NON_MATCHING -> "compiled with an older profile"
        ProfileVerifier.CompilationStatus.RESULT_CODE_ERROR_NO_PROFILE_EMBEDDED -> "no profile in the APK"
        else -> "code $code"
    }

    private const val FILE_NAME = "diagnostics.log"
    // With the one rotated file beside it, about 50 MB at most.
    private const val MAX_BYTES = 25L * 1024 * 1024
    private const val STALL_MS = 100L
}
