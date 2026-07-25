#!/bin/bash
# Simple deployment script for AWS Elastic Beanstalk
# Creates a zip file with all necessary files

echo "Building deployment package..."

# Remove old zip if exists
rm -f tavari-voice-server-deployment.zip

# Create zip (exclude unnecessary files)
zip -r tavari-voice-server-deployment.zip . \
  -x "*.git*" \
  -x "*.zip" \
  -x "*.log" \
  -x "*.md" \
  -x ".env*" \
  -x "test-*" \
  -x "deploy.sh" \
  -x "node_modules/.cache/*" \
  -x "node_modules/.bin/*"

echo "✅ Deployment package created: tavari-voice-server-deployment.zip"
echo ""
echo "Next steps:"
echo "1. Upload tavari-voice-server-deployment.zip to AWS Elastic Beanstalk"
echo "2. Set environment variables:"
echo "   - PORT=8080"
echo "   - SUPABASE_URL"
echo "   - SUPABASE_SERVICE_ROLE_KEY"
echo "   - OPENAI_API_KEY"
echo "   - TELNYX_API_KEY"
echo "   - TAVARI_VOICE_SERVER_URL (your EB URL)"


