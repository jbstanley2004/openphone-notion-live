#!/bin/bash

echo "Applying D1 migrations..."

for migration in $(ls migrations/*.sql | sort); do
  echo "  • Running $migration"
  npx wrangler d1 execute openphone-sync-db --file="$migration" >/tmp/d1-migration.log 2>&1
  if grep -qi "error" /tmp/d1-migration.log; then
    echo "    ⚠️  Warning executing $migration"
    cat /tmp/d1-migration.log
  else
    echo "    ✅ Migration applied"
  fi
done

echo ""
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
