plugins {
    id("com.android.application")
}

// The game itself lives at the repository root; the APK packs a copy of it.
val webRoot = rootProject.layout.projectDirectory.dir("..")
val webAssets = layout.buildDirectory.dir("generated/webAssets")

// One version for the web game and the app: package.json "version" (x.y.z).
val appVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(webRoot.file("package.json").asFile.readText())
    ?.groupValues?.get(1)
    ?: error("package.json needs a \"version\": \"x.y.z\"")
val appVersionCode: Int = appVersion.split(".").map(String::toInt).let { (major, minor, patch) ->
    major * 10_000 + minor * 100 + patch
}

val syncWeb by tasks.registering(Sync::class) {
    description = "Copies the web game (index.html, js/, fonts/) into the APK's assets/web/."
    from(webRoot) {
        include("index.html", "js/**", "fonts/**")
    }
    into(webAssets.map { it.dir("web") })
}

android {
    namespace = "io.github.withoutcheatscsgocz_tech.timemoves"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.withoutcheatscsgocz_tech.timemoves"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        // Committed on purpose, like React Native's template: a debug key is not a secret,
        // and sharing it means every build (local, CI) can update the last one in place.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
        // A real key for store releases comes from the environment (see README).
        val keystore = System.getenv("ANDROID_KEYSTORE")
        if (!keystore.isNullOrBlank()) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(webAssets)
}

tasks.named("preBuild") {
    dependsOn(syncWeb)
}
