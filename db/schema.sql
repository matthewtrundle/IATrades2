-- IAGood Trading Bot Database Schema
-- Version: 1.0
-- Created: 2025-10-03

-- Drop existing tables if they exist (for development)
DROP TABLE IF EXISTS balance_checks CASCADE;
DROP TABLE IF EXISTS position_flags CASCADE;
DROP TABLE IF EXISTS positions CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;

-- Wallets table: 6 trading wallets
CREATE TABLE wallets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  address VARCHAR(44) NOT NULL UNIQUE,
  wallet_type VARCHAR(20) NOT NULL, -- 'sol_timeframe' or 'meme'
  timeframe VARCHAR(10), -- '30', '60', '240' for SOL wallets, NULL for meme
  trading_pair VARCHAR(50) NOT NULL, -- 'USDC/SOL', 'SOL/FARTCOIN', etc.
  base_token VARCHAR(20) NOT NULL, -- 'USDC' for SOL wallets, 'SOL' for meme
  quote_token VARCHAR(20) NOT NULL, -- 'SOL' for SOL wallets, meme coin for meme wallets
  min_gas_reserve DECIMAL(18, 9) DEFAULT 0.01, -- Minimum SOL to keep for gas
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Trades table: All trade executions
CREATE TABLE trades (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),

  -- Trade identification
  signature VARCHAR(88) UNIQUE, -- Solana transaction signature
  webhook_timestamp TIMESTAMP NOT NULL,
  execution_timestamp TIMESTAMP,

  -- Trade details from TradingView
  tv_action VARCHAR(10) NOT NULL, -- 'BUY' or 'SELL'
  tv_symbol VARCHAR(20) NOT NULL, -- 'SOLUSD', 'FARTCOIN', etc.
  tv_timeframe VARCHAR(10), -- '30', '60', '240'
  tv_price DECIMAL(18, 9), -- Price from TradingView alert

  -- Actual execution details
  input_token VARCHAR(20) NOT NULL,
  output_token VARCHAR(20) NOT NULL,
  input_amount DECIMAL(18, 9) NOT NULL,
  output_amount DECIMAL(18, 9),

  -- Quote and slippage
  expected_output DECIMAL(18, 9),
  expected_slippage_pct DECIMAL(8, 4), -- Expected slippage from quote
  actual_slippage_pct DECIMAL(8, 4), -- Actual slippage after verification
  price_impact_pct DECIMAL(8, 4),

  -- Fees
  jupiter_fee_lamports BIGINT,
  network_fee_lamports BIGINT,
  priority_fee_lamports BIGINT DEFAULT 10000,

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'quoted', 'executed', 'verified', 'failed'
  error_message TEXT,
  rejection_reason VARCHAR(100), -- 'high_slippage', 'low_balance', 'quote_failed', etc.

  -- Metadata
  quote_json JSONB, -- Full Jupiter quote for debugging
  verification_json JSONB, -- Helius verification data

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Positions table: FIFO position tracking
CREATE TABLE positions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),

  -- Position identification
  token VARCHAR(20) NOT NULL, -- The token we're holding (SOL for SOL wallets, meme for meme wallets)
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'PARTIAL', 'CLOSED'

  -- Entry details
  entry_trade_id INTEGER REFERENCES trades(id),
  entry_timestamp TIMESTAMP NOT NULL,
  total_entry_amount DECIMAL(18, 9) NOT NULL, -- Total tokens purchased
  total_entry_cost DECIMAL(18, 9) NOT NULL, -- Total cost in base currency
  avg_entry_price DECIMAL(18, 9) NOT NULL, -- Calculated: total_entry_cost / total_entry_amount

  -- Current position
  current_amount DECIMAL(18, 9) NOT NULL, -- Remaining tokens

  -- Exit tracking (for partial/full exits)
  total_exit_amount DECIMAL(18, 9) DEFAULT 0,
  total_exit_proceeds DECIMAL(18, 9) DEFAULT 0,
  realized_pnl DECIMAL(18, 9) DEFAULT 0, -- Realized P&L from exits

  -- Metadata
  first_entry_at TIMESTAMP NOT NULL,
  last_exit_at TIMESTAMP,
  closed_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(wallet_id, token, status) -- Only one OPEN/PARTIAL position per wallet+token
);

