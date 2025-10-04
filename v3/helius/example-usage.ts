/**
 * Example Usage: Helius On-Chain Verification System
 *
 * This file demonstrates how to use the verification system in production
 */

import {
  HeliusClient,
  TransactionVerifier,
  BalanceSyncer,
  VerifyTransactionRequest,
  BalanceSyncRequest,
} from "./index";

// ============================================================================
// SETUP
// ============================================================================

// Initialize Helius client (only once, reuse across app)
const heliusClient = new HeliusClient({
  apiKey: process.env.HELIUS_API_KEY || "",
  rateLimitPerSecond: 50, // 50 calls/second = 3000/min = 180k/hour
  retryAttempts: 3,
  cacheTTLSeconds: 300, // 5 minute cache
});

// Initialize verifier and syncer
const verifier = new TransactionVerifier(heliusClient);
const syncer = new BalanceSyncer(heliusClient);

// ============================================================================
// EXAMPLE 1: Verify a Single Swap Transaction
// ============================================================================

async function verifySwap() {
  const result = await verifier.verifyTransaction({
    signature:
      "5x7KZvQ6XMGHVsxGNJ3jXzAqVxKjPwbCzBs6HJJNpS1vGkKzqWXJjCzXVxNqRJzW1", // Example signature
    walletAddress: "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN", // Your trading wallet
    expectedInputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    expectedOutputMint: "So11111111111111111111111111111111111111112", // SOL
  });

  if (result.success) {
    console.log("✅ Transaction verified on-chain:");
    console.log(`   Input: ${result.inputAmount} ${result.inputMint}`);
    console.log(`   Output: ${result.outputAmount} ${result.outputMint}`);
    console.log(`   Fee: ${result.fee} lamports`);
    console.log(`   Timestamp: ${new Date(result.timestamp).toISOString()}`);

    // Calculate slippage if you have expected amounts
    const expectedIn = 100; // Expected 100 USDC
    const expectedOut = 0.5; // Expected 0.5 SOL
    const slippage = verifier.calculateSlippage(
      expectedIn,
      expectedOut,
      result.inputAmount,
      result.outputAmount
    );
    console.log(`   Slippage: ${slippage.toFixed(4)}%`);
  } else {
    console.error("❌ Transaction verification failed:", result.error);
  }

  return result;
}

// ============================================================================
// EXAMPLE 2: Verify Multiple Transactions in Batch
// ============================================================================

async function verifyBatchTransactions() {
  const transactions: VerifyTransactionRequest[] = [
    {
      signature: "tx1...",
      walletAddress: "wallet1...",
    },
    {
      signature: "tx2...",
      walletAddress: "wallet2...",
    },
    // Add more transactions...
  ];

  const results = await verifier.verifyBatch(transactions);

  const successful = results.filter((r) => r.success).length;
  console.log(
    `Verified ${successful}/${results.length} transactions successfully`
  );

  return results;
}

// ============================================================================
// EXAMPLE 3: Check Single Wallet Balance
// ============================================================================

async function checkWalletBalance() {
  const result = await syncer.checkBalance({
    walletAddress: "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN",
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    expectedBalance: 1000.5, // What we think the balance should be (from DB)
    discrepancyThreshold: 0.01, // Flag if difference > 0.01 USDC
  });

  if (result.success) {
    if (result.hasDiscrepancy) {
      console.log("⚠️  Balance discrepancy detected:");
      console.log(`   Database: ${result.dbBalance}`);
      console.log(`   On-chain: ${result.onchainBalance}`);
      console.log(`   Difference: ${result.discrepancy}`);
      // TAKE ACTION: Update database, investigate phantom trades, etc.
    } else {
      console.log("✅ Balance matches:", result.onchainBalance);
    }
  } else {
    console.error("❌ Balance check failed:", result.error);
  }

  return result;
}

// ============================================================================
// EXAMPLE 4: Batch Balance Sync (for Cron Jobs)
// ============================================================================

