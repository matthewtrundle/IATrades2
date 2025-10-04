# IAGood Trading Bot - System Overview

**Version:** 1.0
**Date:** 2025-10-03
**Status:** ✅ Complete - Ready for Testing

---

## 🎯 System Architecture

```
TradingView Alert
       ↓
   [Webhook API] ← Authentication
       ↓
   Route by Symbol/Timeframe
       ↓
   [Wallet Selection] ← 6 Wallets (3 SOL TF + 3 Meme)
       ↓
   [Pre-Validation] ← Balance check, Position check
       ↓
   [Jupiter DEX] ← Get Quote, Validate Quality
       ↓
   [Execute Swap] ← On-chain transaction
       ↓
   [Helius Verify] ← Confirm on-chain execution
       ↓
   [Position Tracker] ← Update FIFO positions
       ↓
   [Balance Sync] ← Verify balances
       ↓
   [Analytics Dashboard] ← Monitor performance
```

---

## 📁 Project Structure

```
IAGood/
├── db/
│   ├── schema.sql              # PostgreSQL schema (6 tables)
│   └── init-wallets.ts         # Wallet address initialization
│
├── lib/                        # Shared infrastructure
│   ├── config/
│   │   ├── tokens.ts           # Token configs (SOL, USDC, 3 memes)
│   │   └── constants.ts        # System constants (slippage limits)
│   ├── wallet/
│   │   └── generator.ts        # Deterministic wallet generation
│   └── db/
│       └── client.ts           # PostgreSQL connection pool
│
├── v3/                         # Core trading system
│   ├── dex/
│   │   └── jupiter.ts          # Jupiter v6 integration (strict 3% slippage)
│   │
│   ├── helius/
│   │   ├── client.ts           # Helius API client
│   │   ├── verifier.ts         # Transaction verification
│   │   ├── balance-sync.ts     # Balance reconciliation
│   │   └── types.ts            # TypeScript interfaces
│   │
│   ├── core/
│   │   ├── position-tracker.ts # FIFO position tracking
│   │   └── types.ts            # Position interfaces
│   │
│   └── api/
│       ├── webhook.ts          # TradingView webhook handler
│       └── analytics.ts        # Analytics dashboard API
│
├── .env                        # Environment configuration
├── package.json                # Dependencies & scripts
└── tsconfig.json               # TypeScript configuration
```

---

## 🔑 6 Trading Wallets

| Wallet Name | Address | Trading Pair | Purpose |
|-------------|---------|--------------|---------|
| **SOL_30M** | `BBovcPV4qVeP3FNtFNwAedNmpZiNz44CVnzJM1oaqXxj` | USDC ↔ SOL | 30-minute timeframe trades |
| **SOL_60M** | `3LfrLWN61T28EmSGZjueX65zGan5sMk11T3KXjZSccyW` | USDC ↔ SOL | 60-minute timeframe trades |
| **SOL_240M** | `6NwDLHfq3xiWpBBc3dHPFX4L1GJwjgrcQqGN9NjMcPaF` | USDC ↔ SOL | 240-minute timeframe trades |
| **FARTCOIN** | `Xo8Kgmc6Cjv5Vvxio8QWi53pJP41EJy5RyAo4Kag2mQ` | SOL ↔ FARTCOIN | Fartcoin trading |
| **FARTBOY** | `8GNaBxzgJRGQ1SK3NJgDcWKYTEHX1J6D3ZYUXictpC4U` | SOL ↔ FARTBOY | Fartboy trading |
| **USELESS** | `4dyVnEqAQzdATexWzhq7fwnYBkpvJK4aSKVbxtRxenYb` | SOL ↔ USELESS | Useless trading |

**⚠️ IMPORTANT:** Each wallet needs initial funding:
- SOL wallets: USDC + 0.05 SOL (for gas)
- Meme wallets: SOL (0.1+ SOL minimum)

---

## 🔐 Environment Variables

Located in `.env`:

