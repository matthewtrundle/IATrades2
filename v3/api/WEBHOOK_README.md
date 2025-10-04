# TradingView Webhook Handler

Production-ready Express webhook server for IAGood trading bot. Receives TradingView alerts and executes trades via Jupiter with Helius verification.

## Architecture

```
Authenticate → Parse → Route → Validate → Quote → Execute → Verify → Record → Respond
```

## Quick Start

### 1. Setup Environment Variables

```bash
# Required in .env
WEBHOOK_API_KEY=your-secret-webhook-key
SOLANA_RPC_URL=your-rpc-url
HELIUS_API_KEY=your-helius-api-key
DATABASE_URL=postgresql://user:pass@localhost/iagood
OPERATIONAL_SEED=your-base64-wallet-seed
```

### 2. Start the Server

```bash
npm run webhook
```

Server starts on `http://localhost:3000`

### 3. Test the Webhook

```bash
cd v3/api
./test-webhook.sh YOUR_WEBHOOK_API_KEY
```

## TradingView Alert Configuration

### Alert Message Format

```json
{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "timeframe": "30",
  "price": "{{close}}"
}
```

### Webhook URL

```
http://your-server.com:3000/webhook?apiKey=YOUR_WEBHOOK_API_KEY
```

Or use header authentication:
- Header: `x-api-key: YOUR_WEBHOOK_API_KEY`

## Trading Rules

### SOL Trades (symbol: SOLUSD)

**Routing:** By timeframe
- `timeframe="30"` → SOL_30M wallet
- `timeframe="60"` → SOL_60M wallet
- `timeframe="240"` → SOL_240M wallet

**Trade pairs:**
- BUY: USDC → SOL (keeps 0.01 SOL for gas)
- SELL: SOL → USDC (keeps 0.01 SOL for gas)

**Example alerts:**

```json
// BUY signal on 30m chart
{
  "symbol": "SOLUSD",
  "action": "BUY",
  "timeframe": "30",
  "price": "{{close}}"
}

// SELL signal on 60m chart
{
  "symbol": "SOLUSD",
  "action": "SELL",
  "timeframe": "60",
  "price": "{{close}}"
}
```

### Meme Coin Trades

**Routing:** By symbol (timeframe ignored)
- `symbol="FARTCOIN"` → FARTCOIN wallet
- `symbol="FARTBOY"` → FARTBOY wallet
- `symbol="USELESS"` → USELESS wallet

**Trade pairs:**
- BUY: SOL → MEME (keeps 0.01 SOL for gas)
- SELL: MEME → SOL (entire position)

**Example alerts:**

```json
// BUY FARTCOIN
{
  "symbol": "FARTCOIN",
  "action": "BUY",
  "timeframe": "30",
  "price": "{{close}}"
}

// SELL FARTBOY
{
  "symbol": "FARTBOY",
  "action": "SELL",
  "timeframe": "60",
  "price": "{{close}}"
}
```

## API Reference

### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-03T12:00:00.000Z",
  "database": "connected"
}
```

### Webhook Endpoint

```bash
POST /webhook
```

**Authentication:**
- Query param: `?apiKey=YOUR_KEY`
- OR Header: `x-api-key: YOUR_KEY`

**Request Body:**
```json
{
  "symbol": "SOLUSD",
  "action": "BUY",
  "timeframe": "30",
  "price": "180.50"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "tradeId": 123,
  "signature": "5x7K...",
  "inputAmount": 100.5,
  "outputAmount": 0.558,
  "actualSlippage": 0.15
}
```

**Error Response (400/401/500):**
```json
{
  "success": false,
  "reason": "insufficient_balance",
  "error": "Insufficient USDC balance: 5.0 (minimum: 10.0)"
}
```

## Error Codes

| Reason | HTTP | Description |
|--------|------|-------------|
| `authentication_failed` | 401 | Invalid API key |
| `parse_failed` | 400 | Invalid request format |
| `routing_failed` | 400 | Invalid symbol/timeframe |
| `insufficient_balance` | 400 | Not enough tokens |
| `no_open_position` | 400 | SELL without position |
| `quote_failed` | 400 | Jupiter quote rejected |
| `execution_failed` | 500 | Swap transaction failed |
| `verification_failed` | 500 | On-chain verification failed |
| `internal_error` | 500 | Unexpected server error |

## Pre-Execution Validations

The webhook validates BEFORE executing:

1. **Authentication:** API key must match `WEBHOOK_API_KEY`
2. **Required fields:** `symbol`, `action`, `timeframe` must be present
3. **Valid symbol:** Must be SOLUSD, FARTCOIN, FARTBOY, or USELESS
4. **Valid action:** Must be BUY or SELL (case insensitive)
5. **Sufficient balance:** Wallet must have enough input tokens
6. **Position exists (SELL only):** Must have open position to sell
7. **Quote quality:** Price impact < 3%, slippage < 3%, max 2 hops

## Execution Flow

### Successful Trade

1. **Authenticate:** Verify API key
2. **Parse:** Extract symbol, action, timeframe
3. **Route:** Determine wallet and token pair
4. **Validate:** Check balance and position
5. **Calculate:** Determine trade amounts (full balance - gas)
6. **Record:** Create pending trade in database
7. **Quote:** Get Jupiter quote, validate quality
8. **Execute:** Submit transaction to Solana
9. **Verify:** Confirm on-chain via Helius
10. **Update:** Record verified amounts and slippage
11. **Position:** Update FIFO position tracker
12. **Balance:** Run post-trade balance check
13. **Respond:** Return success with signature

### Failed Trade

At any step, if validation fails:
1. Record failure reason in database
2. Return clear error response
3. Log detailed error context
4. NO retries - fail fast

## Position Tracking

The webhook maintains FIFO position tracking:

### BUY Trade
- Creates new position if none exists
- Adds to existing position (updates average entry price)
- Records cost basis for future P&L calculation

### SELL Trade
- Validates position exists
- Checks sell amount doesn't exceed position
- Calculates realized P&L using FIFO cost basis
- Closes or partially closes position
- Flags issues for manual review

## Balance Verification

After each trade, the webhook:
1. Queries on-chain balances via Helius
2. Records balance snapshot in database
3. Detects discrepancies vs expected balances
4. Logs warnings for manual investigation

## Database Records

### Trades Table
Every webhook call creates a record:
- Pending: Initial webhook received
- Quoted: Jupiter quote obtained
- Executed: Transaction submitted
- Verified: On-chain confirmation
- Failed: Rejected at any step

### Positions Table
FIFO position tracking:
- OPEN: Active position
- PARTIAL: Partially closed
- CLOSED: Fully exited

### Position Flags Table
Anomalies requiring review:
- `sell_without_position`: SELL with no open position
- `sell_exceeds_position`: SELL amount > position size
- `balance_mismatch`: On-chain != expected balance

## Monitoring

### Success Criteria
- Response time < 5 seconds
- Success rate > 95%
- No phantom trades (verified on-chain)
- No position mismatches

### Key Logs

```bash
# Successful trade
[WEBHOOK] SUCCESS in 3421ms: 5x7K...

