#!/bin/bash

# Test script for TradingView webhook handler
# Usage: ./test-webhook.sh [API_KEY]

API_KEY="${1:-your-webhook-api-key-here}"
WEBHOOK_URL="http://localhost:3000/webhook"

echo "Testing IAGood Webhook Handler"
echo "================================"
echo ""

# Test 1: Health check
echo "Test 1: Health Check"
echo "--------------------"
curl -s http://localhost:3000/health | jq '.'
echo ""
echo ""

# Test 2: Invalid API key
echo "Test 2: Invalid API Key (should fail with 401)"
echo "-----------------------------------------------"
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: invalid-key" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"180.50"}' | jq '.'
echo ""
echo ""

# Test 3: Missing required fields
echo "Test 3: Missing Required Fields (should fail with 400)"
echo "-------------------------------------------------------"
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"action":"BUY","timeframe":"30"}' | jq '.'
echo ""
echo ""

# Test 4: Invalid symbol
echo "Test 4: Invalid Symbol (should fail with 400)"
echo "----------------------------------------------"
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"BTCUSD","action":"BUY","timeframe":"30","price":"45000.00"}' | jq '.'
echo ""
echo ""

# Test 5: Invalid action
echo "Test 5: Invalid Action (should fail with 400)"
echo "----------------------------------------------"
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"SOLUSD","action":"HOLD","timeframe":"30","price":"180.50"}' | jq '.'
echo ""
echo ""

# Test 6: Valid SOL BUY (30m timeframe)
echo "Test 6: Valid SOL BUY - 30m timeframe"
echo "--------------------------------------"
echo "NOTE: This will execute a real trade if API key is valid and wallet has funds!"
echo ""
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"180.50"}' | jq '.'
echo ""
echo ""

# Test 7: Valid SOL SELL (60m timeframe)
echo "Test 7: Valid SOL SELL - 60m timeframe"
echo "---------------------------------------"
echo "NOTE: This will execute a real trade if API key is valid and wallet has position!"
echo ""
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"SOLUSD","action":"SELL","timeframe":"60","price":"185.75"}' | jq '.'
echo ""
echo ""

# Test 8: Valid MEME BUY (FARTCOIN)
echo "Test 8: Valid MEME BUY - FARTCOIN"
echo "---------------------------------"
echo "NOTE: This will execute a real trade if API key is valid and wallet has SOL!"
echo ""
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"FARTCOIN","action":"BUY","timeframe":"30","price":"0.05"}' | jq '.'
echo ""
echo ""

# Test 9: Valid MEME SELL (FARTBOY)
echo "Test 9: Valid MEME SELL - FARTBOY"
echo "---------------------------------"
echo "NOTE: This will execute a real trade if API key is valid and wallet has position!"
echo ""
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"symbol":"FARTBOY","action":"SELL","timeframe":"60","price":"0.03"}' | jq '.'
echo ""
echo ""

echo "================================"
echo "Tests Complete"
echo "================================"
