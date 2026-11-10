# Orbit's own R8 rules, on top of proguard-android-optimize.txt and Flutter's.

# The page reaches Flutter through a JavaScript interface (OrbitNative.postMessage): its methods are found by name
# from JavaScript, so R8 must keep them. (The default file has this rule too; it must never go missing.)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Google sign-in goes through Android's Credential Manager, which finds its Play services provider by reflection
# (androidx.credentials R8 note).
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
