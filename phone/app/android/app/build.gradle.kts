import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // google-services.json -> the Firebase app's resources (project, API key, database URL, default_web_client_id).
    id("com.google.gms.google-services")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing. android/key.properties (mode 0600) names android/app/orbit-release.jks; both stay off git
// (phone/app/.gitignore). Without them a release build is signed with the debug key, which cannot update an Orbit
// installed from a real release build.
val keystorePropertiesFile: File = rootProject.file("key.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.isFile) FileInputStream(keystorePropertiesFile).use { load(it) }
}
val hasReleaseKey = keystorePropertiesFile.isFile

android {
    namespace = "dev.shiv.orbit"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "dev.shiv.orbit"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        // Phones only: every Android phone is ARM. Leaving out x86_64 (emulators on Intel PCs, Chromebooks) keeps the
        // one APK small, and keeps a stray x86_64 library (jni's) from making Android think the APK runs there.
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a")
        }
    }

    // Native libraries stored compressed: the APK file sent to the phone is about half the size (Android unpacks
    // them once at install). The jni plugin builds its library for x86_64 whatever the filters say: left out too.
    packaging {
        jniLibs {
            useLegacyPackaging = true
            excludes += listOf("lib/x86_64/**", "lib/x86/**")
        }
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseKey) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                logger.warn("orbit: android/key.properties is missing, so this release build is signed with the debug key")
                signingConfig = signingConfigs.getByName("debug")
            }
            // R8 code shrinking and resource shrinking (Flutter turns them on for release too; spelled out here).
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
