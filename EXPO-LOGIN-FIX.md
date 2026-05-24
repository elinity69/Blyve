# Expo CLI Login Problem lösen

## Das Problem
Expo fragt nach einem Login-Account im Terminal. Das ist **NICHT** der Demo-Account!

## Zwei verschiedene Logins:

### 1. Expo CLI Login (Terminal) - OPTIONAL
- **Was**: Login für Expo/EAS Services
- **Wann**: Nur wenn du Builds machen willst
- **Für**: Lokales Testen mit Expo Go **NICHT nötig**
- **Lösung**: Einfach überspringen!

### 2. Demo Account (in der App) - FÜR DIE APP
- **Was**: Login für deine Blyve App
- **Email**: `demo@test.com`
- **Password**: `demo123456`
- **Wo**: In Supabase erstellt

## Lösung: Expo CLI Login überspringen

### Option 1: Einfach Enter drücken (EMPFOHLEN)
Wenn im Terminal steht:
```
An Expo user account is required to proceed.
? Email or username »
```

**Einfach Enter drücken** (ohne etwas einzutippen)!

Die App läuft trotzdem weiter! Der Login ist nur für Builds nötig.

### Option 2: Expo Account erstellen (optional)
Falls du später Builds machen willst:
1. Gehe zu: https://expo.dev
2. Erstelle kostenlosen Account
3. Dann kannst du dich einloggen

### Option 3: Environment Variable setzen
Falls der Prompt stört, setze:
```powershell
$env:EXPO_NO_DOTENV=1
npx expo start --clear
```

## Wichtig
- **Expo CLI Login** = Für Builds (optional)
- **App Login** = Für deine App (demo@test.com)

Die App funktioniert auch ohne Expo CLI Login!

