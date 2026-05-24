# Script to fix Expo Router path issue
# Run this AFTER stopping Expo (Ctrl+C)

Write-Host "Fixing Expo Router path issue..."
Write-Host ""

# Check if src/app exists
if (Test-Path "src\app") {
    Write-Host "Found src/app directory - this is causing Expo to use the wrong path"
    Write-Host "Renaming src/app to src/_old-app..."
    
    # Try to rename
    try {
        Rename-Item -Path "src\app" -NewName "_old-app" -Force
        Write-Host "✅ Successfully renamed src/app to src/_old-app"
        Write-Host ""
        Write-Host "Now restart Expo with: npx expo start --clear"
    } catch {
        Write-Host "❌ Error: Could not rename directory. Make sure:"
        Write-Host "   1. Expo is stopped (Ctrl+C)"
        Write-Host "   2. No files in src/app are open in your editor"
        Write-Host "   3. Try closing your IDE and running this script again"
    }
} else {
    Write-Host "✅ src/app does not exist - this is good!"
    Write-Host "Expo should now use the app/ directory correctly"
}

Write-Host ""
Write-Host "Done!"

