#!/bin/bash

echo "Checking/creating Vectorize index..."

# Try to create the Vectorize index - if it exists, this will fail but that's OK
npx wrangler vectorize create openphone-calls --dimensions=768 --metric=cosine 2>&1 | tee /tmp/vectorize-create.log

# Check if creation failed because index already exists (this is OK)
if grep -q "already exists" /tmp/vectorize-create.log; then
  echo "✅ Vectorize index already exists, proceeding with deployment"
elif grep -q "Successfully created" /tmp/vectorize-create.log; then
  echo "✅ Vectorize index created successfully"
elif grep -q "error" /tmp/vectorize-create.log; then
  echo "⚠️  Warning: Could not verify Vectorize index status, attempting deployment anyway"
fi

echo ""
echo "Deploying worker..."
npx wrangler versions upload

echo ""
echo "✅ Deployment complete!"