async function hourlyBalanceSync() {
  // Fetch all active wallets from your database
  const walletsFromDB = [
    {
      address: "wallet1...",
      tokenMint: "USDC_MINT",
      expectedBalance: 1000,
    },
    {
      address: "wallet2...",
      tokenMint: "SOL_MINT",
      expectedBalance: 5.5,
    },
    // ... more wallets
  ];

  const batchResult = await syncer.syncAllWallets({
    wallets: walletsFromDB,
    discrepancyThreshold: 0.01,
  });

  console.log(`\n📊 Batch Balance Sync Results:`);
  console.log(`   Total checked: ${batchResult.totalChecked}`);
  console.log(`   Successful: ${batchResult.successCount}`);
  console.log(`   Failed: ${batchResult.failureCount}`);
  console.log(`   Discrepancies: ${batchResult.discrepanciesFound}`);

  if (batchResult.discrepanciesFound > 0) {
    console.log(`\n⚠️  Wallets with discrepancies:`);
    batchResult.results
      .filter((r) => r.hasDiscrepancy)
      .forEach((r) => {
        console.log(
          `   ${r.walletAddress}: DB=${r.dbBalance}, Chain=${r.onchainBalance}, Diff=${r.discrepancy}`
        );
      });
  }

  if (batchResult.errors.length > 0) {
    console.log(`\n❌ Errors encountered:`);
    batchResult.errors.forEach((err) => console.log(`   ${err}`));
  }

  return batchResult;
}

// ============================================================================
// EXAMPLE 5: Detect Phantom Trades
// ============================================================================

async function detectPhantomTrade() {
  // Scenario: User executed a trade in your app, DB shows balance changed
  // But did the balance actually change on-chain?

  const walletAddress = "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN";
  const tokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

  const balanceBeforeTrade = 1000; // From DB: before trade
  const balanceAfterTrade = 950; // From DB: after trade (sent 50 USDC)

  const phantomCheck = await syncer.detectPhantomTrade(
    walletAddress,
    tokenMint,
    balanceBeforeTrade,
    balanceAfterTrade
  );

  if (phantomCheck.isPhantom) {
    console.log("🚨 PHANTOM TRADE DETECTED:");
    console.log(`   ${phantomCheck.message}`);
    console.log(`   On-chain: ${phantomCheck.onchainBalance}`);
    console.log(`   Expected: ${phantomCheck.expectedBalance}`);
    console.log(`   Discrepancy: ${phantomCheck.discrepancy}`);

    // TAKE ACTION:
    // 1. Flag the trade in your database
    // 2. Revert balance changes
    // 3. Alert monitoring system
    // 4. Investigate transaction signature
  } else {
    console.log("✅ Trade verified: Balance changed as expected");
  }

  return phantomCheck;
}

// ============================================================================
// EXAMPLE 6: Pre-Trade Balance Verification
// ============================================================================

async function verifyBalanceBeforeTrade() {
  const walletAddress = "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN";
  const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const amountToTrade = 100; // Want to trade 100 USDC

  const hasSufficient = await syncer.hasSufficientBalance(
    walletAddress,
    usdcMint,
    amountToTrade
  );

  if (hasSufficient) {
    console.log("✅ Sufficient balance for trade");
    // Proceed with trade
  } else {
    console.log("❌ Insufficient balance - cannot execute trade");
    // Reject trade request
  }

  return hasSufficient;
}

// ============================================================================
// EXAMPLE 7: Analyze Complex Multi-Hop Swaps
// ============================================================================

async function analyzeComplexSwap() {
  const signature =
    "5x7KZvQ6XMGHVsxGNJ3jXzAqVxKjPwbCzBs6HJJNpS1vGkKzqWXJjCzXVxNqRJzW1";
  const walletAddress = "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN";

  const analysis = await verifier.analyzeTransfers(signature, walletAddress);

  if (analysis.success) {
    console.log(`\n📊 Transfer Analysis for ${signature}:`);

    console.log(`\n  Outgoing (${analysis.outgoing.length}):`);
    analysis.outgoing.forEach((t) => {
      console.log(`    - ${t.tokenAmount} ${t.mint.slice(0, 8)}...`);
    });

    console.log(`\n  Incoming (${analysis.incoming.length}):`);
    analysis.incoming.forEach((t) => {
      console.log(`    + ${t.tokenAmount} ${t.mint.slice(0, 8)}...`);
    });

    console.log(`\n  Net Changes:`);
    analysis.net.forEach((amount, mint) => {
      const sign = amount >= 0 ? "+" : "";
      console.log(`    ${sign}${amount} ${mint.slice(0, 8)}...`);
    });
  } else {
    console.error("❌ Analysis failed:", analysis.error);
  }

  return analysis;
}