# Failed validation
[WEBHOOK] Pre-validation failed: Insufficient USDC balance

# Position tracking
[PositionTracker] Opened position: 0.558 SOL @ 180.25
[PositionTracker] Sold 0.558 SOL from position 123: P&L 5.25 (2.91%)

# Balance check
[WEBHOOK] Balance check: SOL = 0.015
```

## Security

1. **API Key Authentication:** All requests require valid `WEBHOOK_API_KEY`
2. **No Retries:** Failed trades must be manually reviewed
3. **Position Validation:** Cannot sell more than available
4. **Gas Reserves:** Always keeps 0.01 SOL for fees
5. **Quote Validation:** Rejects poor quality trades (high slippage/impact)

## Troubleshooting

### Webhook not responding
```bash
# Check if server is running
curl http://localhost:3000/health

# Check logs
npm run webhook
```

### Authentication failures
```bash
# Verify API key in .env
echo $WEBHOOK_API_KEY

# Test with correct key
curl -H "x-api-key: YOUR_KEY" http://localhost:3000/webhook
```

### Database connection errors
```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check database health
npm run db:setup
```

### Balance issues
```bash
# Check wallet balances directly via Helius
# Review balance_checks table
psql $DATABASE_URL -c "SELECT * FROM balance_checks ORDER BY check_timestamp DESC LIMIT 10"
```

### Position mismatches
```bash
# Review position flags
psql $DATABASE_URL -c "SELECT * FROM position_flags WHERE resolved = false"

# Check open positions
psql $DATABASE_URL -c "SELECT * FROM positions WHERE status IN ('OPEN', 'PARTIAL')"
```

## Production Deployment

### Requirements
- Node.js 18+
- PostgreSQL 14+
- Valid Helius API key
- Valid Solana RPC endpoint
- Secure WEBHOOK_API_KEY

### Environment Setup
```bash
# Production environment variables
export NODE_ENV=production
export WEBHOOK_API_KEY=$(openssl rand -base64 32)
export SOLANA_RPC_URL=https://your-rpc-provider.com
export HELIUS_API_KEY=your-helius-key
export DATABASE_URL=postgresql://user:pass@host:5432/iagood
```

### Run with PM2
```bash
npm install -g pm2
pm2 start "npm run webhook" --name iagood-webhook
pm2 save
pm2 startup
```

### Monitoring
```bash
# View logs
pm2 logs iagood-webhook

# Monitor status
pm2 monit

# Restart if needed
pm2 restart iagood-webhook
```

## File Structure

```
v3/api/
├── webhook.ts           # Main webhook handler (Express server)
├── test-webhook.sh      # Testing script
└── WEBHOOK_README.md    # This file

v3/dex/
└── jupiter.ts           # Jupiter DEX integration

v3/helius/
├── client.ts            # Helius API client
├── verifier.ts          # Transaction verification
└── balance-sync.ts      # Balance reconciliation

v3/core/
└── position-tracker.ts  # FIFO position tracking

lib/
├── db/client.ts         # PostgreSQL client
├── wallet/generator.ts  # Deterministic wallet generation
└── config/
    ├── tokens.ts        # Token configurations
    └── constants.ts     # System constants
```

## Support

For issues or questions:
1. Check logs: `npm run webhook` output
2. Review database: `psql $DATABASE_URL`
3. Test manually: `./test-webhook.sh YOUR_API_KEY`
4. Verify balances: Check Solana Explorer
