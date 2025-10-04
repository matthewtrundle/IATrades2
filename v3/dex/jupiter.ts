import { Connection, Keypair, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { SLIPPAGE_LIMITS, DEFAULT_MAX_SLIPPAGE_BPS, MAX_PRICE_IMPACT_PCT, MAX_ROUTE_HOPS } from '../../lib/config/constants';

// ============================================================================
// Type Definitions
// ============================================================================

export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number; // in smallest units (lamports for SOL, micro-units for tokens)
  inputSymbol?: string; // Optional: for pair-specific slippage lookup
  outputSymbol?: string; // Optional: for pair-specific slippage lookup
}

export interface QuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: number;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot?: number;
  timeFetched: number;
}

export interface SwapParams {
  quote: QuoteResult;
  wallet: Keypair;
  priorityFeeLamports?: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  inputAmount: number;
  outputAmount: number;
  inputMint: string;
  outputMint: string;
  error?: string;
}

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: null | any;
  priceImpactPct: number;
  routePlan: any[];
  contextSlot?: number;
  timeFetched?: number;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
}

// ============================================================================
// Constants
// ============================================================================

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';
const QUOTE_MAX_AGE_MS = 30000; // 30 seconds

// ============================================================================
// Jupiter DEX Integration
// ============================================================================

export class JupiterDex {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get pair-specific slippage limit
   * Falls back to default if pair not found
   */
  private getSlippageLimit(inputSymbol?: string, outputSymbol?: string): number {
    if (!inputSymbol || !outputSymbol) {
      return DEFAULT_MAX_SLIPPAGE_BPS;
    }

    // Try exact pair
    const pairKey = `${inputSymbol}/${outputSymbol}`;
    if (SLIPPAGE_LIMITS[pairKey]) {
      return SLIPPAGE_LIMITS[pairKey];
    }

    // Try reverse pair
    const reversePairKey = `${outputSymbol}/${inputSymbol}`;
    if (SLIPPAGE_LIMITS[reversePairKey]) {
      return SLIPPAGE_LIMITS[reversePairKey];
    }

    // Default
    return DEFAULT_MAX_SLIPPAGE_BPS;
  }

