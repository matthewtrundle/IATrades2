import { TOKENS } from '../../lib/config/tokens';

/**
 * Price Oracle using Jupiter Quote API
 * Caches prices to minimize API calls
 * Updates prices every 10 seconds by default
 *
 * Uses tiny quote amounts to derive prices efficiently
 */

interface PriceData {
  price: number;
  timestamp: number;
}

export class PriceOracle {
  private cache: Map<string, PriceData> = new Map();
  private cacheDurationMs: number;
  private quoteApiUrl = 'https://quote-api.jup.ag/v6/quote';

  /**
   * @param cacheDurationSeconds How long to cache prices (default: 10 seconds)
   */
  constructor(cacheDurationSeconds: number = 10) {
    this.cacheDurationMs = cacheDurationSeconds * 1000;
  }

  /**
   * Get current USD price for a token
   * Uses cache if available and fresh, otherwise fetches from Jupiter
   */
  async getPrice(tokenSymbol: string): Promise<number> {
    const token = TOKENS[tokenSymbol.toUpperCase()];
    if (!token) {
      throw new Error(`Unknown token: ${tokenSymbol}`);
    }

    // Check cache
    const cached = this.cache.get(token.mint);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < this.cacheDurationMs) {
      return cached.price;
    }

    // Fetch fresh price
    const price = await this.fetchPrice(token.mint);

    // Update cache
    this.cache.set(token.mint, {
      price,
      timestamp: now
    });

    return price;
  }

  /**
   * Get prices for multiple tokens
   * Fetches each price individually (Jupiter Quote API doesn't support batch)
   */
  async getPrices(tokenSymbols: string[]): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    // Fetch prices in parallel
    await Promise.all(
      tokenSymbols.map(async (symbol) => {
        try {
          const price = await this.getPrice(symbol);
          result[symbol] = price;
        } catch (error) {
          console.error(`[PriceOracle] Error fetching ${symbol}:`, error);
          // Try cache
          const token = TOKENS[symbol.toUpperCase()];
          if (token) {
            const cached = this.cache.get(token.mint);
            if (cached) {
              result[symbol] = cached.price;
            }
          }
        }
      })
    );

    return result;
  }

  /**
   * Fetch single token price from Jupiter Quote API
   * Uses a tiny swap quote to derive USD price
   */
  private async fetchPrice(mint: string): Promise<number> {
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    // Special case: USDC is always $1
    if (mint === USDC_MINT) {
      return 1.0;
    }

    // Use 0.01 token as quote amount (small but not too small)
    const quoteAmount = 10000000; // 0.01 SOL or equivalent

    try {
      // Get quote for TOKEN -> USDC
      const url = `${this.quoteApiUrl}?inputMint=${mint}&outputMint=${USDC_MINT}&amount=${quoteAmount}&slippageBps=300`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Jupiter Quote API error: ${response.status}`);
      }

      const quote = await response.json();

      // Calculate price: outAmount (USDC) / inAmount (token)
      // Both amounts are in smallest units, so they cancel out
      const inputAmount = parseInt(quote.inAmount);
      const outputAmount = parseInt(quote.outAmount);

      if (!inputAmount || !outputAmount) {
        throw new Error(`Invalid quote amounts: in=${inputAmount}, out=${outputAmount}`);
      }

      // Price = USDC received / tokens sent
      // Adjust for decimals: USDC has 6 decimals, most tokens have 6-9
      const price = outputAmount / inputAmount;

      // If token has 9 decimals and USDC has 6, multiply by 1000
      // This gives us the correct USD price
      const token = Object.values(TOKENS).find(t => t.mint === mint);
      const decimalAdjustment = token ? Math.pow(10, token.decimals - 6) : 1;

      return price * decimalAdjustment;

    } catch (error) {
      console.error(`[PriceOracle] Error fetching price for ${mint}:`, error);
      throw error;
    }
  }

  /**
   * Calculate unrealized P&L for a position
   */
  async calculateUnrealizedPnL(
    tokenSymbol: string,
    currentAmount: number,
    avgEntryPrice: number
  ): Promise<number> {
    const currentPrice = await this.getPrice(tokenSymbol);
    return (currentPrice - avgEntryPrice) * currentAmount;
  }

  /**
   * Get all prices needed for portfolio valuation
   * Optimized for analytics dashboard
   */
  async getPortfolioPrices(): Promise<Record<string, number>> {
    // Get prices for all tradeable tokens
    const symbols = ['SOL', 'USDC', 'FARTCOIN', 'FARTBOY', 'USELESS'];
    return this.getPrices(symbols);
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache status for monitoring
   */
  getCacheStatus(): Array<{ mint: string; price: number; age_seconds: number }> {
    const now = Date.now();
    const status: Array<{ mint: string; price: number; age_seconds: number }> = [];

    this.cache.forEach((data, mint) => {
      status.push({
        mint,
        price: data.price,
        age_seconds: Math.floor((now - data.timestamp) / 1000)
      });
    });

    return status;
  }
}

// Singleton instance with 10-second cache
export const priceOracle = new PriceOracle(10);

/**
 * Example usage:
 *
 * // Get single price
 * const solPrice = await priceOracle.getPrice('SOL');
 * console.log(`SOL: $${solPrice}`);
 *
 * // Get multiple prices efficiently
 * const prices = await priceOracle.getPrices(['SOL', 'USDC', 'FARTCOIN']);
 * console.log(prices); // { SOL: 241.5, USDC: 1.0, FARTCOIN: 0.58 }
 *
 * // Calculate unrealized P&L
 * const unrealizedPnl = await priceOracle.calculateUnrealizedPnL(
 *   'SOL',
 *   10.5,    // current amount
 *   230.0    // avg entry price
 * );
 * console.log(`Unrealized P&L: $${unrealizedPnl}`);
 */
