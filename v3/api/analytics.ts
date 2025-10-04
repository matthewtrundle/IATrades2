/**
 * Analytics Dashboard API for IAGood Trading Bot
 *
 * Provides consolidated trading metrics in a single performant endpoint (<2s response time).
 *
 * Endpoint: GET /analytics
 * Health Check: GET /analytics/health
 *
 * Returns:
 * - Summary statistics (P&L, trade counts, success rate, slippage)
 * - Active positions (open/partial)
 * - Recent trade history
 * - Slippage distribution analysis
 * - Unresolved flags and issues
 * - Wallet performance breakdown
 */

import express, { Request, Response } from 'express';
import { query } from '../../lib/db/client';
import { priceOracle } from '../helius/price-oracle';

// ============================================================================
// Type Definitions
// ============================================================================

interface Position {
  id: number;
  wallet_name: string;
  token: string;
  status: string;
  current_amount: number;
  avg_entry_price: number;
  current_price?: number; // Current market price (from price oracle)
  current_value: number; // current_amount * avg_entry_price (book value)
  market_value?: number; // current_amount * current_price (market value)
  unrealized_pnl?: number; // (current_price - avg_entry_price) * current_amount
  entry_timestamp: string;
}

interface Trade {
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
}

interface Flag {
  id: number;
  wallet_name: string;
  flag_type: string;
  severity: string;
  description: string;
  created_at: string;
  trade_id: number | null;
  position_id: number | null;
}

interface WalletStats {
  wallet_name: string;
  timeframe: string | null;
  total_trades: number;
  verified_trades: number;
  success_rate: number;
  total_realized_pnl: number;
  avg_slippage_pct: number | null;
  max_slippage_pct: number | null;
  open_positions: number;
}

interface SlippageDistribution {
  '0-1%': number;
  '1-3%': number;
  '3-5%': number;
  '>5%': number;
}

interface SummaryStats {
  total_realized_pnl: number;
  total_unrealized_pnl?: number; // Sum of all position unrealized P&L
  total_trades: number;
  verified_trades: number;
  success_rate: number;
  avg_slippage_pct: number | null;
  max_slippage_pct: number | null;
  high_slippage_trades: number;
  total_open_positions: number;
  total_open_value: number;
}

interface FlagsSummary {
  total_unresolved: number;
  by_severity: {
    critical: number;
    warning: number;
    info: number;
  };
  critical_issues: Flag[];
}

interface AnalyticsResponse {
  summary: SummaryStats;
  positions: Position[];
  recent_trades: Trade[];
  slippage_distribution: SlippageDistribution;
  flags: FlagsSummary;
  wallet_performance: WalletStats[];
  response_time_ms: number;
}

// ============================================================================
// Express Router
// ============================================================================

const router = express.Router();

/**
 * Health check endpoint for analytics API
 * GET /analytics/health
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const dbHealthy = await query('SELECT 1');
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbHealthy ? 'connected' : 'disconnected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Main analytics endpoint
 * GET /analytics
 *
 * Returns comprehensive trading metrics aggregated from all wallets and positions.
 * Uses parallel queries for optimal performance (<2s target).
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    console.log('[ANALYTICS] Fetching dashboard data...');

    // Execute all queries in parallel for best performance
    const [
      summaryResult,
      positionsResult,
      tradesResult,
      slippageDataResult,
      flagsResult,
      walletStatsResult,
    ] = await Promise.all([
      fetchSummaryStats(),
      fetchActivePositions(),
      fetchRecentTrades(),
      fetchSlippageData(),
      fetchUnresolvedFlags(),
      fetchWalletPerformance(),
    ]);

    // Enrich positions with current prices and unrealized P&L
    const enrichedPositions = await enrichPositionsWithPrices(positionsResult);

    // Calculate total unrealized P&L
    const totalUnrealizedPnl = enrichedPositions.reduce((sum, pos) =>
      sum + (pos.unrealized_pnl || 0), 0
    );

    // Add unrealized P&L to summary
    const enrichedSummary = {
      ...summaryResult,
      total_unrealized_pnl: totalUnrealizedPnl
    };

    const responseTime = Date.now() - startTime;

    // Calculate slippage distribution from raw data
    const slippageDistribution = calculateSlippageDistribution(slippageDataResult);

    // Build response
    const response: AnalyticsResponse = {
      summary: enrichedSummary,
      positions: enrichedPositions,
      recent_trades: tradesResult,
      slippage_distribution: slippageDistribution,
      flags: flagsResult,
      wallet_performance: walletStatsResult,
      response_time_ms: responseTime,
    };

    if (responseTime > 1000) {
      console.warn(`[ANALYTICS] Slow response: ${responseTime}ms`);
    } else {
      console.log(`[ANALYTICS] Response sent in ${responseTime}ms`);
    }

    res.json(response);
  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`[ANALYTICS] Error after ${responseTime}ms:`, error);

    res.status(500).json({
      error: 'Failed to fetch analytics data',
      message: error instanceof Error ? error.message : 'Unknown error',
      response_time_ms: responseTime,
    });
  }
});

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Fetch summary statistics across all wallets
 */