  /**
   * Fetches a quote from Jupiter with strict validation
   * Rejects trades that don't meet quality criteria
   */
  async getQuote(params: QuoteParams): Promise<QuoteResult> {
    const { inputMint, outputMint, amount, inputSymbol, outputSymbol } = params;

    // Get pair-specific slippage limit
    const slippageBps = this.getSlippageLimit(inputSymbol, outputSymbol);

    // Build query parameters
    const queryParams = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippageBps.toString(),
      onlyDirectRoutes: 'false', // Allow 1-2 hop routes
    });

    // Fetch quote from Jupiter
    const response = await fetch(`${JUPITER_QUOTE_API}?${queryParams.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jupiter quote API error: ${response.status} - ${errorText}`);
    }

    const quoteData: JupiterQuoteResponse = await response.json();

    // Build quote result with timestamp
    const quote: QuoteResult = {
      ...quoteData,
      timeFetched: Date.now(),
    };

    // Strict validation - fail fast on any quality issue
    this.validateQuote(quote, slippageBps, inputSymbol, outputSymbol);

    return quote;
  }

  /**
   * Executes a swap using a validated quote
   * Returns actual input/output amounts for verification
   */
  async executeSwap(params: SwapParams): Promise<SwapResult> {
    const { quote, wallet, priorityFeeLamports = 10000 } = params;

    // Check quote freshness
    const quoteAge = Date.now() - quote.timeFetched;
    if (quoteAge > QUOTE_MAX_AGE_MS) {
      return {
        success: false,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: 0,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        error: `Quote expired (${(quoteAge / 1000).toFixed(1)}s old, max ${QUOTE_MAX_AGE_MS / 1000}s)`,
      };
    }

    // Re-validate quote before execution (need to recalculate slippage limit)
    try {
      // Note: We don't have symbols here, so we use the quote's slippageBps from original request
      this.validateQuote(quote, quote.slippageBps);
    } catch (error) {
      return {
        success: false,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: 0,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        error: error instanceof Error ? error.message : 'Quote validation failed',
      };
    }

    try {
      // Request swap transaction from Jupiter
      const swapResponse = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toString(),
          prioritizationFeeLamports: priorityFeeLamports,
          wrapUnwrapSOL: true,
          dynamicSlippage: false,
        }),
      });

      if (!swapResponse.ok) {
        const errorText = await swapResponse.text();
        return {
          success: false,
          inputAmount: parseInt(quote.inAmount),
          outputAmount: 0,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          error: `Jupiter swap API error: ${swapResponse.status} - ${errorText}`,
        };
      }

      const { swapTransaction }: JupiterSwapResponse = await swapResponse.json();

      // Deserialize the transaction
      const transactionBuffer = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Sign the transaction
      transaction.sign([wallet]);

      // Send the transaction
      const rawTransaction = transaction.serialize();
      const signature = await this.connection.sendRawTransaction(rawTransaction, {
        skipPreflight: false,
        maxRetries: 0, // No retries - fail fast
      });

      // Confirm the transaction
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        return {
          success: false,
          inputAmount: parseInt(quote.inAmount),
          outputAmount: 0,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          error: `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
        };
      }

      return {
        success: true,
        signature,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
      };

    } catch (error) {
      return {
        success: false,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: 0,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        error: error instanceof Error ? error.message : 'Unknown error during swap execution',
      };
    }
  }

  /**
   * Validates quote against strict quality criteria
   * Throws descriptive errors for any violations - NO EXCEPTIONS
   */
  private validateQuote(quote: QuoteResult, slippageBps: number, inputSymbol?: string, outputSymbol?: string): void {
    // 1. Output amount must be > 0
    const outAmount = parseInt(quote.outAmount);
    if (outAmount <= 0) {
      throw new Error(`Invalid quote: output amount is ${outAmount} (must be > 0)`);
    }

    // 2. Price impact must be < 3%
    if (quote.priceImpactPct >= MAX_PRICE_IMPACT_PCT) {
      throw new Error(
        `Price impact ${quote.priceImpactPct.toFixed(2)}% exceeds ${MAX_PRICE_IMPACT_PCT}% limit`
      );
    }

    // 3. Route must be <= 2 hops
    const routeHops = quote.routePlan.length;
    if (routeHops > MAX_ROUTE_HOPS) {
      throw new Error(
        `Route complexity ${routeHops} hops exceeds ${MAX_ROUTE_HOPS} hop limit`
      );
    }

    // 4. Calculate and validate expected slippage against pair-specific limit
    const expectedSlippage = this.calculateExpectedSlippage(quote);
    const slippageLimitPct = slippageBps / 100;

    if (expectedSlippage > slippageLimitPct) {
      const pairName = inputSymbol && outputSymbol ? `${inputSymbol}/${outputSymbol}` : 'this pair';
      throw new Error(
        `Expected slippage ${expectedSlippage.toFixed(2)}% exceeds ${slippageLimitPct}% limit for ${pairName}`
      );
    }
  }

  /**
   * Calculates expected slippage from quote data
   * Formula: (outAmount - otherAmountThreshold) / outAmount * 100
   */
  private calculateExpectedSlippage(quote: QuoteResult): number {
    const outAmount = parseInt(quote.outAmount);
    const minOutAmount = parseInt(quote.otherAmountThreshold);

    if (outAmount === 0) {
      return 100; // 100% slippage if no output
    }

    const slippagePercentage = ((outAmount - minOutAmount) / outAmount) * 100;
    return Math.max(0, slippagePercentage); // Never negative
  }

  /**
   * Helper method to get connection for external use
   */
  getConnection(): Connection {
    return this.connection;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Formats a quote for logging/debugging
 */
export function formatQuote(quote: QuoteResult): string {
  const inAmount = parseInt(quote.inAmount);
  const outAmount = parseInt(quote.outAmount);
  const minOutAmount = parseInt(quote.otherAmountThreshold);
  const slippage = ((outAmount - minOutAmount) / outAmount * 100).toFixed(2);

  return [
    `Input: ${inAmount} (${quote.inputMint.slice(0, 8)}...)`,
    `Output: ${outAmount} (${quote.outputMint.slice(0, 8)}...)`,
    `Price Impact: ${quote.priceImpactPct.toFixed(2)}%`,
    `Expected Slippage: ${slippage}%`,
    `Route: ${quote.routePlan.length} hops`,
  ].join(' | ');
}

/**
 * Formats a swap result for logging/debugging
 */
export function formatSwapResult(result: SwapResult): string {
  if (!result.success) {
    return `FAILED: ${result.error}`;
  }

  return [
    `SUCCESS: ${result.signature?.slice(0, 16)}...`,
    `Input: ${result.inputAmount}`,
    `Output: ${result.outputAmount}`,
  ].join(' | ');
}
