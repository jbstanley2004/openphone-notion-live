#!/bin/bash

# Set all required Notion database secrets
# Run this script to configure your production worker

echo "Setting NOTION_CALLS_DATABASE_ID..."
echo "40e7c635-6ce0-46a1-86cf-095801399fc8" | npx wrangler secret put NOTION_CALLS_DATABASE_ID

echo "Setting NOTION_MESSAGES_DATABASE_ID..."
echo "fd2b189c-dfc4-4f46-813d-4035960e7e15" | npx wrangler secret put NOTION_MESSAGES_DATABASE_ID

echo "Setting NOTION_CANVAS_DATABASE_ID..."
echo "fc0e485b6570460e995b94431b08f0a7" | npx wrangler secret put NOTION_CANVAS_DATABASE_ID

echo "Setting NOTION_MAIL_DATABASE_ID..."
echo "20af9371362f8031b737fda7c8c9797d" | npx wrangler secret put NOTION_MAIL_DATABASE_ID

echo ""
echo "✅ All database ID secrets have been set!"
echo ""
echo "⚠️  You still need to set these secrets manually:"
echo "  - NOTION_API_KEY"
echo "  - OPENPHONE_API_KEY"
echo ""
echo "Run these commands:"
echo "  npx wrangler secret put NOTION_API_KEY"
echo "  npx wrangler secret put OPENPHONE_API_KEY"
echo ""
echo "Don't forget to configure RECORDINGS_PUBLIC_BASE_URL in wrangler.jsonc (or via wrangler secret/var for previews) so"
echo "recording links resolve for Notion. Use https://pub-358b252982f749d78ef2628cb2b3450b.r2.dev and set"
echo "SELF_PHONE_NUMBERS to [\"+13365195544\"]."