```bash
# Helius API (10M calls/month)
HELIUS_API_KEY=4a267fa7-ad3a-41f2-9a0c-a47b0fcbcf53
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=4a267fa7...

# PostgreSQL (Local)
DATABASE_URL=postgresql://localhost:5432/iagood

# Security
OPERATIONAL_SEED=VyK3bbZFyJg5n+iV1UBTex2s88B0nfs7WjvxE3rsdz0=
WEBHOOK_API_KEY=f9675d771fdc93d63af4ef757359f69d11ba6baa...

# Environment
NODE_ENV=development
```

---

## 🚀 Quick Start

### 1. Database Setup (Already Done)
```bash
npm run db:setup    # Creates DB, applies schema, initializes wallets
```

### 2. Start Webhook Server
```bash
npm run webhook     # Starts Express server on port 3000
```

### 3. Test Endpoints
```bash
# Health check
curl http://localhost:3000/health

# Analytics dashboard
curl http://localhost:3000/analytics

# Test webhook (requires funded wallet)
curl -X POST http://localhost:3000/webhook?apiKey=YOUR_KEY \
  -H "Content-Type: application/json" \
  -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241.50"}'
```

---

## 📊 Database Schema

### Tables Created:

1. **wallets** - 6 trading wallets with configuration
2. **trades** - All trade executions (pending → verified)
3. **positions** - FIFO position tracking (OPEN → PARTIAL → CLOSED)
4. **position_flags** - Issues requiring manual review
5. **balance_checks** - On-chain balance reconciliation

**Key Features:**
- FIFO accounting for accurate P&L
- No phantom trades (strict validation)
- Automatic discrepancy flagging
- Full audit trail

---

## 🎮 TradingView Alert Setup

### Webhook URL:
```
http://your-server:3000/webhook?apiKey=YOUR_WEBHOOK_API_KEY
```

### Alert Message Format:
```json
{
  "symbol": "{{ticker}}",
  "action": "{{strategy.order.action}}",
  "timeframe": "30",
  "price": "{{close}}"
}
```

### Example Alerts:

**SOL Buy (30m):**
```json
{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"{{close}}"}
```

**SOL Sell (60m):**
```json
{"symbol":"SOLUSD","action":"SELL","timeframe":"60","price":"{{close}}"}
```

**Meme Buy:**
```json
{"symbol":"FARTCOIN","action":"BUY","timeframe":"15","price":"{{close}}"}
```

**Note:** Meme coin timeframe is ignored - routing is by symbol only.

---

## 🔒 System Safety Features

### Jupiter DEX Integration:
- ✅ **3% maximum slippage** - Rejects trades exceeding limit
- ✅ **3% price impact limit** - No high-impact trades
- ✅ **2-hop route maximum** - Simple routes only
- ✅ **No retries** - Fail-fast on quality issues
- ✅ **Quote validation** - Age, output amount checks

### Position Tracker:
- ✅ **No phantom trades** - Never creates reconciliation trades
- ✅ **Sell validation** - Cannot sell without open position
- ✅ **Amount validation** - Cannot sell more than available
- ✅ **FIFO accounting** - Accurate cost basis tracking
- ✅ **Issue flagging** - Manual review for anomalies

### On-Chain Verification:
- ✅ **Every trade verified** - Helius transaction confirmation
- ✅ **Actual slippage calculated** - Compare expected vs actual
- ✅ **Balance reconciliation** - Detect on-chain mismatches
- ✅ **Phantom trade detection** - Flag trades that didn't execute

### Gas Management:
- ✅ **0.01 SOL reserve** - Always kept for future transactions
- ✅ **Balance pre-check** - Validates sufficient funds before trade
- ✅ **Priority fees** - 10,000 lamports for reliable execution

---

## 📈 Analytics Dashboard

**Endpoint:** `GET http://localhost:3000/analytics`

**Metrics Provided:**
- Total realized P&L
- Trade success rate
- Average & maximum slippage
- Active positions (OPEN/PARTIAL)
- Recent trade history (last 20)
- Slippage distribution (0-1%, 1-3%, 3-5%, >5%)
- Unresolved flags by severity
- Per-wallet performance breakdown

**Response Time:** <2 seconds

---

## 🧪 Testing Checklist

### Before Live Trading:

