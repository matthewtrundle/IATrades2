#!/bin/bash

# Analytics API Test Script
# Quick curl-based tests for the analytics endpoints

BASE_URL="http://localhost:3000"
ANALYTICS_URL="${BASE_URL}/analytics"
HEALTH_URL="${BASE_URL}/analytics/health"

echo "=========================================="
echo "Analytics API Test Script"
echo "=========================================="
echo ""

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
echo "GET ${HEALTH_URL}"
echo ""
HEALTH_RESPONSE=$(curl -s -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" "${HEALTH_URL}")
echo "$HEALTH_RESPONSE"
echo ""

if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
fi
echo ""
echo "=========================================="
echo ""

# Test 2: Full Analytics Endpoint
echo -e "${YELLOW}Test 2: Full Analytics Endpoint${NC}"
echo "GET ${ANALYTICS_URL}"
echo ""
ANALYTICS_RESPONSE=$(curl -s -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n" "${ANALYTICS_URL}")
echo "$ANALYTICS_RESPONSE"
echo ""

if echo "$ANALYTICS_RESPONSE" | grep -q "summary"; then
    echo -e "${GREEN}✅ Analytics endpoint passed${NC}"

    # Extract key metrics using jq if available
    if command -v jq &> /dev/null; then
        echo ""
        echo -e "${YELLOW}Key Metrics:${NC}"
        echo "$ANALYTICS_RESPONSE" | grep -v "HTTP Status" | grep -v "Response Time" | jq -r '
            "Total P&L: $" + (.summary.total_realized_pnl | tostring),
            "Total Trades: " + (.summary.total_trades | tostring) + " (" + (.summary.verified_trades | tostring) + " verified)",
            "Success Rate: " + (.summary.success_rate | tostring) + "%",
            "Avg Slippage: " + (if .summary.avg_slippage_pct then (.summary.avg_slippage_pct | tostring) + "%" else "N/A" end),
            "Open Positions: " + (.summary.total_open_positions | tostring),
            "Response Time: " + (.response_time_ms | tostring) + "ms"
        '
    fi
else
    echo -e "${RED}❌ Analytics endpoint failed${NC}"
fi
echo ""
echo "=========================================="
echo ""

# Test 3: Performance Check
echo -e "${YELLOW}Test 3: Performance Check${NC}"
echo "Running 5 requests to measure average response time..."
echo ""

TOTAL_TIME=0
for i in {1..5}; do
    RESPONSE_TIME=$(curl -s -w "%{time_total}" -o /dev/null "${ANALYTICS_URL}")
    echo "Request $i: ${RESPONSE_TIME}s"
    TOTAL_TIME=$(echo "$TOTAL_TIME + $RESPONSE_TIME" | bc)
done

AVG_TIME=$(echo "scale=3; $TOTAL_TIME / 5" | bc)
echo ""
echo "Average Response Time: ${AVG_TIME}s"

# Check if response time is under 2 seconds
if (( $(echo "$AVG_TIME < 2.0" | bc -l) )); then
    echo -e "${GREEN}✅ Performance target met (<2s)${NC}"
else
    echo -e "${RED}⚠️  Performance target not met (>2s)${NC}"
fi
echo ""
echo "=========================================="
echo ""

# Test 4: Error Handling
echo -e "${YELLOW}Test 4: Error Handling${NC}"
echo "Testing invalid endpoint: GET ${BASE_URL}/analytics/invalid"
echo ""
INVALID_RESPONSE=$(curl -s -w "\nHTTP Status: %{http_code}\n" "${BASE_URL}/analytics/invalid")
echo "$INVALID_RESPONSE"
echo ""

if echo "$INVALID_RESPONSE" | grep -q "404"; then
    echo -e "${GREEN}✅ Error handling works correctly${NC}"
else
    echo -e "${YELLOW}⚠️  Unexpected response for invalid endpoint${NC}"
fi
echo ""
echo "=========================================="
echo ""

# Test 5: Response Structure Validation
echo -e "${YELLOW}Test 5: Response Structure Validation${NC}"
echo "Checking for required fields in response..."
echo ""

if command -v jq &> /dev/null; then
    ANALYTICS_JSON=$(curl -s "${ANALYTICS_URL}")

    REQUIRED_FIELDS=(
        ".summary"
        ".positions"
        ".recent_trades"
        ".slippage_distribution"
        ".flags"
        ".wallet_performance"
        ".response_time_ms"
    )

    ALL_PRESENT=true
    for field in "${REQUIRED_FIELDS[@]}"; do
        if echo "$ANALYTICS_JSON" | jq -e "$field" > /dev/null 2>&1; then
            echo -e "  ${GREEN}✓${NC} $field"
        else
            echo -e "  ${RED}✗${NC} $field"
            ALL_PRESENT=false
        fi
    done

    echo ""
    if [ "$ALL_PRESENT" = true ]; then
        echo -e "${GREEN}✅ All required fields present${NC}"
    else
        echo -e "${RED}❌ Some fields missing${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  jq not installed, skipping structure validation${NC}"
fi
echo ""
echo "=========================================="
echo ""

echo -e "${GREEN}All tests completed!${NC}"
echo ""
echo "Note: If the server is not running, start it with:"
echo "  cd v3/api && npx ts-node webhook.ts"
echo ""
