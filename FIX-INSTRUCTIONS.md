# Fix Expo Router Path Issue

## Problem
Expo Router is detecting `src/app` instead of `app/` because both directories exist.

## Solution Options

### Option 1: Close IDE and Rename (RECOMMENDED)

1. **Close Cursor/VS Code completely** (all windows)
2. **Make sure Expo is stopped** (Ctrl+C in terminal)
3. **Run this command:**
   ```powershell
   Move-Item -Path "src\app" -Destination "src\_old-vite-app" -Force
   ```
4. **Restart Expo:**
   ```powershell
   npx expo start --clear
   ```

### Option 2: Use Windows Explorer

1. Close Cursor/VS Code
2. Stop Expo (Ctrl+C)
3. Open Windows Explorer
4. Navigate to your local Blyve project `src` folder
5. Right-click on the `app` folder
6. Select "Rename"
7. Rename it to `_old-vite-app`
8. Restart Expo: `npx expo start --clear`

### Option 3: Restart Computer (if above don't work)

Sometimes Windows locks files even after closing programs. A restart will release all file locks.

## After Renaming

You should see:
- ✅ "Using app as the root directory for Expo Router" (NOT src/app)
- ✅ App auto-logs in with demo account
- ✅ App works on web and Android

