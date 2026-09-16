# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
# Tauri loads the application device plugin and invoke arguments reflectively.
-keep class app.chronoeon.desktop.DevicePlugin { *; }
-keep class app.chronoeon.desktop.LocateArgs { *; }

# reqwest uses these via JNI for Android system certificate verification.
-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }
