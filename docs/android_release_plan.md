# Android Release Plan for 3i/Atlas

## Pricing & Monetization
- Listing price: **$0.99 USD** on the Google Play Store.
- Enable family library sharing per Google policy.
- Optional future subscription tier for pro research bundles (not in scope for initial release).

## Store Listing Assets
- **App Icon**: Use `assets/3i_glow_icon.svg` adapted to 512x512 PNG, with glowing green 3i centerpiece.
- **Feature Graphic**: 1024x500 cyberpunk orbit scene with neon circuits and atlas trajectory overlay.
- **Screenshots**: Capture key experiences — Universe Command Center, Daily Spotlight, Badge Studio, Screensaver view.
- **Short Promo Video**: 30-second montage highlighting AI comparisons, telescope imagery, and interactive orbit.

## Compliance Checklist
- Provide privacy policy documenting data ingestion, academic source usage, telemetry storage.
- Declare location access if using device sensors for sky positioning.
- Ensure exported encryption notice for TLS usage.
- Age rating: Teen (contains space combat themes but no mature content).

## Release Workflow
1. **Build** using React Native with Android Gradle Plugin 8+ and Kotlin DSL.
2. **Automate** signing with Play App Signing; store keystore in secure vault.
3. **Fastlane** pipeline triggered from CI to produce bundles (`.aab`) and upload to Play Console.
4. **Internal Testing** with QA group focusing on telemetry accuracy and offline behavior.
5. **Closed Testing** with academic partners to validate document provenance and quoting.
6. **Production Rollout** staged at 20%, monitoring crash-free sessions via Firebase.

## Post-Launch
- Enable in-app reviews to solicit feedback.
- Schedule bi-weekly content refresh updates.
- Use Firebase Remote Config to toggle experimental AI comparison visualizations.

_Designed by Adrian Andrew Grimaldo_