-- Position flags: Issues that require manual review
CREATE TABLE position_flags (
  id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES positions(id),
  trade_id INTEGER REFERENCES trades(id),
  wallet_id INTEGER REFERENCES wallets(id),

  flag_type VARCHAR(50) NOT NULL, -- 'sell_without_position', 'sell_exceeds_position', 'balance_mismatch', etc.
  severity VARCHAR(20) DEFAULT 'warning', -- 'info', 'warning', 'critical'
  description TEXT NOT NULL,

  -- Resolution tracking
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP,
  resolved_by VARCHAR(100),
  resolution_notes TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Balance checks: On-chain vs database reconciliation
CREATE TABLE balance_checks (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),

  token VARCHAR(20) NOT NULL,

  -- Balances
  db_balance DECIMAL(18, 9) NOT NULL, -- Balance calculated from trades
  onchain_balance DECIMAL(18, 9) NOT NULL, -- Balance from Helius API
  discrepancy DECIMAL(18, 9) NOT NULL, -- Difference (onchain - db)
  discrepancy_pct DECIMAL(8, 4), -- Percentage difference

  -- Classification
  is_mismatch BOOLEAN DEFAULT FALSE, -- TRUE if discrepancy > threshold

  -- Metadata
  check_timestamp TIMESTAMP DEFAULT NOW(),
  helius_response JSONB -- Raw Helius data for debugging
);

-- Indexes for performance
CREATE INDEX idx_trades_wallet_id ON trades(wallet_id);
CREATE INDEX idx_trades_signature ON trades(signature);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_webhook_timestamp ON trades(webhook_timestamp DESC);
CREATE INDEX idx_trades_execution_timestamp ON trades(execution_timestamp DESC);

CREATE INDEX idx_positions_wallet_id ON positions(wallet_id);
CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_token ON positions(token);

CREATE INDEX idx_position_flags_resolved ON position_flags(resolved);
CREATE INDEX idx_position_flags_severity ON position_flags(severity);

CREATE INDEX idx_balance_checks_wallet_id ON balance_checks(wallet_id);
CREATE INDEX idx_balance_checks_timestamp ON balance_checks(check_timestamp DESC);
CREATE INDEX idx_balance_checks_mismatch ON balance_checks(is_mismatch);

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trades_updated_at BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial wallets (addresses will be updated by seed script)
INSERT INTO wallets (name, address, wallet_type, timeframe, trading_pair, base_token, quote_token) VALUES
  ('SOL_30M', 'PLACEHOLDER_ADDRESS_1', 'sol_timeframe', '30', 'USDC/SOL', 'USDC', 'SOL'),
  ('SOL_60M', 'PLACEHOLDER_ADDRESS_2', 'sol_timeframe', '60', 'USDC/SOL', 'USDC', 'SOL'),
  ('SOL_240M', 'PLACEHOLDER_ADDRESS_3', 'sol_timeframe', '240', 'USDC/SOL', 'USDC', 'SOL'),
  ('FARTCOIN', 'PLACEHOLDER_ADDRESS_4', 'meme', NULL, 'SOL/FARTCOIN', 'SOL', 'FARTCOIN'),
  ('FARTBOY', 'PLACEHOLDER_ADDRESS_5', 'meme', NULL, 'SOL/FARTBOY', 'SOL', 'FARTBOY'),
  ('USELESS', 'PLACEHOLDER_ADDRESS_6', 'meme', NULL, 'SOL/USELESS', 'SOL', 'USELESS');
