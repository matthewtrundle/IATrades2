/**
 * Type Definitions for Position Tracking System
 *
 * These types ensure type safety across the position tracking system.
 */

// ============================================================================
// Database Entity Types
// ============================================================================

export interface Position {
  id: number;
  wallet_id: number;
  token: string;
  status: PositionStatus;
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

export interface PositionFlag {
  id: number;
  position_id: number | null;
  trade_id: number | null;
  wallet_id: number;
  flag_type: FlagType;
  severity: FlagSeverity;
  description: string;
  resolved: boolean;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_notes: string | null;
  created_at: Date;
}

export interface Trade {
  id: number;
  wallet_id: number;
  signature: string | null;
  webhook_timestamp: Date;
  execution_timestamp: Date | null;
  tv_action: TradeAction;
  tv_symbol: string;
  tv_timeframe: string | null;
  tv_price: number | null;
  input_token: string;
  output_token: string;
  input_amount: number;
  output_amount: number | null;
  expected_output: number | null;
  expected_slippage_pct: number | null;
  actual_slippage_pct: number | null;
  price_impact_pct: number | null;
  jupiter_fee_lamports: number | null;
  network_fee_lamports: number | null;
  priority_fee_lamports: number | null;
  status: TradeStatus;
  error_message: string | null;
  rejection_reason: string | null;
  quote_json: any | null;
  verification_json: any | null;
  created_at: Date;
  updated_at: Date;
}

export interface Wallet {
  id: number;
  name: string;
  address: string;
  wallet_type: WalletType;
  timeframe: string | null;
  trading_pair: string;
  base_token: string;
  quote_token: string;
  min_gas_reserve: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Enum Types
// ============================================================================

export type PositionStatus = 'OPEN' | 'PARTIAL' | 'CLOSED';

export type FlagType =
  | 'sell_without_position'
  | 'sell_exceeds_position'
  | 'suspicious_pnl'
  | 'oversized_position'
  | 'balance_mismatch';

export type FlagSeverity = 'info' | 'warning' | 'critical';

export type TradeAction = 'BUY' | 'SELL';

export type TradeStatus =
  | 'pending'
  | 'quoted'
  | 'executed'
  | 'verified'
  | 'failed'
  | 'position_tracked'
  | 'position_error';

export type WalletType = 'sol_timeframe' | 'meme';

// ============================================================================
// Parameter Types
// ============================================================================

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

export interface FlagParams {
  positionId?: number;
  tradeId?: number;
  walletId: number;
  flagType: FlagType;
  severity: FlagSeverity;
  description: string;
}

// ============================================================================
// Result Types
// ============================================================================

export interface SellResult {
  position: Position;
  realized_pnl: number;
  cost_basis: number;
}

export interface PositionSummary {
  wallet_id: number;
  wallet_name: string;
  token: string;
  status: PositionStatus;
  current_amount: number;
  avg_entry_price: number;
  position_value: number;
  total_entry_cost: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  return_pct: number;
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PositionValidation extends ValidationResult {
  position: Position | null;
  canSell: boolean;
  maxSellAmount: number;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface FIFOCalculation {
  avg_entry_price: number;
  cost_basis: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  return_pct: number;
}

export interface PositionMetrics {
  total_positions: number;
  open_positions: number;
  partial_positions: number;
  closed_positions: number;
  total_value: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  best_performer: {
    token: string;
    pnl: number;
    return_pct: number;
  } | null;
  worst_performer: {
    token: string;
    pnl: number;
    return_pct: number;
  } | null;
}

// ============================================================================
// Database Query Result Types
// ============================================================================

export interface PositionRow {
  id: number;
  wallet_id: number;
  token: string;
  status: string;
  entry_trade_id: number | null;
  entry_timestamp: Date;
  total_entry_amount: string;
  total_entry_cost: string;
  avg_entry_price: string;
  current_amount: string;
  total_exit_amount: string;
  total_exit_proceeds: string;
  realized_pnl: string;
  first_entry_at: Date;
  last_exit_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Error Types
// ============================================================================

export class PositionError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'PositionError';
  }
}

export class ValidationError extends PositionError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class InsufficientPositionError extends PositionError {
  constructor(
    public token: string,
    public requested: number,
    public available: number
  ) {
    super(
      `Cannot sell ${requested} ${token}: only ${available} available`,
      'INSUFFICIENT_POSITION',
      { token, requested, available }
    );
    this.name = 'InsufficientPositionError';
  }
}

export class PositionNotFoundError extends PositionError {
  constructor(
    public walletId: number,
    public token: string
  ) {
    super(
      `No open position found for ${token} in wallet ${walletId}`,
      'POSITION_NOT_FOUND',
      { walletId, token }
    );
    this.name = 'PositionNotFoundError';
  }
}