async function fetchSummaryStats(): Promise<SummaryStats> {
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

  const row = result.rows[0];

  return {
    total_realized_pnl: parseFloat(row.total_pnl) || 0,
    total_trades: parseInt(row.total_trades) || 0,
    verified_trades: parseInt(row.verified_trades) || 0,
    success_rate: parseFloat(row.success_rate) || 0,
    avg_slippage_pct: row.avg_slippage ? parseFloat(row.avg_slippage) : null,
    max_slippage_pct: row.max_slippage ? parseFloat(row.max_slippage) : null,
    high_slippage_trades: parseInt(row.high_slippage_count) || 0,
    total_open_positions: parseInt(row.open_positions) || 0,
    total_open_value: parseFloat(row.total_open_value) || 0,
  };
}

/**
 * Fetch all active (OPEN or PARTIAL) positions
 */
async function fetchActivePositions(): Promise<Position[]> {
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
  `);

  return result.rows.map((row) => ({
    id: row.id,
    wallet_name: row.wallet_name,
    token: row.token,
    status: row.status,
    current_amount: parseFloat(row.current_amount),
    avg_entry_price: parseFloat(row.avg_entry_price),
    current_value: parseFloat(row.current_value),
    entry_timestamp: row.entry_timestamp,
  }));
}

/**
 * Fetch last 20 trades ordered by execution time
 */
async function fetchRecentTrades(): Promise<Trade[]> {
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
    LIMIT 20
  `);

  return result.rows.map((row) => ({
    id: row.id,
    wallet_name: row.wallet_name,
    action: row.action,
    input_token: row.input_token,
    output_token: row.output_token,
    input_amount: parseFloat(row.input_amount),
    output_amount: row.output_amount ? parseFloat(row.output_amount) : 0,
    actual_slippage_pct: row.actual_slippage_pct ? parseFloat(row.actual_slippage_pct) : null,
    signature: row.signature || '',
    execution_timestamp: row.execution_timestamp,
    status: row.status,
  }));
}

/**
 * Fetch slippage data from last 100 verified trades for distribution analysis
 */
async function fetchSlippageData(): Promise<Array<{ slippage: number }>> {
  const result = await query(`
    SELECT actual_slippage_pct as slippage
    FROM trades
    WHERE status = 'verified'
      AND actual_slippage_pct IS NOT NULL
    ORDER BY execution_timestamp DESC
    LIMIT 100
  `);

  return result.rows.map((row) => ({
    slippage: parseFloat(row.slippage),
  }));
}

/**
 * Calculate slippage distribution buckets from raw slippage data
 */
function calculateSlippageDistribution(data: Array<{ slippage: number }>): SlippageDistribution {
  const distribution: SlippageDistribution = {
    '0-1%': 0,
    '1-3%': 0,
    '3-5%': 0,
    '>5%': 0,
  };

  for (const item of data) {
    const slippage = Math.abs(item.slippage); // Use absolute value

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

  return distribution;
}

/**
 * Fetch unresolved flags grouped by severity
 */
async function fetchUnresolvedFlags(): Promise<FlagsSummary> {
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

  const flags: Flag[] = result.rows.map((row) => ({
    id: row.id,
    wallet_name: row.wallet_name || 'Unknown',
    flag_type: row.flag_type,
    severity: row.severity,
    description: row.description,
    created_at: row.created_at,
    trade_id: row.trade_id,
    position_id: row.position_id,
  }));

  // Count by severity
  const bySeverity = {
    critical: flags.filter((f) => f.severity === 'critical').length,
    warning: flags.filter((f) => f.severity === 'warning').length,
    info: flags.filter((f) => f.severity === 'info').length,
  };

  // Get only critical issues for display
  const criticalIssues = flags.filter((f) => f.severity === 'critical');

  return {
    total_unresolved: flags.length,
    by_severity: bySeverity,
    critical_issues: criticalIssues,
  };
}

/**
 * Fetch performance metrics grouped by wallet
 */
async function fetchWalletPerformance(): Promise<WalletStats[]> {
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

  return result.rows.map((row) => ({
    wallet_name: row.wallet_name,
    timeframe: row.timeframe,
    total_trades: parseInt(row.total_trades) || 0,
    verified_trades: parseInt(row.verified_trades) || 0,
    success_rate: parseFloat(row.success_rate) || 0,
    total_realized_pnl: parseFloat(row.total_pnl) || 0,
    avg_slippage_pct: row.avg_slippage ? parseFloat(row.avg_slippage) : null,
    max_slippage_pct: row.max_slippage ? parseFloat(row.max_slippage) : null,
    open_positions: parseInt(row.open_positions) || 0,
  }));
}

/**
 * Enrich positions with current prices and calculate unrealized P&L
 */
async function enrichPositionsWithPrices(positions: Position[]): Promise<Position[]> {
  if (positions.length === 0) {
    return positions;
  }

  try {
    // Get unique tokens from positions
    const tokens = [...new Set(positions.map(p => p.token))];

    // Fetch all prices in one batch call (efficient!)
    const prices = await priceOracle.getPrices(tokens);

    // Enrich each position with current price and unrealized P&L
    return positions.map(position => {
      const currentPrice = prices[position.token];

      if (currentPrice) {
        const marketValue = position.current_amount * currentPrice;
        const unrealizedPnl = (currentPrice - position.avg_entry_price) * position.current_amount;

        return {
          ...position,
          current_price: currentPrice,
          market_value: marketValue,
          unrealized_pnl: unrealizedPnl,
        };
      }

      // If price not available, return position without enrichment
      return position;
    });
  } catch (error) {
    console.error('[ANALYTICS] Error enriching positions with prices:', error);
    // Return positions without enrichment if pricing fails
    return positions;
  }
}

// ============================================================================
// Export
// ============================================================================

export default router;
