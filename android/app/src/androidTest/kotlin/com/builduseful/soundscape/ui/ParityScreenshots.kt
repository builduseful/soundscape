package com.builduseful.soundscape.ui

import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.platform.app.InstrumentationRegistry
import com.builduseful.soundscape.core.appearance.ThemePreference
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import java.io.File

/**
 * Not a check: the screen in each window of layout.json, light and dark, for
 * scripts/parity-report.mjs to set beside the web's, written to the app's
 * files/parity/. Left out of Gradle's runs (app/build.gradle.kts); run by
 * android/scripts/capture-parity.mjs.
 */
@RunWith(Parameterized::class)
class ParityScreenshots(private val window: LayoutParityTest.Window, private val theme: ThemePreference) {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun capture() {
        rule.showAsTheWebIsCaptured(window, theme)
        val image = rule.onNodeWithTag(UiTags.PAGE).captureToImage().asAndroidBitmap()
        val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "parity").apply { mkdirs() }
        File(dir, "$window-${theme.name.lowercase()}.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    companion object {
        @JvmStatic
        @Parameterized.Parameters(name = "{0}-{1}")
        fun cases(): List<Array<Any>> = LayoutParityTest.windows().flatMap { window ->
            listOf(ThemePreference.Light, ThemePreference.Dark).map { arrayOf(window, it) }
        }
    }
}
