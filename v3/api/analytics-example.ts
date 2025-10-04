/**
 * Analytics API Usage Examples
 *
 * This file demonstrates how to use the analytics endpoint to fetch
 * and display trading metrics from the IAGood trading bot.
 */

import axios from 'axios';

// ============================================================================
// Configuration
// ============================================================================

const ANALYTICS_URL = 'http://localhost:3000/analytics';
const ANALYTICS_HEALTH_URL = 'http://localhost:3000/analytics/health';

// ============================================================================
// Type Definitions (should match analytics.ts)
// ============================================================================

interface AnalyticsResponse {
  summary: {
    total_realized_pnl: number;
    total_trades: number;
    verified_trades: number;
    success_rate: number;
    avg_slippage_pct: number | null;
    max_slippage_pct: number | null;
    high_slippage_trades: number;
    total_open_positions: number;
    total_open_value: number;
  };
  positions: Array<{
    id: number;
    wallet_name: string;
    token: string;
    status: string;
    current_amount: number;
    avg_entry_price: number;
    current_value: number;
    entry_timestamp: string;
  }>;
  recent_trades: Array<{
    id: number;
    wallet_name: string;
    action: string;
    input_token: string;
    output_token: string;
    input_amount: number;
    output_amount: number;
    actual_slippage_pct: number | null;
    signature: string;
    execution_timestamp: string;
    status: string;
  }>;
  slippage_distribution: {
    '0-1%': number;
    '1-3%': number;
    '3-5%': number;
    '>5%': number;
  };
  flags: {
    total_unresolved: number;
    by_severity: {
      critical: number;
      warning: number;
      info: number;
    };
    critical_issues: Array<{
      id: number;
      wallet_name: string;
      flag_type: string;
      severity: string;
      description: string;
      created_at: string;
      trade_id: number | null;
      position_id: number | null;
    }>;
  };
  wallet_performance: Array<{
    wallet_name: string;
    timeframe: string | null;
    total_trades: number;
    verified_trades: number;
    success_rate: number;
    total_realized_pnl: number;
    avg_slippage_pct: number | null;
    max_slippage_pct: number | null;
    open_positions: number;
  }>;
  response_time_ms: number;
}

// ============================================================================
// Example Functions
// ============================================================================

/**
 * Check if analytics API is healthy
 */
async function checkHealth(): Promise<void> {
  try {
    const response = await axios.get(ANALYTICS_HEALTH_URL);
    console.log('Analytics API Health:', response.data);
  } catch (error) {
    console.error('Health check failed:', error);
  }
}

/**
 * Fetch and display full analytics dashboard
 */
async function fetchAnalytics(): Promise<AnalyticsResponse | null> {
  try {
    console.log('\n=== Fetching Analytics Dashboard ===\n');
    const response = await axios.get<AnalyticsResponse>(ANALYTICS_URL);
    const data = response.data;

    console.log(`Response time: ${data.response_time_ms}ms\n`);

    // Display summary
    console.log('=== SUMMARY ===');
    console.log(`Total Realized P&L: $${data.summary.total_realized_pnl.toFixed(2)}`);
    console.log(`Total Trades: ${data.summary.total_trades} (${data.summary.verified_trades} verified)`);
    console.log(`Success Rate: ${data.summary.success_rate.toFixed(2)}%`);
    console.log(
      `Average Slippage: ${data.summary.avg_slippage_pct ? data.summary.avg_slippage_pct.toFixed(2) + '%' : 'N/A'}`
    );
    console.log(
      `Max Slippage: ${data.summary.max_slippage_pct ? data.summary.max_slippage_pct.toFixed(2) + '%' : 'N/A'}`
    );
    console.log(`High Slippage Trades (>5%): ${data.summary.high_slippage_trades}`);
    console.log(`Open Positions: ${data.summary.total_open_positions}`);
    console.log(`Total Open Value: $${data.summary.total_open_value.toFixed(2)}\n`);

    // Display active positions
    console.log('=== ACTIVE POSITIONS ===');
    if (data.positions.length === 0) {
      console.log('No active positions\n');
    } else {
      data.positions.forEach((pos) => {
        console.log(`[${pos.wallet_name}] ${pos.token} - ${pos.status}`);
        console.log(`  Amount: ${pos.current_amount.toFixed(4)} @ $${pos.avg_entry_price.toFixed(6)}`);
        console.log(`  Current Value: $${pos.current_value.toFixed(2)}`);
        console.log(`  Entry: ${new Date(pos.entry_timestamp).toLocaleString()}\n`);
      });
    }

    // Display slippage distribution
    console.log('=== SLIPPAGE DISTRIBUTION ===');
    console.log(`0-1%:  ${data.slippage_distribution['0-1%']} trades`);
    console.log(`1-3%:  ${data.slippage_distribution['1-3%']} trades`);
    console.log(`3-5%:  ${data.slippage_distribution['3-5%']} trades`);
    console.log(`>5%:   ${data.slippage_distribution['>5%']} trades\n`);

    // Display flags
    console.log('=== UNRESOLVED FLAGS ===');
    console.log(`Total: ${data.flags.total_unresolved}`);
    console.log(`Critical: ${data.flags.by_severity.critical}`);
    console.log(`Warning: ${data.flags.by_severity.warning}`);
    console.log(`Info: ${data.flags.by_severity.info}\n`);

    if (data.flags.critical_issues.length > 0) {
      console.log('CRITICAL ISSUES:');
      data.flags.critical_issues.forEach((flag) => {
        console.log(`  [${flag.wallet_name}] ${flag.flag_type}`);
        console.log(`    ${flag.description}`);
        console.log(`    Created: ${new Date(flag.created_at).toLocaleString()}\n`);
      });
    }

    // Display wallet performance
    console.log('=== WALLET PERFORMANCE ===');
    data.wallet_performance.forEach((wallet) => {
      const timeframeLabel = wallet.timeframe ? ` (${wallet.timeframe}m)` : '';
      console.log(`${wallet.wallet_name}${timeframeLabel}`);
      console.log(`  Trades: ${wallet.verified_trades}/${wallet.total_trades} (${wallet.success_rate.toFixed(1)}%)`);
      console.log(`  Realized P&L: $${wallet.total_realized_pnl.toFixed(2)}`);
      console.log(
        `  Avg Slippage: ${wallet.avg_slippage_pct ? wallet.avg_slippage_pct.toFixed(2) + '%' : 'N/A'}`
      );
      console.log(`  Open Positions: ${wallet.open_positions}\n`);
    });

    // Display recent trades
    console.log('=== RECENT TRADES (Last 20) ===');
    if (data.recent_trades.length === 0) {
      console.log('No recent trades\n');
    } else {
      data.recent_trades.slice(0, 5).forEach((trade) => {
        // Show only first 5 for brevity
        console.log(`[${trade.wallet_name}] ${trade.action} ${trade.input_token} → ${trade.output_token}`);
        console.log(`  Input: ${trade.input_amount.toFixed(4)} ${trade.input_token}`);
        console.log(`  Output: ${trade.output_amount.toFixed(4)} ${trade.output_token}`);
        console.log(
          `  Slippage: ${trade.actual_slippage_pct ? trade.actual_slippage_pct.toFixed(2) + '%' : 'N/A'}`
        );
        console.log(`  Time: ${new Date(trade.execution_timestamp).toLocaleString()}`);
        console.log(`  Status: ${trade.status}\n`);
      });
      if (data.recent_trades.length > 5) {
        console.log(`... and ${data.recent_trades.length - 5} more trades\n`);
      }
    }

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Analytics API Error:', error.response?.data || error.message);
    } else {
      console.error('Error fetching analytics:', error);
    }
    return null;
  }
}

