# IAGood Trading Bot - Test Plan

**Version:** 1.0
**Date:** 2025-10-03
**Purpose:** Comprehensive testing checklist before live trading

---

## ⚠️ CRITICAL: Pre-Test Requirements

### 1. Fund Wallets (REQUIRED)

**You must fund the wallets before testing trades:**

#### SOL Timeframe Wallets (Trade USDC ↔ SOL):
```bash
# Each wallet needs:
# - USDC for buying SOL (e.g., 10-20 USDC for testing)
# - 0.05 SOL for gas fees

SOL_30M:  BBovcPV4qVeP3FNtFNwAedNmpZiNz44CVnzJM1oaqXxj
SOL_60M:  3LfrLWN61T28EmSGZjueX65zGan5sMk11T3KXjZSccyW
SOL_240M: 6NwDLHfq3xiWpBBc3dHPFX4L1GJwjgrcQqGN9NjMcPaF
```

#### Meme Coin Wallets (Trade SOL ↔ MEME):
```bash
# Each wallet needs:
# - 0.1+ SOL for buying meme coins and gas

FARTCOIN: Xo8Kgmc6Cjv5Vvxio8QWi53pJP41EJy5RyAo4Kag2mQ
FARTBOY:  8GNaBxzgJRGQ1SK3NJgDcWKYTEHX1J6D3ZYUXictpC4U
USELESS:  4dyVnEqAQzdATexWzhq7fwnYBkpvJK4aSKVbxtRxenYb
```

**How to Fund:**
1. Use Phantom wallet to send funds
2. Or use CLI: `spl-transfer --from your_wallet --to TARGET_ADDRESS AMOUNT`
3. Verify balances on Solana Explorer before testing

---

## 🧪 Phase 1: System Infrastructure Tests

### Test 1.1: Database Connectivity
```bash
# Check PostgreSQL is running
pg_isready

# Verify database exists
psql -l | grep iagood

# Check tables
psql iagood -c "\dt"

# Verify wallets are initialized
psql iagood -c "SELECT name, address, trading_pair FROM wallets;"
```

**Expected Output:**
- 6 wallets with addresses matching above
- All 6 tables exist: wallets, trades, positions, position_flags, balance_checks

**Status:** [ ] PASS / [ ] FAIL

---

### Test 1.2: Wallet Generation
```bash
# Create test script to verify wallet addresses
cat > test-wallets.ts << 'EOF'
import { getAllWallets } from './lib/wallet/generator';

const wallets = getAllWallets();
console.log('SOL_30M: ', wallets.sol_30m.publicKey.toString());
console.log('SOL_60M: ', wallets.sol_60m.publicKey.toString());
console.log('SOL_240M:', wallets.sol_240m.publicKey.toString());
console.log('FARTCOIN:', wallets.fartcoin.publicKey.toString());
console.log('FARTBOY: ', wallets.fartboy.publicKey.toString());
console.log('USELESS: ', wallets.useless.publicKey.toString());
EOF

npx tsx test-wallets.ts
```

**Expected Output:** Addresses match database records

**Status:** [ ] PASS / [ ] FAIL

---

### Test 1.3: Server Startup
```bash
# Start webhook server
npm run webhook
```

**Expected Output:**
- "Webhook server listening on port 3000"
- No errors in console

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 2: API Endpoint Tests

### Test 2.1: Health Check
```bash
curl http://localhost:3000/health
```

**Expected Response:**
```json
{"status":"healthy","timestamp":"..."}
```

**Status:** [ ] PASS / [ ] FAIL

---

### Test 2.2: Analytics Endpoint (Empty State)
```bash
curl http://localhost:3000/analytics | jq .
```

**Expected Response:**
```json
{
  "summary": {
    "total_realized_pnl": 0,
    "total_trades": 0,
    "verified_trades": 0,
    ...
  },
  "positions": [],
  "recent_trades": [],
  ...
}
```

**Status:** [ ] PASS / [ ] FAIL

---

### Test 2.3: Webhook Authentication
```bash
# Test 1: No auth (should fail)
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'

# Expected: {"success":false,"reason":"unauthorized","error":"Missing API key"}

# Test 2: Wrong auth (should fail)
curl -X POST "http://localhost:3000/webhook?apiKey=wrong" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'

# Expected: {"success":false,"reason":"unauthorized","error":"Invalid API key"}

# Test 3: Correct auth + invalid payload (should fail with validation error)
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"INVALID","action":"BUY","timeframe":"30","price":"241"}'

# Expected: {"success":false,"reason":"invalid_symbol",...}
```

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 3: Trade Execution Tests (REQUIRES FUNDED WALLETS)

### Test 3.1: SOL Buy (30m Timeframe) - SMALL TEST

**Prerequisites:**
- SOL_30M wallet has at least 2 USDC
- SOL_30M wallet has at least 0.05 SOL for gas

