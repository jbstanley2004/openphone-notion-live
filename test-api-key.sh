#!/bin/bash

# Test OpenPhone API Key
# This script tests if your API key is working correctly

API_KEY="eCwBlRTGdzepopMViWX3yNEpIoUQ8zEL"

echo "=== Testing OpenPhone API Key ==="
echo ""

echo "Test 1: Get Phone Numbers"
curl -s -H "Authorization: $API_KEY" "https://api.openphone.com/v1/phone-numbers" | python3 -m json.tool | head -20
echo ""

echo "Test 2: Get Users"
curl -s -H "Authorization: $API_KEY" "https://api.openphone.com/v1/users" | python3 -m json.tool | head -20
echo ""

echo "Test 3: Test with Bearer prefix (should fail)"
curl -s -H "Authorization: Bearer $API_KEY" "https://api.openphone.com/v1/phone-numbers" | python3 -m json.tool | head -10
echo ""

echo "=== Tests Complete ==="
echo ""
echo "If Test 1 and 2 show data, your API key is correct."
echo "If they show 401 errors, you need a different API key."
