# FIFO Position Tracker

A production-ready position tracking system for the IAGood trading bot that prioritizes **data integrity over convenience**.

## Critical Design Principles

This system handles **real money**. A single bug can create thousands of dollars in phantom losses.

### Golden Rules

1. **NEVER** create reconciliation trades or phantom transactions to "fix" database discrepancies
2. **ALWAYS** flag data mismatches for manual review rather than auto-correcting
3. **ALWAYS** validate that positions exist before allowing sells
4. **ALWAYS** check that sell amounts don't exceed position sizes
5. **ALWAYS** use FIFO (First-In-First-Out) accounting for cost basis calculations

### What This System Does

✅ Tracks position entry and exit with FIFO accounting
✅ Calculates realized P&L accurately using average entry price
✅ Validates all sells against current position size
✅ Flags anomalies for manual review
✅ Maintains position lifecycle (OPEN → PARTIAL → CLOSED)
✅ Blocks invalid operations with clear error messages

### What This System Does NOT Do

❌ Create "reconciliation trades" to sync database with blockchain
❌ Auto-correct position sizes without human verification
❌ Allow sells when no position exists
❌ Allow sells that exceed current position size
❌ Guess or estimate missing data

## Usage

### Import

```typescript
import { PositionTracker, positionTracker } from './v3/core/position-tracker';

// Use singleton instance
const position = await positionTracker.recordBuy({...});

// Or create new instance
const tracker = new PositionTracker();
```

### Recording Buys

```typescript
const position = await positionTracker.recordBuy({
  walletId: 1,
  token: 'SOL',
  amount: 100,        // 100 SOL
  cost: 1000,         // $1000 USDC spent
  tradeId: 123
});

// Result:
// - avg_entry_price = $1000 / 100 = $10
// - current_amount = 100 SOL
// - status = 'OPEN'
```

### Recording Sells

```typescript
const result = await positionTracker.recordSell({
  walletId: 1,
  token: 'SOL',
  amount: 50,         // Sell 50 SOL
  proceeds: 600,      // Receive $600 USDC
  tradeId: 124
});

// FIFO Calculation:
// - cost_basis = avg_entry_price * 50 = $10 * 50 = $500
// - realized_pnl = $600 - $500 = $100
// - current_amount = 100 - 50 = 50 SOL
// - status = 'PARTIAL'
```

### Querying Positions

```typescript
const position = await positionTracker.getOpenPosition(walletId, 'SOL');

if (position) {
  console.log(`Current: ${position.current_amount} SOL`);
  console.log(`Avg Price: $${position.avg_entry_price}`);
  console.log(`Realized P&L: $${position.realized_pnl}`);
}
```

## FIFO Accounting

### Average Entry Price

When you add to a position, the average entry price is recalculated:

```typescript
// Buy 1: 100 SOL at $10 = $1000
// avg_entry_price = $1000 / 100 = $10

// Buy 2: 50 SOL at $12 = $600
// total_entry_amount = 150 SOL
// total_entry_cost = $1600
// avg_entry_price = $1600 / 150 = $10.67
```

### Cost Basis on Sells

The cost basis for a sell is calculated using the average entry price:

```typescript
// Position: 150 SOL at $10.67 avg
// Sell: 100 SOL for $1300

// cost_basis = avg_entry_price * sell_amount
//            = $10.67 * 100
//            = $1066.67

// realized_pnl = proceeds - cost_basis
//              = $1300 - $1066.67
//              = $233.33
```

### Realized P&L Accumulation

Realized P&L accumulates across multiple sells:

```typescript
// Position: 100 SOL at $10 avg

// Sell 1: 30 SOL for $360
// realized_pnl = $360 - ($10 * 30) = $60

// Sell 2: 40 SOL for $500
// realized_pnl = $500 - ($10 * 40) = $100

// Total realized_pnl = $60 + $100 = $160
```

## Position Lifecycle

### OPEN → PARTIAL → CLOSED

```
OPEN
├─ Initial buy (current_amount > 0, total_exit_amount = 0)
│
PARTIAL
├─ First sell (current_amount > 0, total_exit_amount > 0)
├─ Additional sells (current_amount > 0, total_exit_amount < total_entry_amount)
│
CLOSED
└─ Final sell (current_amount = 0, total_exit_amount = total_entry_amount)
```

### Status Rules

