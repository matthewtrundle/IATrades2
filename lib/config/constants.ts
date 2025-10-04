import dotenv from 'dotenv';

dotenv.config();

export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
export const WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || '';
export const DATABASE_URL = process.env.DATABASE_URL || '';

// Pair-specific slippage limits (basis points, 100 = 1%)
export const SLIPPAGE_LIMITS: Record<string, number> = {
  // SOL pairs (high liquidity, tight slippage)
  'USDC/SOL': 50,    // 0.5% - Very liquid pair
  'SOL/USDC': 50,    // 0.5%

  // Meme coin pairs (medium-high liquidity)
  'SOL/USELESS': 100,   // 1.0% - 200M mcap, good liquidity
  'USELESS/SOL': 100,

  'SOL/FARTCOIN': 150,  // 1.5% - Decent liquidity
  'FARTCOIN/SOL': 150,

  'SOL/FARTBOY': 150,   // 1.5%
  'FARTBOY/SOL': 150,
};

// Default slippage if pair not found (conservative)
export const DEFAULT_MAX_SLIPPAGE_BPS = 300; // 3%

// Price impact limit (applies to all pairs)
export const MAX_PRICE_IMPACT_PCT = 3; // 3%

// Route complexity limit
export const MAX_ROUTE_HOPS = 2;

// Quote validation
export const MIN_OUTPUT_AMOUNT = 0.0001; // Minimum output in tokens
export const MAX_QUOTE_AGE_MS = 30000; // 30 seconds

// System constants
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