```bash
# Get current USDC and SOL balance
curl "https://api.helius.xyz/v0/addresses/BBovcPV4qVeP3FNtFNwAedNmpZiNz44CVnzJM1oaqXxj/balances?api-key=4a267fa7-ad3a-41f2-9a0c-a47b0fcbcf53"

# Execute small SOL buy
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241.50"}'
```

**Expected Response:**
```json
{
  "success": true,
  "tradeId": 1,
  "signature": "5x7K...",
  "inputAmount": 1000000,  // 1 USDC (6 decimals)
  "outputAmount": 4145728, // ~0.004 SOL (9 decimals)
  "actualSlippage": 0.25
}
```

**Verification Steps:**
1. Check trade record: `psql iagood -c "SELECT * FROM trades WHERE id=1;"`
2. Check position: `psql iagood -c "SELECT * FROM positions WHERE wallet_id=1;"`
3. Check Solana Explorer: `https://solscan.io/tx/[signature]`
4. Check analytics: `curl http://localhost:3000/analytics | jq .summary`

**Status:** [ ] PASS / [ ] FAIL

---

### Test 3.2: SOL Sell (30m Timeframe)

**Prerequisites:**
- Test 3.1 passed (position exists)
- SOL_30M wallet has SOL to sell

```bash
# Execute SOL sell
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"SELL","timeframe":"30","price":"242.00"}'
```

**Expected Response:**
```json
{
  "success": true,
  "tradeId": 2,
  "signature": "...",
  "inputAmount": ...,
  "outputAmount": ...,
  "actualSlippage": ...
}
```

**Verification Steps:**
1. Check position status changed to CLOSED
2. Check realized_pnl is calculated
3. Verify P&L in analytics dashboard
4. Confirm balance returned to USDC

**Status:** [ ] PASS / [ ] FAIL

---

### Test 3.3: Different Timeframe (60m)

**Prerequisites:**
- SOL_60M wallet has USDC + SOL for gas

```bash
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"60","price":"241.50"}'
```

**Expected:** Routes to SOL_60M wallet (wallet_id=2)

**Status:** [ ] PASS / [ ] FAIL

---

### Test 3.4: Meme Coin Trade (FARTCOIN)

**Prerequisites:**
- FARTCOIN wallet has 0.1+ SOL

```bash
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"FARTCOIN","action":"BUY","timeframe":"15","price":"0.58"}'
```

**Expected:**
- Routes to FARTCOIN wallet (wallet_id=4)
- Swaps SOL → FARTCOIN
- Timeframe ignored for meme coins

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 4: Validation Tests

### Test 4.1: Reject High Slippage

**Setup:** Try to trade a token with low liquidity or large amount

```bash
# This should be rejected if slippage > 3%
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"USELESS","action":"BUY","timeframe":"30","price":"0.001"}'
```

**Expected:** May fail with quote validation error if market conditions cause >3% slippage

**Status:** [ ] PASS / [ ] FAIL / [ ] N/A (good liquidity)

---

### Test 4.2: Reject Sell Without Position

```bash
# Try to sell SOL on 240m wallet without buying first
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"SELL","timeframe":"240","price":"241"}'
```

**Expected Response:**
```json
{
  "success": false,
  "reason": "no_position",
  "error": "Cannot sell: no open position for SOL in wallet SOL_240M"
}
```

**Status:** [ ] PASS / [ ] FAIL

---

### Test 4.3: Reject Insufficient Balance

```bash
# Try to buy with empty wallet (assuming you haven't funded SOL_240M)
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"240","price":"241"}'
```

**Expected Response:**
```json
{
  "success": false,
  "reason": "insufficient_balance",
  "error": "Insufficient USDC balance (need gas reserve)"
}
```

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 5: Data Integrity Tests

### Test 5.1: Position Tracking Accuracy

```bash
# After Test 3.1 and 3.2, verify FIFO accounting
psql iagood -c "
SELECT
  p.id,
  w.name as wallet,
  p.token,
  p.status,
  p.total_entry_amount,
  p.total_entry_cost,
  p.avg_entry_price,
  p.current_amount,
  p.realized_pnl
FROM positions p
JOIN wallets w ON p.wallet_id = w.id
ORDER BY p.id;
"
```

**Manual Verification:**
- avg_entry_price = total_entry_cost / total_entry_amount
- realized_pnl = proceeds - (avg_entry_price * exit_amount)
- current_amount = total_entry_amount - total_exit_amount

**Status:** [ ] PASS / [ ] FAIL

---

### Test 5.2: On-Chain Verification

```bash
# Pick a successful trade signature from Test 3.1
SIGNATURE="<your_signature_here>"

# Verify via Helius
curl "https://api.helius.xyz/v0/transactions/${SIGNATURE}?api-key=4a267fa7-ad3a-41f2-9a0c-a47b0fcbcf53" | jq .

# Compare tokenTransfers with database trade record
psql iagood -c "SELECT input_token, input_amount, output_token, output_amount FROM trades WHERE signature='${SIGNATURE}';"
```

