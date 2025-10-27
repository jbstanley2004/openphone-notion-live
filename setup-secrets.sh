#!/bin/bash
set -e

echo "🔐 Setting up Cloudflare Worker Secrets"
echo "========================================"
echo ""

# Check if wrangler is available
if ! command -v npx &> /dev/null; then
    echo "❌ Error: npm/npx not found. Please install Node.js"
    exit 1
fi

# Set Canvas Database ID (required)
echo "📊 Setting NOTION_CANVAS_DATABASE_ID..."
echo "fc0e485b6570460e995b94431b08f0a7" | npx wrangler secret put NOTION_CANVAS_DATABASE_ID

echo ""
echo "✅ Canvas database ID configured successfully!"
echo ""
echo "Next steps:"
echo "1. Set other required secrets:"
echo "   npx wrangler secret put OPENPHONE_API_KEY"
echo "   npx wrangler secret put NOTION_API_KEY"  
echo "   npx wrangler secret put NOTION_CALLS_DATABASE_ID"
echo "   npx wrangler secret put NOTION_MESSAGES_DATABASE_ID"
echo ""
echo "2. Deploy:"
echo "   npm run deploy"
