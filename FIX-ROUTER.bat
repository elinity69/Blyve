@echo off
echo ========================================
echo Fixing Expo Router Path Issue
echo ========================================
echo.
echo This script will rename src/app to prevent Expo Router confusion
echo.
pause

echo Checking if src/app exists...
if exist "src\app" (
    echo Found src/app - renaming to src/_old-vite-app...
    move /Y "src\app" "src\_old-vite-app"
    if exist "src\_old-vite-app" (
        echo.
        echo SUCCESS! src/app has been renamed to src/_old-vite-app
        echo.
        echo Now restart Expo with:
        echo   npx expo start --clear
        echo.
    ) else (
        echo ERROR: Could not rename directory
        echo Make sure Expo is stopped and no files are open
    )
) else (
    echo src/app does not exist - good!
    echo Expo should use the app/ directory correctly
)

pause

