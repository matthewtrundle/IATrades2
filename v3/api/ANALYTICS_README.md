# Analytics Dashboard API

A consolidated analytics endpoint for the IAGood trading bot that provides comprehensive trading metrics in a single performant API call.

## Overview

The analytics API aggregates data from all wallets, positions, trades, and flags into a unified response optimized for dashboard visualization. All queries run in parallel for optimal performance with a target response time of <2 seconds.

## Endpoints

### GET /analytics

Returns comprehensive trading metrics including:
- Summary statistics (P&L, trade counts, success rate, slippage)
- Active positions (OPEN/PARTIAL)
- Recent trade history (last 20 trades)
- Slippage distribution analysis
- Unresolved flags and issues
- Per-wallet performance breakdown

**Response Example:**
```json
{
  "summary": {
    "total_realized_pnl": 125.45,
    "total_trades": 87,
    "verified_trades": 85,
    "success_rate": 97.7,
    "avg_slippage_pct": 0.82,
    "max_slippage_pct": 4.23,
    "high_slippage_trades": 2,
    "total_open_positions": 3,
    "total_open_value": 1250.00
  },
  "positions": [...],
  "recent_trades": [...],
  "slippage_distribution": {
    "0-1%": 68,
    "1-3%": 15,
    "3-5%": 2,
    ">5%": 0
  },
  "flags": {
    "total_unresolved": 1,
    "by_severity": {
      "critical": 0,
      "warning": 1,
      "info": 0
    },
    "critical_issues": []
  },
  "wallet_performance": [...],
  "response_time_ms": 457
}
```

### GET /analytics/health

Health check endpoint for monitoring.

**Response Example:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-03T12:34:56.789Z",
  "database": "connected"
}
```

## Integration

The analytics router is already integrated into the main webhook server:

```typescript
import analyticsRouter from './analytics';

// In your Express app setup
app.use('/analytics', analyticsRouter);
```

## Data Sources

### Summary Statistics
- **Total Realized P&L**: Sum of `realized_pnl` from `positions` table
- **Trade Counts**: From `trades` table, filtered by status
- **Success Rate**: Percentage of verified trades vs total trades
- **Slippage Metrics**: Calculated from `actual_slippage_pct` in verified trades

### Active Positions
- All positions with status `OPEN` or `PARTIAL`
- Joined with `wallets` table for wallet names
- Includes current amount, entry price, and calculated value

### Recent Trades
- Last 20 trades with execution timestamps (DESC order)
- Includes wallet name, tokens, amounts, slippage, and signature
- Only trades that have been executed (not pending)

### Slippage Distribution
- Analyzes last 100 verified trades
- Groups into buckets: 0-1%, 1-3%, 3-5%, >5%
- Uses absolute value of slippage percentage

### Unresolved Flags
- All flags where `resolved = false`
- Grouped by severity (critical, warning, info)
- Critical issues returned in full for immediate visibility

### Wallet Performance
- Per-wallet aggregation of trades and P&L
- Includes timeframe information for SOL wallets
- Success rate, slippage stats, and open position count

## Performance Optimization

1. **Parallel Queries**: All data fetching uses `Promise.all()` to run queries simultaneously
2. **Limited Result Sets**:
   - Last 20 trades for display
   - Last 100 trades for slippage analysis
   - Active positions only (not closed)
3. **Database Indexes**: Uses existing indexes on:
   - `trades.status`
   - `trades.execution_timestamp`
   - `positions.status`
   - `position_flags.resolved`
4. **Efficient Aggregations**: Uses PostgreSQL CTEs and aggregates for calculations
5. **Slow Query Logging**: Automatically logs queries taking >1000ms

## Usage Examples

### Fetch Full Dashboard
```bash
curl http://localhost:3000/analytics
```

### Health Check
```bash
curl http://localhost:3000/analytics/health
```

### Using with TypeScript/Node.js
```typescript
import axios from 'axios';

const response = await axios.get('http://localhost:3000/analytics');
const data = response.data;

console.log(`Total P&L: $${data.summary.total_realized_pnl.toFixed(2)}`);
console.log(`Open Positions: ${data.summary.total_open_positions}`);
console.log(`Response Time: ${data.response_time_ms}ms`);
```

See `analytics-example.ts` for comprehensive usage examples.

## Key Metrics Explained

### Realized P&L
- Sum of `realized_pnl` from all positions
- Only includes closed or partial exits (NOT unrealized gains)
- Calculated by position tracker during SELL operations

### Success Rate
- Percentage of trades that reached `verified` status
- Does not include pending, failed, or rejected trades
- Indicates execution quality and reliability

### Slippage
- **Actual Slippage**: Difference between expected and actual output
- Calculated from verified on-chain transaction data
- High slippage (>5%) flagged separately in summary

### Open Position Value
- Sum of `current_amount * avg_entry_price` for active positions
- Represents capital currently deployed in positions
- Does NOT include unrealized P&L (just cost basis)

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200 OK`: Successful response with data
- `500 Internal Server Error`: Database or processing error

Error responses include:
```json
{
  "error": "Failed to fetch analytics data",
  "message": "Detailed error message",
  "response_time_ms": 123
}
```

## Monitoring

The analytics endpoint includes built-in monitoring:
- Response time tracking (included in every response)
- Slow query warnings (>1000ms logged to console)
- Health check endpoint for uptime monitoring

## Development

### Running Locally
```bash
# Start the webhook server (includes analytics)
cd v3/api
npx ts-node webhook.ts
```

### Testing
```bash
# Run the example script
npx ts-node analytics-example.ts
```

### Adding New Metrics

To add new metrics to the analytics response:

1. Add the field to the appropriate TypeScript interface
2. Modify the corresponding query function (e.g., `fetchSummaryStats()`)
3. Update the SQL query to fetch the new data
4. Add the field to the response object in the main route handler

Example:
```typescript
// Add to interface
interface SummaryStats {
  new_metric: number;
}

// Add to query
const result = await query(`
  SELECT
    ...,
    COUNT(*) FILTER (WHERE condition) as new_metric
  FROM ...
`);

// Add to return value
return {
  ...,
  new_metric: parseInt(row.new_metric) || 0,
};
```

## Database Schema Dependencies

The analytics API depends on these tables:
- `wallets`: Wallet information and configuration
- `trades`: All trade executions and their details
- `positions`: FIFO position tracking with P&L
- `position_flags`: Issues requiring manual review
- `balance_checks`: On-chain balance reconciliation (optional)

See `/db/schema.sql` for complete schema definitions.

## Notes

- All monetary values are in USD (for SOL wallets) or base currency
- Timestamps are returned in ISO 8601 format
- Slippage percentages are stored as decimals (5.0 = 5%)
- Position amounts use up to 9 decimal places for precision
- Response includes `response_time_ms` for performance monitoring
