import soundscape.build.GenerateResources

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    id("soundscape.shared-contract")
}

val shared = rootProject.layout.projectDirectory.dir("../shared")
val appId = "com.builduseful.soundscape"
// What an app shortcut sends MainActivity: written into the generated
// shortcuts.xml, and read through BuildConfig.
val playTrackAction = "$appId.action.PLAY_TRACK"
val trackIdExtra = "trackId"

val generateSharedResources = tasks.register<GenerateResources>("generateSharedResources") {
    copy = shared.file("copy.json")
    tokens = shared.file("design-tokens.json")
    catalog = shared.file("catalog.json")
    shortcutPackage = appId
    shortcutActivity = "$appId.MainActivity"
    shortcutAction = playTrackAction
    shortcutTrackExtra = trackIdExtra
    outputDir = layout.buildDirectory.dir("generated/shared-resources")
}

android {
    namespace = appId
    compileSdk = 37

    defaultConfig {
        applicationId = appId
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Screenshots for scripts/parity-report.mjs, not a check: run only by android/scripts/capture-parity.mjs.
        testInstrumentationRunnerArguments["notClass"] = "$appId.ui.ParityScreenshots"
        buildConfigField("String", "PLAY_TRACK_ACTION", "\"$playTrackAction\"")
        buildConfigField("String", "TRACK_ID_EXTRA", "\"$trackIdExtra\"")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets["main"].assets.directories += "../../web/src/resources/soundscapes"
    // The instrumented tests hold the device to the same fixtures as every platform.
    sourceSets["androidTest"].assets.directories += "../../shared/fixtures"

    // The decoder reads assets through a file descriptor, which needs them
    // stored as they are. They are compressed audio already.
    androidResources {
        noCompress += "opus"
        // Only the Opus is bundled. The AAC is the web's fallback for Safari, and
        // Android's AAC decoders are not gapless: API 26 ignores the MP4 edit
        // list (1024 samples of priming at the head) and later ones drop up to
        // 32 samples at the tail. See android/AGENTS.md.
        ignoreAssetsPatterns += "<dir>aac"
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        // It suggests core-ktx, which is not a dependency of ours; the
        // platform call it would wrap is used directly.
        disable += "UseKtx"
    }
}

kotlin {
    // A deprecation is a warning: fail on it, as lint does on its own.
    compilerOptions.allWarningsAsErrors = true
}

androidComponents {
    onVariants { variant ->
        variant.sources.res?.addGeneratedSourceDirectory(generateSharedResources, GenerateResources::outputDir)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.activity.compose)

    testImplementation(libs.junit)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.uiautomator)
    debugImplementation(libs.compose.ui.test.manifest)

    constraints {
        // Compose's test rule brings Espresso 3.5, which reaches for an
        // InputManager method that API 37 removed.
        androidTestImplementation(libs.espresso.core)
    }
}
