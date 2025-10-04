/**
 * BalanceSyncer
 *
 * Reconciles wallet balances between database and on-chain reality
 * Detects discrepancies to catch phantom trades and sync issues
 *
 * Usage:
 *   const syncer = new BalanceSyncer(heliusClient);
 *
 *   // Single wallet check
 *   const result = await syncer.checkBalance({
 *     walletAddress: "9B5X...",
 *     tokenMint: "EPjF...",
 *     expectedBalance: 100.5,
 *   });
 *
 *   // Batch sync (for cron jobs)
 *   const batchResult = await syncer.syncAllWallets([...]);
 */

import { HeliusClient } from "./client";
import {
  BalanceSyncRequest,
  BalanceCheck,
  BatchBalanceSyncRequest,
  BatchBalanceResult,
  VerificationErrorType,
  TokenAccountResponse,
} from "./types";

export class BalanceSyncer {
  private readonly DEFAULT_DISCREPANCY_THRESHOLD = 0.01; // 0.01 tokens
  private readonly SOL_MINT = "So11111111111111111111111111111111111111112"; // Native SOL

  constructor(private client: HeliusClient) {}

  /**
   * Check balance for a single wallet/token pair
   *
   * Process:
   * 1. Query Helius RPC for token accounts
   * 2. Filter by mint address
   * 3. Sum UI amounts across all accounts
   * 4. Compare with expected balance
   * 5. Flag if discrepancy > threshold
   *
   * @param request - Balance sync request
   * @returns Balance check result with discrepancy details
   */
  async checkBalance(request: BalanceSyncRequest): Promise<BalanceCheck> {
    const startTime = Date.now();

    try {
      // Input validation
      if (!request.walletAddress || !request.tokenMint) {
        return this.createErrorResult(
          request.walletAddress || "",
          request.tokenMint || "",
          request.expectedBalance || 0,
          VerificationErrorType.INVALID_INPUT,
          "Missing required fields: walletAddress and tokenMint"
        );
      }

      const threshold =
        request.discrepancyThreshold || this.DEFAULT_DISCREPANCY_THRESHOLD;

      let onchainBalance = 0;

      // Handle native SOL differently
      if (this.isSolMint(request.tokenMint)) {
        const lamports = await this.client.getSolBalance(
          request.walletAddress
        );
        onchainBalance = lamports / 1e9; // Convert lamports to SOL
      } else {
        // Get SPL token accounts
        const accounts = await this.client.getTokenAccountsByOwner(
          request.walletAddress,
          request.tokenMint
        );

        if (accounts.length === 0) {
          // No token accounts found - balance is 0
          onchainBalance = 0;
        } else {
          // Sum balances across all accounts (wallet might have multiple accounts for same mint)
          onchainBalance = accounts.reduce((sum, account) => {
            const uiAmount =
              account.account.data.parsed.info.tokenAmount.uiAmount;
            return sum + (uiAmount || 0);
          }, 0);
        }
      }

      // Calculate discrepancy
      const discrepancy = Math.abs(onchainBalance - request.expectedBalance);
      const hasDiscrepancy = discrepancy > threshold;

      const result: BalanceCheck = {
        success: true,
        walletAddress: request.walletAddress,
        tokenMint: request.tokenMint,
        dbBalance: request.expectedBalance,
        onchainBalance,
        discrepancy,
        hasDiscrepancy,
        checkedAt: Date.now(),
      };

      const duration = Date.now() - startTime;

      if (hasDiscrepancy) {
        console.warn(
          `[BalanceSyncer] DISCREPANCY DETECTED: ${request.walletAddress.slice(0, 8)}... ${request.tokenMint.slice(0, 8)}... | DB: ${request.expectedBalance} | Chain: ${onchainBalance} | Diff: ${discrepancy} (${duration}ms)`
        );
      } else {
        console.log(
          `[BalanceSyncer] Balance OK: ${request.walletAddress.slice(0, 8)}... ${request.tokenMint.slice(0, 8)}... | ${onchainBalance} (${duration}ms)`
        );
      }

      return result;
    } catch (error) {
      console.error(`[BalanceSyncer] Error checking balance:`, error);
      return this.createErrorResult(
        request.walletAddress,
        request.tokenMint,
        request.expectedBalance,
        VerificationErrorType.API_ERROR,
        `API error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Sync all wallets in batch
   * Ideal for hourly/daily cron jobs to detect drift
   *
   * @param request - Batch sync request with multiple wallets
   * @returns Aggregated results with statistics
   */
  async syncAllWallets(
    request: BatchBalanceSyncRequest
  ): Promise<BatchBalanceResult> {
    const startTime = Date.now();
    console.log(
      `[BalanceSyncer] Starting batch sync for ${request.wallets.length} wallets`
    );

    const threshold =
      request.discrepancyThreshold || this.DEFAULT_DISCREPANCY_THRESHOLD;

    // Process all wallets in parallel for speed
    const results = await Promise.all(
      request.wallets.map((wallet) =>
        this.checkBalance({
          walletAddress: wallet.address,
          tokenMint: wallet.tokenMint,
          expectedBalance: wallet.expectedBalance,
          discrepancyThreshold: threshold,
        })
      )
    );

    // Aggregate statistics
    const totalChecked = results.length;
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;
    const discrepanciesFound = results.filter(
      (r) => r.success && r.hasDiscrepancy
    ).length;

    const errors = results
      .filter((r) => !r.success && r.error)
      .map((r) => r.error!);

    const duration = Date.now() - startTime;

    const batchResult: BatchBalanceResult = {
      totalChecked,
      successCount,
      failureCount,
      discrepanciesFound,
      results,
      errors,
    };

    console.log(
      `[BalanceSyncer] Batch sync complete in ${duration}ms: ${successCount}/${totalChecked} successful, ${discrepanciesFound} discrepancies found`
    );

    if (discrepanciesFound > 0) {
      console.warn(
        `[BalanceSyncer] WARNING: ${discrepanciesFound} balance discrepancies detected!`
      );
      console.warn(
        `[BalanceSyncer] Discrepancies:`,
        results.filter((r) => r.success && r.hasDiscrepancy)
      );
    }

    return batchResult;
  }

  /**
   * Get all token balances for a wallet
   * Useful for full wallet reconciliation
   *
   * @param walletAddress - Wallet address
   * @returns Map of mint -> balance
   */
  async getAllTokenBalances(
    walletAddress: string
  ): Promise<Map<string, number>> {
    const balances = new Map<string, number>();

    try {
      // Get SOL balance
      const solLamports = await this.client.getSolBalance(walletAddress);
      balances.set(this.SOL_MINT, solLamports / 1e9);

      // Get all SPL token accounts
      const accounts = await this.client.getTokenAccountsByOwner(
        walletAddress
      );

      // Aggregate by mint (handle multiple accounts for same token)
      for (const account of accounts) {
        const mint = account.account.data.parsed.info.mint;
        const uiAmount =
          account.account.data.parsed.info.tokenAmount.uiAmount || 0;

        const current = balances.get(mint) || 0;
        balances.set(mint, current + uiAmount);
      }

      console.log(
        `[BalanceSyncer] Retrieved ${balances.size} token balances for ${walletAddress.slice(0, 8)}...`
      );
    } catch (error) {
      console.error(
        `[BalanceSyncer] Error getting all token balances:`,
        error
      );
    }

    return balances;
  }

  /**
   * Check if a wallet has sufficient balance for a trade
   *
   * @param walletAddress - Wallet address
   * @param tokenMint - Token mint
   * @param requiredAmount - Amount needed
   * @returns True if wallet has sufficient balance
   */
  async hasSufficientBalance(
    walletAddress: string,
    tokenMint: string,
    requiredAmount: number
  ): Promise<boolean> {
    try {
      let onchainBalance = 0;

      if (this.isSolMint(tokenMint)) {
        const lamports = await this.client.getSolBalance(walletAddress);
        onchainBalance = lamports / 1e9;
      } else {
        const accounts = await this.client.getTokenAccountsByOwner(
          walletAddress,
          tokenMint
        );
        onchainBalance = accounts.reduce((sum, account) => {
          const uiAmount =
            account.account.data.parsed.info.tokenAmount.uiAmount;
          return sum + (uiAmount || 0);
        }, 0);
      }

      const sufficient = onchainBalance >= requiredAmount;

      console.log(
        `[BalanceSyncer] Balance check: ${walletAddress.slice(0, 8)}... has ${onchainBalance} ${tokenMint.slice(0, 8)}..., needs ${requiredAmount} - ${sufficient ? "OK" : "INSUFFICIENT"}`
      );

      return sufficient;
    } catch (error) {
      console.error(
        `[BalanceSyncer] Error checking sufficient balance:`,
        error
      );
      return false;
    }
  }

  /**
   * Detect phantom trades by checking balance consistency
   * If we show a trade in DB but balance didn't change on-chain, it's phantom
   *
   * @param walletAddress - Wallet address
   * @param tokenMint - Token mint
   * @param balanceBeforeTrade - Expected balance before trade (from DB)
   * @param balanceAfterTrade - Expected balance after trade (from DB)
   * @returns Object indicating if balances match expectations
   */
  async detectPhantomTrade(
    walletAddress: string,
    tokenMint: string,
    balanceBeforeTrade: number,
    balanceAfterTrade: number
  ): Promise<{
    isPhantom: boolean;
    onchainBalance: number;
    expectedBalance: number;
    discrepancy: number;
    message: string;
  }> {
    try {
      // Get current on-chain balance
      let onchainBalance = 0;

      if (this.isSolMint(tokenMint)) {
        const lamports = await this.client.getSolBalance(walletAddress);
        onchainBalance = lamports / 1e9;
      } else {
        const accounts = await this.client.getTokenAccountsByOwner(
          walletAddress,
          tokenMint
        );
        onchainBalance = accounts.reduce((sum, account) => {
          const uiAmount =
            account.account.data.parsed.info.tokenAmount.uiAmount;
          return sum + (uiAmount || 0);
        }, 0);
      }

      // Compare with expected balance after trade
      const discrepancy = Math.abs(onchainBalance - balanceAfterTrade);
      const isPhantom = discrepancy > this.DEFAULT_DISCREPANCY_THRESHOLD;

      const message = isPhantom
        ? `PHANTOM TRADE DETECTED: On-chain balance (${onchainBalance}) doesn't match expected post-trade balance (${balanceAfterTrade})`
        : `Trade verified: Balance matches expected post-trade value`;

      return {
        isPhantom,
        onchainBalance,
        expectedBalance: balanceAfterTrade,
        discrepancy,
        message,
      };
    } catch (error) {
      console.error(`[BalanceSyncer] Error detecting phantom trade:`, error);
      return {
        isPhantom: false,
        onchainBalance: 0,
        expectedBalance: balanceAfterTrade,
        discrepancy: 0,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Helper: Check if token is native SOL
   */
  private isSolMint(mint: string): boolean {
    return (
      mint.toLowerCase() === this.SOL_MINT.toLowerCase() ||
      mint.toLowerCase() === "sol"
    );
  }

  /**
   * Create standardized error result
   */
  private createErrorResult(
    walletAddress: string,
    tokenMint: string,
    expectedBalance: number,
    errorType: VerificationErrorType,
    errorMessage: string
  ): BalanceCheck {
    return {
      success: false,
      walletAddress,
      tokenMint,
      dbBalance: expectedBalance,
      onchainBalance: 0,
      discrepancy: 0,
      hasDiscrepancy: false,
      checkedAt: Date.now(),
      error: `[${errorType}] ${errorMessage}`,
    };
  }
}
