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

# ===== Smart Feni — R8 (minify) keep rules =====

# Crash/ANR ট্রেস পড়ার জন্য লাইন নম্বর ও সোর্স ফাইল নাম রাখা
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,InnerClasses,EnclosingMethod
-renamesourcefileattribute SourceFile

# আমাদের নিজের নেটিভ কোড (MainActivity, InstallReferrerPlugin)
-keep class com.smartfeni.app.** { *; }

# Capacitor প্লাগিন (রিফ্লেকশনে নাম ধরে লোড হয়)
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
}

# Cordova bridge (capacitor-cordova-android-plugins)
-keep class org.apache.cordova.** { *; }

# WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Google Play Install Referrer
-keep class com.android.installreferrer.** { *; }

-dontwarn org.apache.cordova.**