/**
 * Display only critical alerts
 */
async function fetchCriticalAlerts(): Promise<void> {
  try {
    const response = await axios.get<AnalyticsResponse>(ANALYTICS_URL);
    const data = response.data;

    console.log('\n=== CRITICAL ALERTS ===\n');

    // Check for high slippage
    if (data.summary.high_slippage_trades > 0) {
      console.log(`⚠️  ${data.summary.high_slippage_trades} trades with slippage >5%`);
    }

    // Check for critical flags
    if (data.flags.by_severity.critical > 0) {
      console.log(`🚨 ${data.flags.by_severity.critical} CRITICAL FLAGS:`);
      data.flags.critical_issues.forEach((flag) => {
        console.log(`   - [${flag.wallet_name}] ${flag.flag_type}: ${flag.description}`);
      });
    }

    // Check for negative P&L
    if (data.summary.total_realized_pnl < 0) {
      console.log(`📉 Negative P&L: $${data.summary.total_realized_pnl.toFixed(2)}`);
    }

    // Check for low success rate
    if (data.summary.success_rate < 80 && data.summary.total_trades > 10) {
      console.log(`⚠️  Low success rate: ${data.summary.success_rate.toFixed(1)}%`);
    }

    if (
      data.summary.high_slippage_trades === 0 &&
      data.flags.by_severity.critical === 0 &&
      data.summary.total_realized_pnl >= 0 &&
      (data.summary.success_rate >= 80 || data.summary.total_trades <= 10)
    ) {
      console.log('✅ No critical alerts');
    }

    console.log('');
  } catch (error) {
    console.error('Error fetching critical alerts:', error);
  }
}

/**
 * Display performance summary for all wallets
 */
async function fetchPerformanceSummary(): Promise<void> {
  try {
    const response = await axios.get<AnalyticsResponse>(ANALYTICS_URL);
    const data = response.data;

    console.log('\n=== PERFORMANCE SUMMARY ===\n');

    // Sort by P&L descending
    const sortedWallets = [...data.wallet_performance].sort((a, b) => b.total_realized_pnl - a.total_realized_pnl);

    console.log('Wallet Rankings by P&L:');
    sortedWallets.forEach((wallet, index) => {
      const pnlColor = wallet.total_realized_pnl >= 0 ? '📈' : '📉';
      const timeframeLabel = wallet.timeframe ? ` [${wallet.timeframe}m]` : '';
      console.log(
        `${index + 1}. ${wallet.wallet_name}${timeframeLabel}: ${pnlColor} $${wallet.total_realized_pnl.toFixed(2)}`
      );
    });

    console.log('\n');
  } catch (error) {
    console.error('Error fetching performance summary:', error);
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  console.log('=== IAGood Trading Bot Analytics Dashboard ===\n');

  // Check health first
  await checkHealth();

  // Fetch and display full analytics
  await fetchAnalytics();

  // Show critical alerts
  await fetchCriticalAlerts();

  // Show performance summary
  await fetchPerformanceSummary();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { checkHealth, fetchAnalytics, fetchCriticalAlerts, fetchPerformanceSummary };
