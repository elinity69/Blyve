# Login Informationen

## 1. Expo CLI Login (Terminal)
Wenn im Terminal nach einem Expo-Account gefragt wird:
- **Optional** - Du kannst es überspringen (nur für EAS Builds nötig)
- Oder registriere dich kostenlos auf expo.dev
- Für lokales Testen mit Expo Go **nicht erforderlich**

## 2. App Login (in der App)

### Demo Account (sollte automatisch funktionieren):
- **Email**: `demo@test.com`
- **Password**: `demo123456`

### Falls Auto-Login nicht funktioniert:

1. **Stelle sicher, dass der Demo-Account in Supabase existiert:**
   - Gehe zu Supabase Dashboard → Authentication → Users
   - Prüfe ob `demo@test.com` existiert
   - Falls nicht, erstelle ihn manuell:
     - Email: `demo@test.com`
     - Password: `demo123456`

2. **In der App:**
   - Gib die Demo-Credentials ein, ODER
   - Klicke auf "Try Demo Account" Button

### Test Account erstellen (falls Demo nicht existiert):

1. Öffne Supabase Dashboard
2. Gehe zu Authentication → Users
3. Klicke "Add User" → "Create new user"
4. Email: `demo@test.com`
5. Password: `demo123456`
6. Klicke "Create User"

Dann sollte die App automatisch einloggen!

