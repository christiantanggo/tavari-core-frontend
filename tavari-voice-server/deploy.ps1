# PowerShell deployment script for AWS Elastic Beanstalk
# Uses Node.js script to create Linux-compatible zip

Write-Host "Building deployment package (Linux-compatible)..." -ForegroundColor Cyan

# Remove old zip if exists
if (Test-Path "tavari-voice-server-deployment.zip") {
    Remove-Item "tavari-voice-server-deployment.zip" -Force
}

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "ERROR: node_modules not found! Running 'npm install'..." -ForegroundColor Red
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: npm install failed. Please fix and try again." -ForegroundColor Red
        exit 1
    }
    Write-Host "npm install completed." -ForegroundColor Green
}

# Execute the Node.js zipping script
Write-Host "Creating Linux-compatible zip file..." -ForegroundColor Cyan
node build-zip.js

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Zip creation failed." -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Deployment package created: tavari-voice-server-deployment.zip" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Upload tavari-voice-server-deployment.zip to AWS Elastic Beanstalk"
Write-Host "2. Set environment variables in EB:"
Write-Host "   - PORT=8080"
Write-Host "   - SUPABASE_URL"
Write-Host "   - SUPABASE_SERVICE_ROLE_KEY"
Write-Host "   - OPENAI_API_KEY"
Write-Host "   - TELNYX_API_KEY"
Write-Host "   - TAVARI_VOICE_SERVER_URL=https://tavari-voice-server-env.eba-becmh8jt.us-east-2.elasticbeanstalk.com"
