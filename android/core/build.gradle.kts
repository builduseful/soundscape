import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import soundscape.build.GenerateKotlinContract

// The product's rules, with no Android in them: runs and tests on a plain JVM.
plugins {
    alias(libs.plugins.kotlin.jvm)
    id("soundscape.shared-contract")
}

val shared = rootProject.layout.projectDirectory.dir("../shared")

val generateSharedContract = tasks.register<GenerateKotlinContract>("generateSharedContract") {
    catalog = shared.file("catalog.json")
    tokens = shared.file("design-tokens.json")
    packageName = "com.builduseful.soundscape.core.contract"
    trackClass = "com.builduseful.soundscape.core.Track"
    outputDir = layout.buildDirectory.dir("generated/shared-contract")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
        // A deprecation is a warning: fail on it, as lint does on its own.
        allWarningsAsErrors = true
    }
    sourceSets.main { kotlin.srcDir(generateSharedContract) }
}

dependencies {
    testImplementation(libs.junit)
}

tasks.test {
    // The tests read shared/ directly, to hold the generated code to it.
    inputs.dir(shared).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("soundscape.shared", shared.asFile.absolutePath)
    // And the masters the app bundles, to hold each to being a finished loop.
    val masters = rootProject.layout.projectDirectory.dir("../masters")
    inputs.dir(masters).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("soundscape.masters", masters.asFile.absolutePath)
}