- [ ] **Fund All Wallets**
  - SOL_30M, SOL_60M, SOL_240M: Transfer USDC + 0.05 SOL
  - FARTCOIN, FARTBOY, USELESS: Transfer 0.1+ SOL

- [ ] **Test Webhook Authentication**
  ```bash
  # Should fail (no auth)
  curl -X POST http://localhost:3000/webhook -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'

  # Should fail (wrong key)
  curl -X POST http://localhost:3000/webhook?apiKey=wrong -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'

  # Should succeed (if wallet funded)
  curl -X POST http://localhost:3000/webhook?apiKey=YOUR_KEY -d '{"symbol":"SOLUSD","action":"BUY","timeframe":"30","price":"241"}'
  ```

- [ ] **Verify Database Records**
  ```bash
  psql iagood -c "SELECT * FROM trades ORDER BY id DESC LIMIT 5;"
  psql iagood -c "SELECT * FROM positions WHERE status != 'CLOSED';"
  ```

- [ ] **Check Analytics**
  ```bash
  curl http://localhost:3000/analytics | jq .
  ```

- [ ] **Monitor Logs**
  - Watch webhook.ts output for errors
  - Check for validation failures
  - Verify on-chain confirmation messages

### Test Trade Flow:

1. **Small SOL Buy (30m)** → Verify USDC → SOL swap
2. **Small SOL Sell (30m)** → Verify SOL → USDC swap
3. **Check Analytics** → Verify position tracking
4. **Balance Reconciliation** → Run balance sync
5. **Flag Review** → Check for any critical flags

---

## 🚨 Common Issues & Solutions

### Issue: "Insufficient balance for trade"
**Solution:** Fund the wallet with base token (USDC for SOL wallets, SOL for meme wallets)

### Issue: "Quote validation failed: Price impact 5.2% exceeds 3% limit"
**Solution:** Trade size too large - reduce position size or wait for better liquidity

### Issue: "Cannot sell 100 SOL: no open position"
**Solution:** Must BUY before SELL. Check positions table or analytics dashboard.

### Issue: "Database connection failed"
**Solution:** Ensure PostgreSQL is running: `pg_isready`

### Issue: Transaction signature not found
**Solution:** Transaction may not be confirmed yet. Helius verifier will retry if recent.

---

## 📝 Next Steps

### Before Production:

1. **Fund Wallets** - Transfer initial capital to all 6 wallets
2. **Test Small Trades** - Execute test trades with minimal amounts
3. **Monitor Analytics** - Verify P&L calculations are accurate
4. **Review Flags** - Check for any critical position_flags
5. **Setup Monitoring** - Add alerts for unresolved flags
6. **Deploy to Render** - Create Postgres database and deploy webhook

### Production Deployment:

1. **Create Render PostgreSQL Instance**
2. **Update DATABASE_URL** in Render environment
3. **Deploy Webhook Server** to Render Web Service
4. **Update TradingView Alerts** with production webhook URL
5. **Setup Monitoring** - CloudWatch, Sentry, or similar
6. **Run Balance Sync Cron** - Hourly reconciliation

### Ongoing Maintenance:

- Daily: Review analytics dashboard
- Weekly: Reconcile all wallet balances
- Monthly: Review unresolved flags and P&L accuracy
- As needed: Adjust slippage limits based on market conditions

---

## 🔗 Key Documentation

- **Webhook API:** `v3/api/WEBHOOK_README.md`
- **Analytics:** `v3/api/ANALYTICS_README.md`
- **Position Tracker:** `v3/core/POSITION_TRACKER_README.md`
- **Integration Guide:** `v3/core/INTEGRATION_CHECKLIST.md`

---

## 📞 Support

For issues or questions:
1. Check logs in console output
2. Query database for trade/position status
3. Review position_flags table for system alerts
4. Check Solana Explorer for on-chain confirmation

---

**Built with:** TypeScript, Express, PostgreSQL, Jupiter v6, Helius API
**Architecture:** Fail-fast validation, FIFO accounting, on-chain verification
**Philosophy:** Quality over success rate, flags over auto-correction, clarity over complexity
