// Explicitly configure Expo Router to use ./app instead of src/app
module.exports = {
  expo: {
    name: "Blyve",
    slug: "blyve",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.blyve.app"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff"
      },
      package: "com.blyve.app",
      googleMobileAdsAppId: "ca-app-pub-5310075752699995~7961931590"
    },
    web: {
      favicon: "./assets/favicon.png",
      bundler: "metro"
    },
    plugins: [
      [
        "react-native-google-mobile-ads",
        {
          androidAppId: "ca-app-pub-5310075752699995~7961931590",
          iosAppId: "ca-app-pub-5310075752699995~7961931590"
        }
      ],
      "expo-router"
    ],
    scheme: "blyve",
    extra: {
      router: {
        origin: false
      },
      eas: {
        projectId: "your-project-id"
      }
    }
  }
};
