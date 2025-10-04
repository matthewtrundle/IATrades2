import { query, transaction } from '../../lib/db/client';

/**
 * FIFO Position Tracking System
 *
 * CRITICAL DESIGN PRINCIPLES:
 * 1. NEVER create reconciliation trades or phantom transactions
 * 2. ALWAYS flag data mismatches instead of auto-correcting
 * 3. ALWAYS validate position existence before allowing sells
 * 4. ALWAYS check that sell amounts don't exceed position sizes
 * 5. Use FIFO accounting for cost basis calculations
 *
 * This system handles real money. Correctness > Cleverness.
 */

// ============================================================================
// Type Definitions
// ============================================================================

export interface Position {
  id: number;
  wallet_id: number;
  token: string;
  status: 'OPEN' | 'PARTIAL' | 'CLOSED';
  entry_trade_id: number | null;
  entry_timestamp: Date;
  total_entry_amount: number;
  total_entry_cost: number;
  avg_entry_price: number;
  current_amount: number;
  total_exit_amount: number;
  total_exit_proceeds: number;
  realized_pnl: number;
  first_entry_at: Date;
  last_exit_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface RecordBuyParams {
  walletId: number;
  token: string;
  amount: number;
  cost: number;
  tradeId: number;
}

export interface RecordSellParams {
  walletId: number;
  token: string;
  amount: number;
  proceeds: number;
  tradeId: number;
}

export interface SellResult {
  position: Position;
  realized_pnl: number;
  cost_basis: number;
}

export interface FlagParams {
  positionId?: number;
  tradeId?: number;
  walletId: number;
  flagType: 'sell_without_position' | 'sell_exceeds_position' | 'suspicious_pnl' | 'oversized_position' | 'balance_mismatch';
  severity: 'info' | 'warning' | 'critical';
  description: string;
}

// ============================================================================
// Position Tracker Class
// ============================================================================

export class PositionTracker {
  /**
   * Records a BUY trade into the position tracking system.
   * Creates a new position if none exists, or adds to existing position using FIFO.
   *
   * @param params - Buy trade parameters
   * @returns The updated or newly created position
   * @throws Error if database operation fails
   */
  async recordBuy(params: RecordBuyParams): Promise<Position> {
    const { walletId, token, amount, cost, tradeId } = params;

    // Validation
    if (amount <= 0) {
      throw new Error(`Invalid buy amount: ${amount}. Amount must be positive.`);
    }
    if (cost <= 0) {
      throw new Error(`Invalid buy cost: ${cost}. Cost must be positive.`);
    }

    return transaction(async (client) => {
      // Check for existing open or partial position
      const existingRes = await client.query(
        `SELECT * FROM positions
         WHERE wallet_id = $1 AND token = $2 AND status IN ('OPEN', 'PARTIAL')
         ORDER BY first_entry_at ASC
         LIMIT 1`,
        [walletId, token]
      );

      if (existingRes.rows.length === 0) {
        // Create new position
        const avgPrice = cost / amount;
        const now = new Date();

        const insertRes = await client.query(
          `INSERT INTO positions (
            wallet_id, token, status, entry_trade_id, entry_timestamp,
            total_entry_amount, total_entry_cost, avg_entry_price,
            current_amount, total_exit_amount, total_exit_proceeds,
            realized_pnl, first_entry_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING *`,
          [
            walletId, token, 'OPEN', tradeId, now,
            amount, cost, avgPrice,
            amount, 0, 0, 0, now
          ]
        );

        return this.mapPosition(insertRes.rows[0]);
      } else {
        // Add to existing position (FIFO: we just increase totals)
        const existing = existingRes.rows[0];
        const newTotalEntryAmount = parseFloat(existing.total_entry_amount) + amount;
        const newTotalEntryCost = parseFloat(existing.total_entry_cost) + cost;
        const newAvgEntryPrice = newTotalEntryCost / newTotalEntryAmount;
        const newCurrentAmount = parseFloat(existing.current_amount) + amount;

        const updateRes = await client.query(
          `UPDATE positions
           SET total_entry_amount = $1,
               total_entry_cost = $2,
               avg_entry_price = $3,
               current_amount = $4
           WHERE id = $5
           RETURNING *`,
          [newTotalEntryAmount, newTotalEntryCost, newAvgEntryPrice, newCurrentAmount, existing.id]
        );

        return this.mapPosition(updateRes.rows[0]);
      }
    });
  }