- **OPEN**: No exits yet, `total_exit_amount = 0`
- **PARTIAL**: Some exits, `current_amount > 0` and `total_exit_amount > 0`
- **CLOSED**: Fully exited, `current_amount = 0`, `closed_at` timestamp set

## Error Handling

### Defensive Design

The system throws clear, actionable errors and **never swallows them**:

```typescript
// ❌ No position exists
throw new Error('Cannot sell 100 SOL: no open position for wallet 1');

// ❌ Insufficient position size
throw new Error('Cannot sell 100 SOL: only 50 SOL available in position 123');

// ❌ Invalid amount
throw new Error('Invalid sell amount: -10. Amount must be positive.');
```

### Error Response

When an error is thrown:
1. **Transaction is rolled back** (no partial state)
2. **Flag is created** in `position_flags` table
3. **Error is logged** to console with context
4. **Operation is blocked** (never proceeds with invalid data)

## Flagging System

### Flag Types

| Flag Type | Severity | Triggered When |
|-----------|----------|----------------|
| `sell_without_position` | critical | Attempted sell with no open position |
| `sell_exceeds_position` | critical | Sell amount > current position amount |
| `oversized_position` | warning | Position value > $50,000 |
| `suspicious_pnl` | warning | Unexpected P&L patterns detected |
| `balance_mismatch` | warning | DB balance ≠ on-chain balance |

### Flag Structure

```typescript
{
  position_id: 123,      // Related position (if exists)
  trade_id: 456,         // Related trade (if exists)
  wallet_id: 1,          // Always set
  flag_type: 'sell_exceeds_position',
  severity: 'critical',
  description: 'Cannot sell 150 SOL: only 100 SOL available...',
  resolved: false
}
```

### Monitoring Flags

```sql
-- View unresolved critical flags
SELECT * FROM position_flags
WHERE resolved = FALSE AND severity = 'critical'
ORDER BY created_at DESC;

-- Resolve a flag
UPDATE position_flags
SET resolved = TRUE,
    resolved_at = NOW(),
    resolved_by = 'admin',
    resolution_notes = 'Manual correction applied'
WHERE id = 123;
```

## Validation Checks

### Before Every Sell

```typescript
// 1. Position must exist
if (!position) {
  flagIssue('sell_without_position', 'critical');
  throw Error('Cannot sell: no open position');
}

// 2. Sell amount must not exceed current amount
if (sellAmount > position.current_amount) {
  flagIssue('sell_exceeds_position', 'critical');
  throw Error('Cannot sell: insufficient position size');
}

// 3. Proceed with FIFO calculation
const costBasis = position.avg_entry_price * sellAmount;
const realizedPnl = proceeds - costBasis;
```

### After Every Sell

```typescript
// Flag suspicious patterns
if (positionValue > 50000) {
  flagIssue('oversized_position', 'warning');
}

if (realizedPnl < 0 && proceeds > costBasis * 1.1) {
  flagIssue('suspicious_pnl', 'warning');
}
```

## Database Schema

### positions

```sql
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL,
  token VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',

  -- Entry tracking
  entry_trade_id INTEGER,
  entry_timestamp TIMESTAMP NOT NULL,
  total_entry_amount DECIMAL(18, 9) NOT NULL,
  total_entry_cost DECIMAL(18, 9) NOT NULL,
  avg_entry_price DECIMAL(18, 9) NOT NULL,

  -- Current position
  current_amount DECIMAL(18, 9) NOT NULL,

  -- Exit tracking
  total_exit_amount DECIMAL(18, 9) DEFAULT 0,
  total_exit_proceeds DECIMAL(18, 9) DEFAULT 0,
  realized_pnl DECIMAL(18, 9) DEFAULT 0,

  -- Timestamps
  first_entry_at TIMESTAMP NOT NULL,
  last_exit_at TIMESTAMP,
  closed_at TIMESTAMP,

  UNIQUE(wallet_id, token, status)
);
```

### position_flags

```sql
CREATE TABLE position_flags (
  id SERIAL PRIMARY KEY,
  position_id INTEGER,
  trade_id INTEGER,
  wallet_id INTEGER NOT NULL,

  flag_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) DEFAULT 'warning',
  description TEXT NOT NULL,

  -- Resolution
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),
  resolution_notes TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);
```

## Integration Example