**Manual Verification:**
- Token transfers match database records
- Amounts match (accounting for decimals)
- Fees recorded correctly

**Status:** [ ] PASS / [ ] FAIL

---

### Test 5.3: Balance Reconciliation

```bash
# Create balance sync test
cat > test-balance-sync.ts << 'EOF'
import { HeliusClient, BalanceSyncer } from './v3/helius';
import { getAllWallets } from './lib/wallet/generator';
import { TOKENS } from './lib/config/tokens';

async function testBalanceSync() {
  const client = new HeliusClient({ apiKey: process.env.HELIUS_API_KEY! });
  const syncer = new BalanceSyncer(client);
  const wallets = getAllWallets();

  // Check SOL_30M wallet USDC balance
  const result = await syncer.checkBalance({
    walletAddress: wallets.sol_30m.publicKey.toString(),
    tokenMint: TOKENS.USDC.mint,
    expectedBalance: 0, // We don't know expected, just want to see on-chain
    discrepancyThreshold: 0.01
  });

  console.log('SOL_30M USDC Balance:');
  console.log('  On-chain:', result.onchainBalance);
  console.log('  Discrepancy:', result.discrepancy);
  console.log('  Has mismatch:', result.hasDiscrepancy);
}

testBalanceSync();
EOF

npx tsx test-balance-sync.ts
```

**Expected:** On-chain balance matches expected state

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 6: Analytics Dashboard Tests

### Test 6.1: Summary Stats

```bash
curl http://localhost:3000/analytics | jq .summary
```

**Manual Verification:**
- total_realized_pnl matches positions table
- total_trades = count of trades
- success_rate = verified / total trades
- avg_slippage calculated correctly

**Status:** [ ] PASS / [ ] FAIL

---

### Test 6.2: Position Display

```bash
curl http://localhost:3000/analytics | jq .positions
```

**Expected:** Shows all OPEN and PARTIAL positions with correct data

**Status:** [ ] PASS / [ ] FAIL

---

### Test 6.3: Recent Trades

```bash
curl http://localhost:3000/analytics | jq .recent_trades
```

**Expected:** Shows last 20 trades in reverse chronological order

**Status:** [ ] PASS / [ ] FAIL

---

## 🧪 Phase 7: Error Recovery Tests

### Test 7.1: Duplicate Trade Prevention

```bash
# Try sending same alert twice within 30 seconds
curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'

sleep 2

curl -X POST "http://localhost:3000/webhook?apiKey=$(grep WEBHOOK_API_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'
```

**Note:** Current system doesn't have deduplication. Both will execute if wallet has funds.
Consider adding trade deduplication in future version.

**Status:** [ ] PASS / [ ] FAIL / [ ] N/A

---

### Test 7.2: Database Transaction Rollback

```bash
# Simulate trade failure mid-execution
# This is hard to test without modifying code
# Manual verification: Check that failed trades don't create positions
psql iagood -c "SELECT status, COUNT(*) FROM trades GROUP BY status;"
```

**Expected:** No orphaned positions for failed trades

**Status:** [ ] PASS / [ ] FAIL

---

## 📊 Test Results Summary

| Phase | Test | Status | Notes |
|-------|------|--------|-------|
| 1.1 | Database Connectivity | [ ] | |
| 1.2 | Wallet Generation | [ ] | |
| 1.3 | Server Startup | [ ] | |
| 2.1 | Health Check | [ ] | |
| 2.2 | Analytics (Empty) | [ ] | |
| 2.3 | Webhook Auth | [ ] | |
| 3.1 | SOL Buy (30m) | [ ] | Requires funded wallet |
| 3.2 | SOL Sell (30m) | [ ] | Requires Test 3.1 |
| 3.3 | Different Timeframe | [ ] | Requires funded wallet |
| 3.4 | Meme Coin Trade | [ ] | Requires funded wallet |
| 4.1 | Reject High Slippage | [ ] | May not trigger |
| 4.2 | Reject Sell w/o Position | [ ] | |
| 4.3 | Reject Insufficient Balance | [ ] | |
| 5.1 | Position Tracking | [ ] | Manual verification |
| 5.2 | On-Chain Verification | [ ] | Manual verification |
| 5.3 | Balance Reconciliation | [ ] | |
| 6.1 | Summary Stats | [ ] | |
| 6.2 | Position Display | [ ] | |
| 6.3 | Recent Trades | [ ] | |

---

## ✅ Sign-Off

**Tested By:** _________________
**Date:** _________________
**System Status:** [ ] READY FOR PRODUCTION / [ ] NEEDS FIXES

**Notes:**
_____________________________________________
_____________________________________________
_____________________________________________

---

## 🚀 Next Steps After Testing

1. [ ] Review all flagged issues in position_flags table
2. [ ] Verify P&L calculations match expectations
3. [ ] Set up monitoring and alerting
4. [ ] Deploy to production (Render)
5. [ ] Update TradingView with production webhook URL
6. [ ] Start with small position sizes
7. [ ] Monitor for 48 hours before scaling up