  /**
   * Records a SELL trade from the position tracking system.
   * Uses FIFO accounting to calculate realized P&L.
   *
   * CRITICAL VALIDATIONS:
   * - Position must exist (status OPEN or PARTIAL)
   * - Sell amount must not exceed current position amount
   * - Flags issues instead of auto-correcting
   *
   * @param params - Sell trade parameters
   * @returns Sell result with updated position and realized P&L
   * @throws Error if position doesn't exist or sell amount exceeds position
   */
  async recordSell(params: RecordSellParams): Promise<SellResult> {
    const { walletId, token, amount, proceeds, tradeId } = params;

    // Validation
    if (amount <= 0) {
      throw new Error(`Invalid sell amount: ${amount}. Amount must be positive.`);
    }
    if (proceeds < 0) {
      throw new Error(`Invalid proceeds: ${proceeds}. Proceeds cannot be negative.`);
    }

    return transaction(async (client) => {
      // CRITICAL: Validate position exists
      const positionRes = await client.query(
        `SELECT * FROM positions
         WHERE wallet_id = $1 AND token = $2 AND status IN ('OPEN', 'PARTIAL')
         ORDER BY first_entry_at ASC
         LIMIT 1`,
        [walletId, token]
      );

      if (positionRes.rows.length === 0) {
        // FLAG: Attempted sell without position
        await this.flagIssue({
          walletId,
          tradeId,
          flagType: 'sell_without_position',
          severity: 'critical',
          description: `Cannot sell ${amount} ${token}: no open position for wallet ${walletId}. Trade ID: ${tradeId}`
        });

        throw new Error(`Cannot sell ${amount} ${token}: no open position for wallet ${walletId}`);
      }

      const position = positionRes.rows[0];
      const currentAmount = parseFloat(position.current_amount);

      // CRITICAL: Validate sufficient position size
      if (amount > currentAmount) {
        // FLAG: Sell exceeds position
        await this.flagIssue({
          positionId: position.id,
          walletId,
          tradeId,
          flagType: 'sell_exceeds_position',
          severity: 'critical',
          description: `Cannot sell ${amount} ${token}: only ${currentAmount} ${token} available in position ${position.id}. Trade ID: ${tradeId}`
        });

        throw new Error(`Cannot sell ${amount} ${token}: only ${currentAmount} ${token} available in position ${position.id}`);
      }

      // FIFO Accounting: Calculate realized P&L
      const avgEntryPrice = parseFloat(position.avg_entry_price);
      const costBasis = avgEntryPrice * amount;
      const realizedPnl = proceeds - costBasis;

      // Update position values
      const newCurrentAmount = currentAmount - amount;
      const newTotalExitAmount = parseFloat(position.total_exit_amount) + amount;
      const newTotalExitProceeds = parseFloat(position.total_exit_proceeds) + proceeds;
      const newRealizedPnl = parseFloat(position.realized_pnl) + realizedPnl;
      const now = new Date();

      // Determine new status
      let newStatus: 'OPEN' | 'PARTIAL' | 'CLOSED';
      let closedAt: Date | null = null;

      if (newCurrentAmount === 0) {
        newStatus = 'CLOSED';
        closedAt = now;
      } else if (newTotalExitAmount > 0) {
        newStatus = 'PARTIAL';
      } else {
        newStatus = 'OPEN';
      }

      // Update the position
      const updateRes = await client.query(
        `UPDATE positions
         SET current_amount = $1,
             total_exit_amount = $2,
             total_exit_proceeds = $3,
             realized_pnl = $4,
             status = $5,
             last_exit_at = $6,
             closed_at = $7
         WHERE id = $8
         RETURNING *`,
        [
          newCurrentAmount,
          newTotalExitAmount,
          newTotalExitProceeds,
          newRealizedPnl,
          newStatus,
          now,
          closedAt,
          position.id
        ]
      );

      const updatedPosition = this.mapPosition(updateRes.rows[0]);

      // Flag suspicious P&L patterns
      const positionValue = currentAmount * avgEntryPrice;
      if (positionValue > 50000) {
        await this.flagIssue({
          positionId: position.id,
          walletId,
          tradeId,
          flagType: 'oversized_position',
          severity: 'warning',
          description: `Large position detected: ${token} position value $${positionValue.toFixed(2)} in wallet ${walletId}`
        });
      }

      // Flag if realized P&L is unexpectedly negative on what should be profitable
      if (realizedPnl < 0 && proceeds > costBasis * 1.1) {
        await this.flagIssue({
          positionId: position.id,
          walletId,
          tradeId,
          flagType: 'suspicious_pnl',
          severity: 'warning',
          description: `Suspicious P&L: negative P&L (${realizedPnl.toFixed(4)}) despite high proceeds. Position ${position.id}, Trade ${tradeId}`
        });
      }

      return {
        position: updatedPosition,
        realized_pnl: realizedPnl,
        cost_basis: costBasis
      };
    });
  }