// ============================================================================
// EXAMPLE 8: Get All Token Balances for a Wallet
// ============================================================================

async function getAllBalances() {
  const walletAddress = "9B5XZvCGbVqRjZ3VxN1qJxKzWxNqRJzW1qWXJjCzXVxN";

  const balances = await syncer.getAllTokenBalances(walletAddress);

  console.log(`\n💰 All token balances for ${walletAddress}:`);
  balances.forEach((balance, mint) => {
    const tokenName = mint === "So11111111111111111111111111111111111111112" ? "SOL" : mint.slice(0, 8) + "...";
    console.log(`   ${tokenName}: ${balance}`);
  });

  return balances;
}

// ============================================================================
// EXAMPLE 9: Production Integration - After Trade Execution
// ============================================================================

async function afterTradeExecuted(
  signature: string,
  walletAddress: string,
  expectedInput: number,
  expectedOutput: number
) {
  console.log(`\n🔍 Verifying trade ${signature}...`);

  // 1. Verify the transaction actually happened on-chain
  const verification = await verifier.verifyTransaction({
    signature,
    walletAddress,
  });

  if (!verification.success) {
    console.error("❌ CRITICAL: Trade verification failed!");
    console.error("   Error:", verification.error);
    // ALERT: This trade might be phantom - investigate immediately
    return { success: false, error: verification.error };
  }

  // 2. Calculate actual slippage
  const slippage = verifier.calculateSlippage(
    expectedInput,
    expectedOutput,
    verification.inputAmount,
    verification.outputAmount
  );

  console.log(`✅ Trade verified on-chain:`);
  console.log(`   Input: ${verification.inputAmount}`);
  console.log(`   Output: ${verification.outputAmount}`);
  console.log(`   Slippage: ${slippage.toFixed(4)}%`);
  console.log(`   Fee: ${verification.fee} lamports`);

  // 3. Check if slippage exceeds acceptable threshold
  if (slippage > 2.0) {
    // 2% threshold
    console.warn(`⚠️  High slippage detected: ${slippage.toFixed(4)}%`);
    // Maybe flag this trade for review
  }

  // 4. Verify balances updated correctly
  const inputBalanceCheck = await syncer.checkBalance({
    walletAddress,
    tokenMint: verification.inputMint,
    expectedBalance: 0, // Calculate from DB
  });

  const outputBalanceCheck = await syncer.checkBalance({
    walletAddress,
    tokenMint: verification.outputMint,
    expectedBalance: 0, // Calculate from DB
  });

  if (inputBalanceCheck.hasDiscrepancy || outputBalanceCheck.hasDiscrepancy) {
    console.warn("⚠️  Balance discrepancy after trade - investigate!");
  }

  return {
    success: true,
    verification,
    slippage,
    balanceChecks: {
      input: inputBalanceCheck,
      output: outputBalanceCheck,
    },
  };
}

// ============================================================================
// EXAMPLE 10: Hourly Cron Job (Complete Flow)
// ============================================================================

async function hourlyVerificationCron() {
  console.log(`\n🕐 Starting hourly verification cron...`);

  try {
    // 1. Sync all wallet balances
    const balanceSyncResult = await hourlyBalanceSync();

    // 2. If discrepancies found, investigate recent transactions
    if (balanceSyncResult.discrepanciesFound > 0) {
      console.log(`\n🔍 Investigating discrepancies...`);

      for (const result of balanceSyncResult.results) {
        if (result.hasDiscrepancy) {
          // Fetch recent transactions for this wallet from your DB
          // Verify each one against on-chain data
          console.log(
            `   Checking recent transactions for ${result.walletAddress}...`
          );
          // ... verification logic
        }
      }
    }

    // 3. Clear old cache to free memory
    heliusClient.clearCache();

    console.log(`\n✅ Hourly verification cron complete`);
  } catch (error) {
    console.error(`\n❌ Cron job failed:`, error);
    // Send alert to monitoring system
  }
}

// ============================================================================
// Export examples for testing
// ============================================================================

export {
  verifySwap,
  verifyBatchTransactions,
  checkWalletBalance,
  hourlyBalanceSync,
  detectPhantomTrade,
  verifyBalanceBeforeTrade,
  analyzeComplexSwap,
  getAllBalances,
  afterTradeExecuted,
  hourlyVerificationCron,
};
