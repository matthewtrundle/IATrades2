# Position Tracker Integration Checklist

## Pre-Integration Verification

### 1. Database Setup
- [ ] Database schema is deployed (`db/schema.sql`)
- [ ] Tables exist: `positions`, `position_flags`, `trades`, `wallets`
- [ ] Indexes are created for performance
- [ ] Triggers for `updated_at` are active

**Verify with:**
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('positions', 'position_flags', 'trades', 'wallets');

-- Check indexes
SELECT tablename, indexname FROM pg_indexes
WHERE tablename IN ('positions', 'position_flags');
```

### 2. Environment Setup
- [ ] `DATABASE_URL` is set in environment variables
- [ ] Database connection pool is configured (`lib/db/client.ts`)
- [ ] TypeScript is configured to compile v3/core files
- [ ] Dependencies installed: `pg`, `dotenv`

**Verify with:**
```bash
npm list pg dotenv
echo $DATABASE_URL
```

### 3. Code Review
- [ ] Read `/Users/mattrundle/Documents/IAGood/v3/core/position-tracker.ts`
- [ ] Understand FIFO accounting logic
- [ ] Review validation checks (sell without position, sell exceeds position)
- [ ] Understand flagging system
- [ ] Read `/Users/mattrundle/Documents/IAGood/v3/core/POSITION_TRACKER_README.md`

## Integration Steps

### Step 1: Import Position Tracker

Add to your trade execution module:

```typescript
import { positionTracker } from './v3/core/position-tracker';
```

### Step 2: Hook into BUY Trade Flow

After a BUY trade is executed and verified:

```typescript
// In your trade execution handler
async function onBuyTradeExecuted(trade) {
  // ... existing trade execution code ...

  // After trade is verified, record in position tracker
  try {
    const position = await positionTracker.recordBuy({
      walletId: trade.wallet_id,
      token: trade.output_token,  // Token we received
      amount: trade.output_amount, // Amount we received
      cost: trade.input_amount,    // Amount we spent
      tradeId: trade.id
    });

    console.log(`✓ Position updated: ${position.current_amount} ${position.token}`);

    // Update trade status
    await query(
      'UPDATE trades SET status = $1 WHERE id = $2',
      ['position_tracked', trade.id]
    );

  } catch (error) {
    console.error(`✗ Position tracking failed for trade ${trade.id}:`, error.message);

    // Update trade with error
    await query(
      'UPDATE trades SET status = $1, error_message = $2 WHERE id = $3',
      ['position_error', error.message, trade.id]
    );

    // Alert monitoring (DON'T swallow the error)
    await alertMonitoring('position_tracking_error', {
      trade_id: trade.id,
      error: error.message
    });
  }
}
```

### Step 3: Hook into SELL Trade Flow

**CRITICAL: Validate BEFORE executing the trade on-chain**

```typescript
// In your trade execution handler
async function onSellTradeRequested(tradeRequest) {
  // VALIDATE position exists and has sufficient amount BEFORE executing
  const position = await positionTracker.getOpenPosition(
    tradeRequest.wallet_id,
    tradeRequest.input_token
  );

  if (!position) {
    throw new Error(
      `Cannot execute sell: no open position for ${tradeRequest.input_token}`
    );
  }

  if (tradeRequest.input_amount > position.current_amount) {
    throw new Error(
      `Cannot sell ${tradeRequest.input_amount}: only ${position.current_amount} available`
    );
  }

  // Validation passed, execute the trade on-chain
  const trade = await executeTradeOnChain(tradeRequest);

  // After trade is executed and verified, record in position tracker
  try {
    const result = await positionTracker.recordSell({
      walletId: trade.wallet_id,
      token: trade.input_token,    // Token we sold
      amount: trade.input_amount,   // Amount we sold
      proceeds: trade.output_amount, // Amount we received
      tradeId: trade.id
    });

    console.log(`✓ Sell recorded: P&L $${result.realized_pnl.toFixed(2)}`);
    console.log(`  Remaining: ${result.position.current_amount} ${result.position.token}`);

    // Update trade status
    await query(
      'UPDATE trades SET status = $1 WHERE id = $2',
      ['position_tracked', trade.id]
    );

  } catch (error) {
    console.error(`✗ Position tracking failed for trade ${trade.id}:`, error.message);

    // This is CRITICAL - trade executed but position tracking failed
    await alertCritical('position_tracking_critical', {
      trade_id: trade.id,
      error: error.message,
      note: 'Trade executed on-chain but position tracking failed!'
    });

    // Update trade with error
    await query(
      'UPDATE trades SET status = $1, error_message = $2 WHERE id = $3',
      ['position_error', error.message, trade.id]
    );
  }
}
```

### Step 4: Set Up Monitoring

Create alerts for position flags:

```typescript
// Run this periodically (e.g., every 5 minutes)
async function checkPositionFlags() {
  const criticalFlags = await query(
    `SELECT * FROM position_flags
     WHERE resolved = FALSE
     AND severity = 'critical'
     AND created_at > NOW() - INTERVAL '1 hour'`
  );

  if (criticalFlags.rows.length > 0) {
    await alertCritical('unresolved_position_flags', {
      count: criticalFlags.rows.length,
      flags: criticalFlags.rows
    });
  }
}
```

### Step 5: Create Dashboard Queries

Add position monitoring to your dashboard:

```sql
-- Current positions summary
SELECT
  w.name AS wallet,
  p.token,
  p.status,
  p.current_amount,
  p.avg_entry_price,
  p.current_amount * p.avg_entry_price AS position_value,
  p.realized_pnl,
  p.total_exit_amount,
  p.first_entry_at
