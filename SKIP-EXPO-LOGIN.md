# Expo CLI Login überspringen

## Problem
Expo fragt nach einem Login-Account im Terminal. Das ist **optional** und nur für EAS Builds nötig.

## Lösung: Login überspringen

### Option 1: Einfach Enter drücken
Wenn nach Login gefragt wird:
- Drücke einfach **Enter** ohne etwas einzutippen
- Oder drücke **Ctrl+C** um den Prompt zu beenden
- Die App läuft trotzdem weiter!

### Option 2: Expo Go verwenden (KEIN Login nötig)
1. Starte Expo: `npx expo start --clear`
2. **Ignoriere** den Login-Prompt (Enter drücken)
3. Scanne den QR-Code mit **Expo Go** App
4. Die App sollte funktionieren!

### Option 3: Login komplett deaktivieren
Falls du den Login-Prompt komplett vermeiden willst:
- Erstelle einen kostenlosen Expo-Account auf expo.dev
- Oder verwende: `EXPO_NO_DOTENV=1 npx expo start --clear`

## Wichtig
Der Expo CLI Login ist **NICHT** der App-Login!
- **Expo CLI Login** = Für EAS Builds (optional)
- **App Login** = Für deine App (demo@test.com / demo123456)

Die App funktioniert auch ohne Expo CLI Login!

