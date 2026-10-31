import soundscape.build.BundleLoops
import soundscape.build.GenerateResources

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    id("soundscape.shared-contract")
    alias(libs.plugins.baselineprofile)
}

val shared = rootProject.layout.projectDirectory.dir("../shared")
val appId = "com.builduseful.soundscape"
// What an app shortcut sends MainActivity, read through BuildConfig.
val playTrackAction = "$appId.action.PLAY_TRACK"
val trackIdExtra = "trackId"

val generateSharedResources = tasks.register<GenerateResources>("generateSharedResources") {
    copy = shared.file("copy.json")
    tokens = shared.file("design-tokens.json")
    outputDir = layout.buildDirectory.dir("generated/shared-resources")
}

val bundleLoops = tasks.register<BundleLoops>("bundleLoops") {
    catalog = shared.file("catalog.json")
    masters = rootProject.layout.projectDirectory.dir("../masters")
    outputDir = layout.buildDirectory.dir("generated/loops")
}

android {
    namespace = appId
    compileSdk = 37

    defaultConfig {
        applicationId = appId
        minSdk = 26
        targetSdk = 37
        versionCode = 15
        versionName = "1.0.6"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Screenshots for scripts/parity-report.mjs, not a check: run only by android/scripts/capture-parity.mjs.
        testInstrumentationRunnerArguments["notClass"] = "$appId.ui.ParityScreenshots"
        buildConfigField("String", "PLAY_TRACK_ACTION", "\"$playTrackAction\"")
        buildConfigField("String", "TRACK_ID_EXTRA", "\"$trackIdExtra\"")
        buildConfigField("boolean", "DIAGNOSTICS", providers.gradleProperty("soundscape.diagnostics").getOrElse("false"))
    }

    buildTypes {
        release {
            // R8: smaller, and faster to start, chiefly for Compose.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The instrumented tests hold the device to the same fixtures as every platform.
    sourceSets["androidTest"].assets.directories += "../../shared/fixtures"

    androidResources {
        // The engine maps each loop from the APK, which needs it stored as it is.
        noCompress += "wav"
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
        variant.sources.assets?.addGeneratedSourceDirectory(bundleLoops, BundleLoops::outputDir)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.foundation)
    implementation(libs.compose.ui)
    implementation(libs.activity.compose)
    // Installs the startup profile (baselineprofile/) where Play does not.
    implementation(libs.profileinstaller)
    baselineProfile(project(":baselineprofile"))

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