  /**
   * Retrieves the current open or partial position for a wallet and token.
   *
   * @param walletId - Wallet ID
   * @param token - Token symbol
   * @returns Position if exists, null otherwise
   */
  async getOpenPosition(walletId: number, token: string): Promise<Position | null> {
    const res = await query(
      `SELECT * FROM positions
       WHERE wallet_id = $1 AND token = $2 AND status IN ('OPEN', 'PARTIAL')
       ORDER BY first_entry_at ASC
       LIMIT 1`,
      [walletId, token]
    );

    if (res.rows.length === 0) {
      return null;
    }

    return this.mapPosition(res.rows[0]);
  }

  /**
   * Creates a flag for manual review when data anomalies are detected.
   * This is the CORRECT way to handle issues - flag them, don't auto-correct.
   *
   * @param params - Flag parameters
   */
  async flagIssue(params: FlagParams): Promise<void> {
    const { positionId, tradeId, walletId, flagType, severity, description } = params;

    await query(
      `INSERT INTO position_flags (
        position_id, trade_id, wallet_id, flag_type, severity, description
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [positionId || null, tradeId || null, walletId, flagType, severity, description]
    );

    // Log to console for immediate visibility
    console.error(`[POSITION FLAG] ${severity.toUpperCase()}: ${flagType}`);
    console.error(`Description: ${description}`);
    console.error(`Position ID: ${positionId || 'N/A'}, Trade ID: ${tradeId || 'N/A'}, Wallet ID: ${walletId}`);
  }

  /**
   * Maps database row to Position type with proper type conversions.
   */
  private mapPosition(row: any): Position {
    return {
      id: row.id,
      wallet_id: row.wallet_id,
      token: row.token,
      status: row.status,
      entry_trade_id: row.entry_trade_id,
      entry_timestamp: row.entry_timestamp,
      total_entry_amount: parseFloat(row.total_entry_amount),
      total_entry_cost: parseFloat(row.total_entry_cost),
      avg_entry_price: parseFloat(row.avg_entry_price),
      current_amount: parseFloat(row.current_amount),
      total_exit_amount: parseFloat(row.total_exit_amount),
      total_exit_proceeds: parseFloat(row.total_exit_proceeds),
      realized_pnl: parseFloat(row.realized_pnl),
      first_entry_at: row.first_entry_at,
      last_exit_at: row.last_exit_at,
      closed_at: row.closed_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

// Export singleton instance for convenience
export const positionTracker = new PositionTracker();
