/**
 * TransactionVerifier
 *
 * Verifies completed swap transactions against on-chain data
 * Eliminates phantom trades by validating actual token transfers
 *
 * Usage:
 *   const verifier = new TransactionVerifier(heliusClient);
 *   const result = await verifier.verifyTransaction({
 *     signature: "5x...",
 *     walletAddress: "9B5X...",
 *   });
 *
 *   if (result.success) {
 *     console.log(`Slippage: ${result.actualSlippage}%`);
 *   }
 */

import { HeliusClient } from "./client";
import {
  VerifyTransactionRequest,
  VerifiedTransaction,
  VerificationErrorType,
  TokenTransfer,
  EnhancedTransaction,
} from "./types";

export class TransactionVerifier {
  constructor(private client: HeliusClient) {}

  /**
   * Verify a completed swap transaction
   *
   * Process:
   * 1. Fetch enhanced transaction from Helius
   * 2. Extract token transfers FROM and TO our wallet
   * 3. Calculate actual slippage
   * 4. Return structured verification result
   *
   * @param request - Transaction verification request
   * @returns Verified transaction data with success flag
   */
  async verifyTransaction(
    request: VerifyTransactionRequest
  ): Promise<VerifiedTransaction> {
    const startTime = Date.now();

    try {
      // Input validation
      if (!request.signature || !request.walletAddress) {
        return this.createErrorResult(
          request.signature || "",
          request.walletAddress || "",
          VerificationErrorType.INVALID_INPUT,
          "Missing required fields: signature and walletAddress"
        );
      }

      // Fetch enhanced transaction from Helius
      const transaction = await this.client.getEnhancedTransaction(
        request.signature
      );

      if (!transaction) {
        return this.createErrorResult(
          request.signature,
          request.walletAddress,
          VerificationErrorType.TRANSACTION_NOT_FOUND,
          `Transaction not found: ${request.signature}`
        );
      }

      // Check for transaction errors
      if (transaction.transactionError) {
        return this.createErrorResult(
          request.signature,
          request.walletAddress,
          VerificationErrorType.INVALID_TRANSFER_PATTERN,
          `Transaction failed on-chain: ${JSON.stringify(transaction.transactionError)}`
        );
      }

      // Extract and validate token transfers
      const tokenTransfers = transaction.tokenTransfers || [];
      if (tokenTransfers.length === 0) {
        return this.createErrorResult(
          request.signature,
          request.walletAddress,
          VerificationErrorType.INVALID_TRANSFER_PATTERN,
          "No token transfers found in transaction"
        );
      }

      // Find transfers FROM our wallet (what we sent)
      const outgoingTransfers = tokenTransfers.filter(
        (transfer) =>
          transfer.fromUserAccount.toLowerCase() ===
          request.walletAddress.toLowerCase()
      );

      // Find transfers TO our wallet (what we received)
      const incomingTransfers = tokenTransfers.filter(
        (transfer) =>
          transfer.toUserAccount.toLowerCase() ===
          request.walletAddress.toLowerCase()
      );

      // Validate swap pattern: should have at least one outgoing and one incoming
      if (outgoingTransfers.length === 0 || incomingTransfers.length === 0) {
        return this.createErrorResult(
          request.signature,
          request.walletAddress,
          VerificationErrorType.INVALID_TRANSFER_PATTERN,
          `Invalid swap pattern: ${outgoingTransfers.length} outgoing, ${incomingTransfers.length} incoming transfers`
        );
      }

      // Get primary swap transfers (first of each)
      const outgoing = outgoingTransfers[0];
      const incoming = incomingTransfers[0];

      // Validate amounts are non-zero
      if (outgoing.tokenAmount <= 0 || incoming.tokenAmount <= 0) {
        return this.createErrorResult(
          request.signature,
          request.walletAddress,
          VerificationErrorType.INVALID_TRANSFER_PATTERN,
          `Invalid amounts: sent ${outgoing.tokenAmount}, received ${incoming.tokenAmount}`
        );
      }

      // Calculate actual slippage
      // Note: For accurate slippage, caller should provide expected amounts
      // Here we calculate the exchange rate for reference
      const exchangeRate = incoming.tokenAmount / outgoing.tokenAmount;

      // If expected mints are provided, validate them
      if (request.expectedInputMint) {
        if (
          outgoing.mint.toLowerCase() !==
          request.expectedInputMint.toLowerCase()
        ) {
          return this.createErrorResult(
            request.signature,
            request.walletAddress,
            VerificationErrorType.INVALID_TRANSFER_PATTERN,
            `Input mint mismatch: expected ${request.expectedInputMint}, got ${outgoing.mint}`
          );
        }
      }

      if (request.expectedOutputMint) {
        if (
          incoming.mint.toLowerCase() !==
          request.expectedOutputMint.toLowerCase()
        ) {
          return this.createErrorResult(
            request.signature,
            request.walletAddress,
            VerificationErrorType.INVALID_TRANSFER_PATTERN,
            `Output mint mismatch: expected ${request.expectedOutputMint}, got ${incoming.mint}`
          );
        }
      }

      // Build successful result
      const result: VerifiedTransaction = {
        success: true,
        signature: request.signature,
        inputAmount: outgoing.tokenAmount,
        outputAmount: incoming.tokenAmount,
        inputMint: outgoing.mint,
        outputMint: incoming.mint,
        actualSlippage: 0, // Will be calculated by caller with expected amounts
        fee: transaction.fee,
        timestamp: transaction.timestamp,
        fromWallet: request.walletAddress,
        toWallet: request.walletAddress,
      };

      const duration = Date.now() - startTime;
      console.log(
        `[TransactionVerifier] Verified ${request.signature} in ${duration}ms`
      );

      return result;
    } catch (error) {
      console.error(
        `[TransactionVerifier] Error verifying transaction:`,
        error
      );
      return this.createErrorResult(
        request.signature,
        request.walletAddress,
        VerificationErrorType.API_ERROR,
        `API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate slippage between expected and actual trade
   *
   * Formula: |expected_rate - actual_rate| / expected_rate * 100
   *
   * @param expectedIn - Expected input amount
   * @param expectedOut - Expected output amount
   * @param actualIn - Actual input amount
   * @param actualOut - Actual output amount
   * @returns Slippage percentage
   */
  calculateSlippage(
    expectedIn: number,
    expectedOut: number,
    actualIn: number,
    actualOut: number
  ): number {
    // Validate inputs
    if (
      expectedIn <= 0 ||
      expectedOut <= 0 ||
      actualIn <= 0 ||
      actualOut <= 0
    ) {
      console.warn(
        `[TransactionVerifier] Invalid amounts for slippage calculation: expected(${expectedIn}, ${expectedOut}), actual(${actualIn}, ${actualOut})`
      );
      return 0;
    }

    try {
      const expectedRate = expectedOut / expectedIn;
      const actualRate = actualOut / actualIn;

      const slippage = Math.abs(expectedRate - actualRate) / expectedRate;

      return slippage * 100; // Return as percentage
    } catch (error) {
      console.error(
        `[TransactionVerifier] Error calculating slippage:`,
        error
      );
      return 0;
    }
  }

  /**
   * Verify multiple transactions in batch
   *
   * @param requests - Array of verification requests
   * @returns Array of verification results
   */
  async verifyBatch(
    requests: VerifyTransactionRequest[]
  ): Promise<VerifiedTransaction[]> {
    console.log(
      `[TransactionVerifier] Verifying batch of ${requests.length} transactions`
    );

    const results = await Promise.all(
      requests.map((req) => this.verifyTransaction(req))
    );

    const successCount = results.filter((r) => r.success).length;
    console.log(
      `[TransactionVerifier] Batch complete: ${successCount}/${requests.length} successful`
    );

    return results;
  }

  /**
   * Extract all token transfers for a wallet from a transaction
   * Useful for complex multi-hop swaps or aggregator transactions
   *
   * @param signature - Transaction signature
   * @param walletAddress - Wallet address to analyze
   * @returns Object with incoming and outgoing transfers
   */
  async analyzeTransfers(
    signature: string,
    walletAddress: string
  ): Promise<{
    success: boolean;
    incoming: TokenTransfer[];
    outgoing: TokenTransfer[];
    net: Map<string, number>; // mint -> net change
    error?: string;
  }> {
    try {
      const transaction = await this.client.getEnhancedTransaction(signature);

      if (!transaction) {
        return {
          success: false,
          incoming: [],
          outgoing: [],
          net: new Map(),
          error: "Transaction not found",
        };
      }

      const tokenTransfers = transaction.tokenTransfers || [];

      const incoming = tokenTransfers.filter(
        (t) =>
          t.toUserAccount.toLowerCase() === walletAddress.toLowerCase()
      );
      const outgoing = tokenTransfers.filter(
        (t) =>
          t.fromUserAccount.toLowerCase() === walletAddress.toLowerCase()
      );

      // Calculate net change per token
      const net = new Map<string, number>();

      for (const transfer of incoming) {
        const current = net.get(transfer.mint) || 0;
        net.set(transfer.mint, current + transfer.tokenAmount);
      }

      for (const transfer of outgoing) {
        const current = net.get(transfer.mint) || 0;
        net.set(transfer.mint, current - transfer.tokenAmount);
      }

      return {
        success: true,
        incoming,
        outgoing,
        net,
      };
    } catch (error) {
      return {
        success: false,
        incoming: [],
        outgoing: [],
        net: new Map(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create standardized error result
   */
  private createErrorResult(
    signature: string,
    walletAddress: string,
    errorType: VerificationErrorType,
    errorMessage: string
  ): VerifiedTransaction {
    return {
      success: false,
      signature,
      inputAmount: 0,
      outputAmount: 0,
      inputMint: "",
      outputMint: "",
      actualSlippage: 0,
      fee: 0,
      timestamp: Date.now(),
      fromWallet: walletAddress,
      toWallet: walletAddress,
      error: `[${errorType}] ${errorMessage}`,
    };
  }
}
