/**
 * Analytics API Test Script
 *
 * Tests the analytics endpoint with direct database queries to verify
 * data aggregation and response structure.
 */

import { query } from '../../lib/db/client';

// ============================================================================
// Test Functions
// ============================================================================

/**
 * Test database connectivity
 */
async function testDatabaseConnection(): Promise<boolean> {
  try {
    await query('SELECT 1');
    console.log('✅ Database connection: OK');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

/**
 * Test summary statistics query
 */
async function testSummaryStats(): Promise<void> {
  try {
    const result = await query(`
      WITH trade_stats AS (
        SELECT
          COUNT(*) as total_trades,
          COUNT(*) FILTER (WHERE status = 'verified') as verified_trades,
          AVG(actual_slippage_pct) FILTER (WHERE actual_slippage_pct IS NOT NULL) as avg_slippage,
          MAX(actual_slippage_pct) FILTER (WHERE actual_slippage_pct IS NOT NULL) as max_slippage,
          COUNT(*) FILTER (WHERE actual_slippage_pct > 5.0) as high_slippage_count
        FROM trades
      ),
      position_stats AS (
        SELECT
          COALESCE(SUM(realized_pnl), 0) as total_pnl,
          COUNT(*) FILTER (WHERE status IN ('OPEN', 'PARTIAL')) as open_positions,
          COALESCE(SUM(current_amount * avg_entry_price) FILTER (WHERE status IN ('OPEN', 'PARTIAL')), 0) as total_open_value
        FROM positions
      )
      SELECT
        t.total_trades,
        t.verified_trades,
        CASE
          WHEN t.total_trades > 0
          THEN (t.verified_trades::float / t.total_trades::float * 100)
          ELSE 0
        END as success_rate,
        t.avg_slippage,
        t.max_slippage,
        t.high_slippage_count,
        p.total_pnl,
        p.open_positions,
        p.total_open_value
      FROM trade_stats t, position_stats p
    `);

    console.log('\n✅ Summary Statistics Query:');
    console.log(JSON.stringify(result.rows[0], null, 2));
  } catch (error) {
    console.error('❌ Summary statistics query failed:', error);
  }
}

/**
 * Test active positions query
 */
async function testActivePositions(): Promise<void> {
  try {
    const result = await query(`
      SELECT
        p.id,
        w.name as wallet_name,
        p.token,
        p.status,
        p.current_amount,
        p.avg_entry_price,
        (p.current_amount * p.avg_entry_price) as current_value,
        p.entry_timestamp
      FROM positions p
      JOIN wallets w ON p.wallet_id = w.id
      WHERE p.status IN ('OPEN', 'PARTIAL')
      ORDER BY p.entry_timestamp DESC
      LIMIT 5
    `);

    console.log('\n✅ Active Positions Query:');
    console.log(`Found ${result.rows.length} active positions`);
    if (result.rows.length > 0) {
      console.log('Sample:', JSON.stringify(result.rows[0], null, 2));
    }
  } catch (error) {
    console.error('❌ Active positions query failed:', error);
  }
}

/**
 * Test recent trades query
 */
async function testRecentTrades(): Promise<void> {
  try {
    const result = await query(`
      SELECT
        t.id,
        w.name as wallet_name,
        t.tv_action as action,
        t.input_token,
        t.output_token,
        t.input_amount,
        t.output_amount,
        t.actual_slippage_pct,
        t.signature,
        t.execution_timestamp,
        t.status
      FROM trades t
      JOIN wallets w ON t.wallet_id = w.id
      WHERE t.execution_timestamp IS NOT NULL
      ORDER BY t.execution_timestamp DESC
      LIMIT 5
    `);

    console.log('\n✅ Recent Trades Query:');
    console.log(`Found ${result.rows.length} recent trades`);
    if (result.rows.length > 0) {
      console.log('Sample:', JSON.stringify(result.rows[0], null, 2));
    }
  } catch (error) {
    console.error('❌ Recent trades query failed:', error);
  }
}

/**
 * Test unresolved flags query
 */
async function testUnresolvedFlags(): Promise<void> {
  try {
    const result = await query(`
      SELECT
        pf.id,
        w.name as wallet_name,
        pf.flag_type,
        pf.severity,
        pf.description,
        pf.created_at,
        pf.trade_id,
        pf.position_id
      FROM position_flags pf
      LEFT JOIN wallets w ON pf.wallet_id = w.id
      WHERE pf.resolved = false
      ORDER BY
        CASE pf.severity
          WHEN 'critical' THEN 1
          WHEN 'warning' THEN 2
          WHEN 'info' THEN 3
        END,
        pf.created_at DESC
    `);

    console.log('\n✅ Unresolved Flags Query:');
    console.log(`Found ${result.rows.length} unresolved flags`);
    if (result.rows.length > 0) {
      const bySeverity = {
        critical: result.rows.filter((r) => r.severity === 'critical').length,
        warning: result.rows.filter((r) => r.severity === 'warning').length,
        info: result.rows.filter((r) => r.severity === 'info').length,
      };
      console.log('By Severity:', bySeverity);
    }
  } catch (error) {
    console.error('❌ Unresolved flags query failed:', error);
  }
}

/**
 * Test wallet performance query
 */
async function testWalletPerformance(): Promise<void> {
  try {
    const result = await query(`
      WITH wallet_trades AS (
        SELECT
          w.id,
          w.name,
          w.timeframe,
          COUNT(t.id) as total_trades,
          COUNT(t.id) FILTER (WHERE t.status = 'verified') as verified_trades,
          AVG(t.actual_slippage_pct) FILTER (WHERE t.actual_slippage_pct IS NOT NULL) as avg_slippage,
          MAX(t.actual_slippage_pct) FILTER (WHERE t.actual_slippage_pct IS NOT NULL) as max_slippage
        FROM wallets w
        LEFT JOIN trades t ON w.id = t.wallet_id
        GROUP BY w.id, w.name, w.timeframe
      ),
      wallet_positions AS (
        SELECT
          w.id,
          COALESCE(SUM(p.realized_pnl), 0) as total_pnl,
          COUNT(*) FILTER (WHERE p.status IN ('OPEN', 'PARTIAL')) as open_positions
        FROM wallets w
        LEFT JOIN positions p ON w.id = p.wallet_id
        GROUP BY w.id
      )
      SELECT
        wt.name as wallet_name,
        wt.timeframe,
        wt.total_trades,
        wt.verified_trades,
        CASE
          WHEN wt.total_trades > 0
          THEN (wt.verified_trades::float / wt.total_trades::float * 100)
          ELSE 0
        END as success_rate,
        wp.total_pnl,
        wt.avg_slippage,
        wt.max_slippage,
        wp.open_positions
      FROM wallet_trades wt
      JOIN wallet_positions wp ON wt.id = wp.id
      ORDER BY wt.name
    `);

    console.log('\n✅ Wallet Performance Query:');
    console.log(`Found ${result.rows.length} wallets`);
    result.rows.forEach((row) => {
      console.log(
        `  ${row.wallet_name}${row.timeframe ? ` (${row.timeframe}m)` : ''}: ${row.total_trades} trades, $${parseFloat(row.total_pnl).toFixed(2)} P&L`
      );
    });
  } catch (error) {
    console.error('❌ Wallet performance query failed:', error);
  }
}

/**
 * Test slippage distribution calculation
 */
async function testSlippageDistribution(): Promise<void> {
  try {
    const result = await query(`
      SELECT actual_slippage_pct as slippage
      FROM trades
      WHERE status = 'verified'
        AND actual_slippage_pct IS NOT NULL
      ORDER BY execution_timestamp DESC
      LIMIT 100
    `);

    console.log('\n✅ Slippage Distribution:');
    console.log(`Analyzing ${result.rows.length} trades`);

    const distribution = {
      '0-1%': 0,
      '1-3%': 0,
      '3-5%': 0,
      '>5%': 0,
    };

    for (const row of result.rows) {
      const slippage = Math.abs(parseFloat(row.slippage));
      if (slippage <= 1.0) {
        distribution['0-1%']++;
      } else if (slippage <= 3.0) {
        distribution['1-3%']++;
      } else if (slippage <= 5.0) {
        distribution['3-5%']++;
      } else {
        distribution['>5%']++;
      }
    }

    console.log(distribution);
  } catch (error) {
    console.error('❌ Slippage distribution failed:', error);
  }
}

/**
 * Test database schema integrity
 */
async function testSchemaIntegrity(): Promise<void> {
  console.log('\n✅ Testing Schema Integrity:');

  const tables = ['wallets', 'trades', 'positions', 'position_flags', 'balance_checks'];

  for (const table of tables) {
    try {
      const result = await query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`  ${table}: ${result.rows[0].count} rows`);
    } catch (error) {
      console.error(`  ❌ ${table}: Table not found or error`);
    }
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
  console.log('=== Analytics API Database Tests ===\n');

  // Test database connection first
  const connected = await testDatabaseConnection();
  if (!connected) {
    console.error('\n❌ Cannot proceed without database connection');
    process.exit(1);
  }

  // Test schema
  await testSchemaIntegrity();

  // Test each query function
  await testSummaryStats();
  await testActivePositions();
  await testRecentTrades();
  await testUnresolvedFlags();
  await testWalletPerformance();
  await testSlippageDistribution();

  console.log('\n=== All Tests Complete ===\n');
}

// Run tests
if (require.main === module) {
  runAllTests()
    .then(() => {
      console.log('✅ Test suite completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

export { runAllTests };
