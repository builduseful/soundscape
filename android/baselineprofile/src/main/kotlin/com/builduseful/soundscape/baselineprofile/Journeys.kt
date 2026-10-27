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

/** What a person does first: open the app, tap to play, swipe to the next sound, and tap to pause. */
internal fun MacrobenchmarkScope.startAndPlay() {
    startActivityAndWait()
    checkNotNull(device.wait(Until.findObject(By.pkg(APP).desc(copy.getString("play"))), 10_000)) { "No “${copy.getString("play")}” button" }
    val x = device.displayWidth / 2
    val y = device.displayHeight / 2
    device.click(x, y)
    device.waitForIdle()
    device.swipe(device.displayWidth * 4 / 5, y, device.displayWidth / 5, y, 40)
    device.waitForIdle()
    device.click(x, y)
    device.waitForIdle()
}
