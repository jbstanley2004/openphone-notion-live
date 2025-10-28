#!/bin/bash
set -e

echo "Creating required Cloudflare resources for deployment..."

# Create Vectorize index (required for deployment)
echo "Creating Vectorize index 'openphone-calls'..."
npx wrangler vectorize create openphone-calls --dimensions=768 --metric=cosine

echo ""
echo "✅ Resources created successfully!"
echo ""
echo "Now deploying worker..."
npx wrangler deploy

echo ""
echo "✅ Deployment complete!"