FROM positions p
JOIN wallets w ON p.wallet_id = w.id
WHERE p.status IN ('OPEN', 'PARTIAL')
ORDER BY position_value DESC;

-- Recent position activity
SELECT
  w.name AS wallet,
  p.token,
  p.status,
  p.realized_pnl,
  p.last_exit_at,
  p.closed_at
FROM positions p
JOIN wallets w ON p.wallet_id = w.id
WHERE p.last_exit_at > NOW() - INTERVAL '24 hours'
ORDER BY p.last_exit_at DESC;

-- Unresolved flags
SELECT
  pf.flag_type,
  pf.severity,
  pf.description,
  w.name AS wallet,
  pf.created_at
FROM position_flags pf
JOIN wallets w ON pf.wallet_id = w.id
WHERE pf.resolved = FALSE
ORDER BY pf.created_at DESC
LIMIT 20;
```

## Testing Checklist

### Unit Tests
- [ ] Run test suite: `npm test v3/core/position-tracker.test.ts`
- [ ] All tests pass
- [ ] Review test coverage

### Integration Tests

Create test trades in a staging environment:

#### Test 1: Basic Buy
- [ ] Execute a small BUY trade
- [ ] Verify position is created in `positions` table
- [ ] Verify avg_entry_price is correct
- [ ] Verify status is 'OPEN'

#### Test 2: Add to Position
- [ ] Execute second BUY trade for same token
- [ ] Verify avg_entry_price is recalculated correctly
- [ ] Verify total_entry_amount and total_entry_cost are summed

#### Test 3: Partial Sell
- [ ] Execute SELL trade for partial amount
- [ ] Verify realized_pnl is calculated correctly using FIFO
- [ ] Verify status changes to 'PARTIAL'
- [ ] Verify current_amount is reduced

#### Test 4: Full Exit
- [ ] Execute SELL trade for remaining amount
- [ ] Verify status changes to 'CLOSED'
- [ ] Verify closed_at timestamp is set
- [ ] Verify current_amount = 0

#### Test 5: Error Cases
- [ ] Try to sell without position → should throw error and create flag
- [ ] Try to sell more than position → should throw error and create flag
- [ ] Verify flags are created in `position_flags` table
- [ ] Verify error messages are clear and actionable

## Post-Integration Verification

### Day 1: Monitor Closely
- [ ] Check logs every hour for position tracking errors
- [ ] Review all position_flags created
- [ ] Verify P&L calculations match expectations
- [ ] Compare DB positions with on-chain balances

### Week 1: Regular Checks
- [ ] Daily review of unresolved flags
- [ ] Weekly position reconciliation report
- [ ] Verify no phantom trades or positions
- [ ] Check for any suspicious_pnl flags

### Ongoing: Monthly Audit
- [ ] Full position reconciliation (DB vs on-chain)
- [ ] Review closed positions P&L accuracy
- [ ] Analyze flag patterns for system improvements
- [ ] Verify FIFO calculations with sample checks

## Rollback Plan

If critical issues are discovered:

1. **Stop new trades immediately**
2. **Do NOT modify position data manually**
3. **Create flags for all discrepancies**
4. **Export positions table for analysis**
5. **Review integration code for bugs**
6. **Fix bugs, then backfill positions from trades table**

## Common Issues & Solutions

### Issue: Position tracking fails after trade executed

**Symptoms:** Trade executes on-chain but position tracking throws error

**Solution:**
1. Check position_flags table for the specific error
2. Do NOT manually correct positions
3. Fix the underlying data issue
4. Replay the position tracking for that trade

### Issue: Sell validation passes but on-chain execution fails

**Symptoms:** Position tracker says sell is valid, but blockchain rejects

**Solution:**
1. There may be other tokens/gas that weren't accounted for
2. Add additional validation for gas reserves
3. Check for token lock-up or vesting

### Issue: Position value doesn't match on-chain balance

**Symptoms:** DB position.current_amount ≠ on-chain balance

**Solution:**
1. DO NOT create reconciliation trades
2. Create a balance_mismatch flag
3. Review all trades for that wallet/token
4. Check for external transfers or airdrops
5. Manually investigate and correct if needed

## Support Resources

- **Code**: `/Users/mattrundle/Documents/IAGood/v3/core/position-tracker.ts`
- **Tests**: `/Users/mattrundle/Documents/IAGood/v3/core/position-tracker.test.ts`
- **Documentation**: `/Users/mattrundle/Documents/IAGood/v3/core/POSITION_TRACKER_README.md`
- **Examples**: `/Users/mattrundle/Documents/IAGood/v3/core/example-usage.ts`
- **Types**: `/Users/mattrundle/Documents/IAGood/v3/core/types.ts`

## Success Criteria

✅ All BUY trades create or update positions correctly
✅ All SELL trades validate position before execution
✅ FIFO P&L calculations are mathematically correct
✅ No phantom trades or reconciliation trades are created
✅ All anomalies are flagged, not auto-corrected
✅ Error messages are clear and actionable
✅ Zero unresolved critical flags after 24 hours
✅ Position values reconcile with on-chain balances (within dust tolerance)

---

**Remember**: This system prioritizes correctness over convenience. If it blocks an operation or creates a flag, investigate before proceeding. Never bypass the safeguards.
