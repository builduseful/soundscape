package com.builduseful.soundscape.baselineprofile

import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.json.JSONObject

internal const val APP = "com.builduseful.soundscape"

private val copy by lazy {
    val context = InstrumentationRegistry.getInstrumentation().context
    JSONObject(context.assets.open("copy.json").bufferedReader().readText())
}

/** What a person does first: open the app and press play, then pause. */
internal fun MacrobenchmarkScope.startAndPlay() {
    startActivityAndWait()
    press("play")
    press("pause")
}

private fun MacrobenchmarkScope.press(label: String) {
    val button = device.wait(Until.findObject(By.pkg(APP).desc(copy.getString(label)).clickable(true)), 10_000)
    checkNotNull(button) { "No “${copy.getString(label)}” button" }.click()
    device.waitForIdle()
}