```typescript
import { positionTracker } from './v3/core/position-tracker';

// After executing a BUY trade
async function handleBuyTrade(trade) {
  try {
    const position = await positionTracker.recordBuy({
      walletId: trade.wallet_id,
      token: trade.output_token,
      amount: trade.output_amount,
      cost: trade.input_amount,
      tradeId: trade.id
    });

    console.log(`Position updated: ${position.current_amount} ${position.token}`);
    console.log(`Avg entry price: $${position.avg_entry_price}`);
  } catch (error) {
    console.error('Failed to record buy:', error.message);
    // Flag was already created, just log and alert
    await alertMonitoring(error);
  }
}

// After executing a SELL trade
async function handleSellTrade(trade) {
  try {
    const result = await positionTracker.recordSell({
      walletId: trade.wallet_id,
      token: trade.input_token,
      amount: trade.input_amount,
      proceeds: trade.output_amount,
      tradeId: trade.id
    });

    console.log(`Realized P&L: $${result.realized_pnl}`);
    console.log(`Position status: ${result.position.status}`);
    console.log(`Remaining: ${result.position.current_amount} ${result.position.token}`);
  } catch (error) {
    console.error('Failed to record sell:', error.message);
    // This is a CRITICAL error - trade should not have executed
    await alertCritical(error);
  }
}
```

## Testing

Run the test suite:

```bash
npm test v3/core/position-tracker.test.ts
```

### Test Coverage

- ✅ Buy creates new position
- ✅ Buy adds to existing position (FIFO)
- ✅ Sell validates position exists
- ✅ Sell validates sufficient amount
- ✅ Sell calculates correct P&L
- ✅ Position lifecycle transitions
- ✅ Flags created for anomalies
- ✅ Error messages are actionable

## Anti-Patterns to Avoid

### ❌ Never Do This

```typescript
// DON'T: Auto-correct position size
if (onchainBalance !== dbBalance) {
  await createReconciliationTrade(onchainBalance - dbBalance);
}

// DON'T: Swallow errors
try {
  await recordSell({...});
} catch (error) {
  console.log('Error occurred, continuing anyway...');
}

// DON'T: Allow sells without validation
await updatePosition({
  current_amount: position.current_amount - sellAmount
});
```

### ✅ Always Do This

```typescript
// DO: Flag the issue
if (onchainBalance !== dbBalance) {
  await flagIssue({
    flagType: 'balance_mismatch',
    severity: 'critical',
    description: `Balance mismatch: DB=${dbBalance}, Chain=${onchainBalance}`
  });
  throw new Error('Balance mismatch detected');
}

// DO: Throw errors to block invalid operations
if (!position) {
  throw new Error('Cannot sell: no open position');
}

// DO: Validate before updating
if (sellAmount > position.current_amount) {
  throw new Error(`Cannot sell ${sellAmount}: only ${position.current_amount} available`);
}
```

## Monitoring & Alerts

### Critical Alerts

Set up monitoring for these conditions:

1. **Unresolved critical flags** (check every 5 minutes)
2. **Sells without positions** (immediate alert)
3. **Sells exceeding positions** (immediate alert)
4. **Position value > $50k** (daily report)

### Query Examples

```sql
-- Critical flags in last 24 hours
SELECT * FROM position_flags
WHERE severity = 'critical'
  AND resolved = FALSE
  AND created_at > NOW() - INTERVAL '24 hours';

-- Position summary
SELECT
  w.name,
  p.token,
  p.status,
  p.current_amount,
  p.avg_entry_price,
  p.current_amount * p.avg_entry_price AS position_value,
  p.realized_pnl
FROM positions p
JOIN wallets w ON p.wallet_id = w.id
WHERE p.status IN ('OPEN', 'PARTIAL')
ORDER BY position_value DESC;
```

## File Locations

- **Core Logic**: `/Users/mattrundle/Documents/IAGood/v3/core/position-tracker.ts`
- **Tests**: `/Users/mattrundle/Documents/IAGood/v3/core/position-tracker.test.ts`
- **Database Schema**: `/Users/mattrundle/Documents/IAGood/db/schema.sql`
- **This README**: `/Users/mattrundle/Documents/IAGood/v3/core/POSITION_TRACKER_README.md`

## Support

If you encounter issues:

1. Check `position_flags` table for flagged anomalies
2. Review error messages (they are designed to be actionable)
3. Verify position state with `getOpenPosition()`
4. Never manually edit `positions` table without creating a flag
5. When in doubt, flag for manual review

---

**Remember**: This system prioritizes correctness over convenience. If it blocks an operation, there's a reason. Never bypass the safeguards.
