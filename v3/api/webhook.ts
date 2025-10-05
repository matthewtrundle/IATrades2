/**
 * TradingView Webhook Handler for IAGood Trading Bot
 *
 * Flow: Authenticate → Parse → Route → Validate → Quote → Execute → Verify → Record → Respond
 *
 * This handler receives TradingView alerts and executes trades via Jupiter with Helius verification.
 */

import express, { Request, Response, NextFunction } from 'express';
import { Keypair } from '@solana/web3.js';
import { JupiterDex, QuoteResult } from '../dex/jupiter';
import { HeliusClient, TransactionVerifier, BalanceSyncer } from '../helius';
import { PositionTracker } from '../core/position-tracker';
import { query } from '../../lib/db/client';
import { getWalletForType, WalletType } from '../../lib/wallet/generator';
import { TOKENS, getMintAddress } from '../../lib/config/tokens';
import { RPC_URL, HELIUS_API_KEY, WEBHOOK_API_KEY } from '../../lib/config/constants';
import analyticsRouter from './analytics';

// ============================================================================
// Constants
// ============================================================================

const PORT = 3000;
const MIN_GAS_RESERVE = 0.01; // SOL - always keep for gas
const MAX_SLIPPAGE_BPS = 300; // 3% from constants
const MIN_OUTPUT_AMOUNT = 0.0001; // Minimum output in tokens

// ============================================================================
// Type Definitions
// ============================================================================

interface TradingViewWebhook {
  symbol: string; // SOLUSD, FARTCOIN, FARTBOY, USELESS
  action: string; // BUY or SELL
  timeframe: string; // 30, 60, 240
  price: string; // ignored
}

interface RouteInfo {
  walletType: WalletType;
  wallet: Keypair;
  walletId: number;
  inputToken: string;
  outputToken: string;
  inputMint: string;
  outputMint: string;
}

interface ErrorResponse {
  success: false;
  reason: string;
  error: string;
}

interface SuccessResponse {
  success: true;
  tradeId: number;
  signature: string;
  inputAmount: number;
  outputAmount: number;
  actualSlippage: number;
}

// ============================================================================
// Initialize Services
// ============================================================================

const heliusClient = new HeliusClient({ apiKey: HELIUS_API_KEY });
const transactionVerifier = new TransactionVerifier(heliusClient);
const balanceSyncer = new BalanceSyncer(heliusClient);
const positionTracker = new PositionTracker();
const jupiter = new JupiterDex(RPC_URL);

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();

app.use(express.json());

// Mount analytics router
app.use('/analytics', analyticsRouter);

// Dashboard endpoint
app.get('/dashboard', (req: Request, res: Response) => {
  res.sendFile('dashboard.html', { root: __dirname });
});

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
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

// Main webhook endpoint
app.post('/webhook', async (req: Request, res: Response) => {
  const startTime = Date.now();
  console.log(`[WEBHOOK] Received request at ${new Date().toISOString()}`);

  try {
    // Step 1: Authenticate
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (apiKey !== WEBHOOK_API_KEY) {
      console.error('[WEBHOOK] Authentication failed');
      return res.status(401).json({
        success: false,
        reason: 'authentication_failed',
        error: 'Unauthorized: Invalid API key',
      } as ErrorResponse);
    }

    // Step 2: Parse webhook payload
    const webhookResult = parseWebhook(req.body);
    if (!webhookResult.success) {
      console.error(`[WEBHOOK] Parse failed: ${webhookResult.error}`);
      return res.status(400).json({
        success: false,
        reason: 'parse_failed',
        error: webhookResult.error,
      } as ErrorResponse);
    }

    const { symbol, action, timeframe } = webhookResult.data;
    console.log(`[WEBHOOK] Parsed: ${action} ${symbol} [${timeframe}]`);

    // Step 3: Route to correct wallet
    const routingResult = await routeToWallet(symbol, action, timeframe);
    if (!routingResult.success) {
      console.error(`[WEBHOOK] Routing failed: ${routingResult.error}`);
      return res.status(400).json({
        success: false,
        reason: 'routing_failed',
        error: routingResult.error,
      } as ErrorResponse);
    }

    const route = routingResult.data;
    console.log(
      `[WEBHOOK] Routed to wallet: ${route.walletType} (${route.wallet.publicKey.toString().slice(0, 8)}...)`
    );

    // Step 4: Validate pre-execution conditions
    const validationResult = await preValidate(route, action);
    if (!validationResult.success) {
      console.error(`[WEBHOOK] Pre-validation failed: ${validationResult.error}`);
      return res.status(400).json({
        success: false,
        reason: validationResult.reason,
        error: validationResult.error,
      } as ErrorResponse);
    }

    // Step 5: Calculate trade amounts
    const amountsResult = await calculateAmounts(route, action, validationResult.balance);
    if (!amountsResult.success) {
      console.error(`[WEBHOOK] Amount calculation failed: ${amountsResult.error}`);
      return res.status(400).json({
        success: false,
        reason: 'calculation_failed',
        error: amountsResult.error,
      } as ErrorResponse);
    }

    console.log(`[WEBHOOK] Trade amounts: ${amountsResult.inputAmount} → ${amountsResult.outputToken}`);

    // Step 6: Record pending trade in database
    const tradeId = await recordPendingTrade({
      walletId: route.walletId,
      symbol,
      action,
      timeframe,
      inputToken: route.inputToken,
      outputToken: route.outputToken,
      inputAmount: amountsResult.inputAmount,
    });

    console.log(`[WEBHOOK] Created trade record: ${tradeId}`);

    // Step 7: Get Jupiter quote
    let quote: QuoteResult;
    try {
      quote = await jupiter.getQuote({
        inputMint: route.inputMint,
        outputMint: route.outputMint,
        amount: amountsResult.inputAmountRaw,
        inputSymbol: route.inputToken,
        outputSymbol: route.outputToken,
      });

      await updateTradeStatus(tradeId, 'quoted', { quoteJson: quote });
      console.log(
        `[WEBHOOK] Quote received: ${quote.outAmount} ${route.outputToken} (impact: ${quote.priceImpactPct.toFixed(2)}%)`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Quote failed';
      await updateTradeStatus(tradeId, 'failed', { error: errorMsg, reason: 'quote_failed' });
      console.error(`[WEBHOOK] Quote failed: ${errorMsg}`);
      return res.status(400).json({
        success: false,
        reason: 'quote_failed',
        error: errorMsg,
      } as ErrorResponse);
    }

    // Step 8: Execute swap
    const swapResult = await jupiter.executeSwap({
      quote,
      wallet: route.wallet,
      priorityFeeLamports: 10000,
    });

    if (!swapResult.success) {
      await updateTradeStatus(tradeId, 'failed', {
        error: swapResult.error,
        reason: 'execution_failed',
      });
      console.error(`[WEBHOOK] Execution failed: ${swapResult.error}`);
      return res.status(500).json({
        success: false,
        reason: 'execution_failed',
        error: swapResult.error || 'Swap execution failed',
      } as ErrorResponse);
    }

    console.log(`[WEBHOOK] Swap executed: ${swapResult.signature}`);

    // Step 9: Verify transaction on-chain
    const verification = await transactionVerifier.verifyTransaction({
      signature: swapResult.signature!,
      walletAddress: route.wallet.publicKey.toString(),
      expectedInputMint: route.inputMint,
      expectedOutputMint: route.outputMint,
    });

    if (!verification.success) {
      await updateTradeStatus(tradeId, 'failed', {
        signature: swapResult.signature,
        error: verification.error,
        reason: 'verification_failed',
      });
      console.error(`[WEBHOOK] Verification failed: ${verification.error}`);
      return res.status(500).json({
        success: false,
        reason: 'verification_failed',
        error: verification.error || 'Transaction verification failed',
      } as ErrorResponse);
    }

    // Calculate actual slippage
    const actualSlippage = transactionVerifier.calculateSlippage(
      swapResult.inputAmount,
      parseInt(quote.outAmount),
      verification.inputAmount,
      verification.outputAmount
    );

    console.log(`[WEBHOOK] Verified: ${verification.outputAmount} received (slippage: ${actualSlippage.toFixed(2)}%)`);

    // Step 10: Update trade record
    await updateTradeStatus(tradeId, 'verified', {
      signature: swapResult.signature,
      outputAmount: verification.outputAmount,
      actualSlippage,
      verificationJson: verification,
    });

    // Step 11: Update position tracker
    try {
      if (action === 'BUY') {
        await positionTracker.recordBuy({
          walletId: route.walletId,
          token: route.outputToken,
          amount: verification.outputAmount,
          cost: verification.inputAmount,
          tradeId,
        });
        console.log(`[WEBHOOK] Position updated: BUY ${verification.outputAmount} ${route.outputToken}`);
      } else {
        const sellResult = await positionTracker.recordSell({
          walletId: route.walletId,
          token: route.inputToken,
          amount: verification.inputAmount,
          proceeds: verification.outputAmount,
          tradeId,
        });
        console.log(
          `[WEBHOOK] Position updated: SELL ${verification.inputAmount} ${route.inputToken} (P&L: ${sellResult.realized_pnl.toFixed(4)})`
        );
      }
    } catch (error) {
      console.error(`[WEBHOOK] Position tracking error: ${error instanceof Error ? error.message : error}`);
      // Don't fail the webhook - trade succeeded, position tracking can be fixed manually
    }

    // Step 12: Run balance check
    try {
      await runBalanceCheck(route, action);
    } catch (error) {
      console.error(`[WEBHOOK] Balance check error: ${error instanceof Error ? error.message : error}`);
      // Don't fail the webhook - balance checks are for monitoring
    }

    const duration = Date.now() - startTime;
    console.log(`[WEBHOOK] SUCCESS in ${duration}ms: ${swapResult.signature}`);

    return res.json({
      success: true,
      tradeId,
      signature: swapResult.signature,
      inputAmount: verification.inputAmount,
      outputAmount: verification.outputAmount,
      actualSlippage,
    } as SuccessResponse);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[WEBHOOK] FATAL ERROR after ${duration}ms:`, error);
    return res.status(500).json({
      success: false,
      reason: 'internal_error',
      error: error instanceof Error ? error.message : 'Internal server error',
    } as ErrorResponse);
  }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[WEBHOOK] Unhandled error:', err);
  res.status(500).json({
    success: false,
    reason: 'unhandled_error',
    error: err.message,
  } as ErrorResponse);
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse and validate TradingView webhook payload
 */
function parseWebhook(
  body: any
): { success: true; data: TradingViewWebhook } | { success: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { success: false, error: 'Invalid request body' };
  }

  const { symbol, action, timeframe, price } = body;

  if (!symbol || typeof symbol !== 'string') {
    return { success: false, error: 'Missing or invalid field: symbol' };
  }

  if (!action || typeof action !== 'string') {
    return { success: false, error: 'Missing or invalid field: action' };
  }

  if (!timeframe || typeof timeframe !== 'string') {
    return { success: false, error: 'Missing or invalid field: timeframe' };
  }

  const normalizedAction = action.toUpperCase();
  if (normalizedAction !== 'BUY' && normalizedAction !== 'SELL') {
    return { success: false, error: `Invalid action: ${action} (must be BUY or SELL)` };
  }

  const normalizedSymbol = symbol.toUpperCase();
  const validSymbols = ['SOLUSD', 'FARTCOIN', 'FARTBOY', 'USELESS'];
  if (!validSymbols.includes(normalizedSymbol)) {
    return { success: false, error: `Invalid symbol: ${symbol} (must be one of ${validSymbols.join(', ')})` };
  }

  return {
    success: true,
    data: {
      symbol: normalizedSymbol,
      action: normalizedAction,
      timeframe,
      price: price || '0',
    },
  };
}

/**
 * Route trade to correct wallet based on symbol and timeframe
 */
async function routeToWallet(
  symbol: string,
  action: string,
  timeframe: string
): Promise<{ success: true; data: RouteInfo } | { success: false; error: string }> {
  try {
    let walletType: WalletType;
    let inputToken: string;
    let outputToken: string;

    if (symbol === 'SOLUSD') {
      // SOL trades: route by timeframe
      if (timeframe === '30') {
        walletType = 'sol_30m';
      } else if (timeframe === '60') {
        walletType = 'sol_60m';
      } else if (timeframe === '240') {
        walletType = 'sol_240m';
      } else {
        return { success: false, error: `Invalid timeframe for SOL trade: ${timeframe} (must be 30, 60, or 240)` };
      }

      inputToken = action === 'BUY' ? 'USDC' : 'SOL';
      outputToken = action === 'BUY' ? 'SOL' : 'USDC';
    } else {
      // Meme trades: route by symbol
      if (symbol === 'FARTCOIN') {
        walletType = 'fartcoin';
      } else if (symbol === 'FARTBOY') {
        walletType = 'fartboy';
      } else if (symbol === 'USELESS') {
        walletType = 'useless';
      } else {
        return { success: false, error: `Unknown meme coin: ${symbol}` };
      }

      inputToken = action === 'BUY' ? 'SOL' : symbol;
      outputToken = action === 'BUY' ? symbol : 'SOL';
    }

    const wallet = getWalletForType(walletType);
    const inputMint = getMintAddress(inputToken);
    const outputMint = getMintAddress(outputToken);

    // Get wallet ID from database
    const walletNameMap: Record<WalletType, string> = {
      sol_30m: 'SOL_30M',
      sol_60m: 'SOL_60M',
      sol_240m: 'SOL_240M',
      fartcoin: 'FARTCOIN',
      fartboy: 'FARTBOY',
      useless: 'USELESS',
    };

    const walletName = walletNameMap[walletType];
    const result = await query('SELECT id FROM wallets WHERE name = $1', [walletName]);

    if (result.rows.length === 0) {
      return { success: false, error: `Wallet not found in database: ${walletName}` };
    }

    const walletId = result.rows[0].id;

    return {
      success: true,
      data: {
        walletType,
        wallet,
        walletId,
        inputToken,
        outputToken,
        inputMint,
        outputMint,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Routing failed',
    };
  }
}

/**
 * Pre-execution validation: check balance and position requirements
 */
async function preValidate(
  route: RouteInfo,
  action: string
): Promise<{ success: true; balance: number } | { success: false; reason: string; error: string }> {
  try {
    const walletAddress = route.wallet.publicKey.toString();

    // Check balance of input token
    let balance: number;
    if (route.inputToken === 'SOL') {
      const lamports = await heliusClient.getSolBalance(walletAddress);
      balance = lamports / 1e9;
    } else {
      const accounts = await heliusClient.getTokenAccountsByOwner(walletAddress, route.inputMint);
      balance = accounts.reduce((sum, acc) => {
        return sum + (acc.account.data.parsed.info.tokenAmount.uiAmount || 0);
      }, 0);
    }

    console.log(`[WEBHOOK] Current balance: ${balance} ${route.inputToken}`);

    // Check minimum balance
    const minRequired = route.inputToken === 'SOL' ? MIN_GAS_RESERVE : MIN_OUTPUT_AMOUNT;
    if (balance < minRequired) {
      return {
        success: false,
        reason: 'insufficient_balance',
        error: `Insufficient ${route.inputToken} balance: ${balance} (minimum: ${minRequired})`,
      };
    }

    // For SELL: validate position exists
    if (action === 'SELL') {
      const position = await positionTracker.getOpenPosition(route.walletId, route.inputToken);
      if (!position) {
        return {
          success: false,
          reason: 'no_open_position',
          error: `Cannot SELL ${route.inputToken}: no open position in wallet`,
        };
      }

      console.log(`[WEBHOOK] Open position: ${position.current_amount} ${route.inputToken}`);
    }

    return { success: true, balance };
  } catch (error) {
    return {
      success: false,
      reason: 'validation_error',
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

/**
 * Calculate trade amounts based on balance and gas reserves
 */
function calculateAmounts(
  route: RouteInfo,
  action: string,
  balance: number
): { success: true; inputAmount: number; inputAmountRaw: number; outputToken: string } | { success: false; error: string } {
  try {
    let inputAmount: number;

    if (action === 'BUY') {
      // BUY: Use all available input token (minus gas reserve if SOL)
      if (route.inputToken === 'SOL') {
        inputAmount = Math.max(0, balance - MIN_GAS_RESERVE);
      } else {
        inputAmount = balance;
      }
    } else {
      // SELL: Use entire position (minus gas reserve if SOL)
      if (route.inputToken === 'SOL') {
        inputAmount = Math.max(0, balance - MIN_GAS_RESERVE);
      } else {
        inputAmount = balance;
      }
    }

    if (inputAmount <= 0) {
      return { success: false, error: `No funds available to trade after gas reserve` };
    }

    // Convert to raw amount (lamports or smallest token units)
    const decimals = TOKENS[route.inputToken].decimals;
    const inputAmountRaw = Math.floor(inputAmount * Math.pow(10, decimals));

    return {
      success: true,
      inputAmount,
      inputAmountRaw,
      outputToken: route.outputToken,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Amount calculation failed',
    };
  }
}

/**
 * Record pending trade in database
 */
async function recordPendingTrade(params: {
  walletId: number;
  symbol: string;
  action: string;
  timeframe: string;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
}): Promise<number> {
  const { walletId, symbol, action, timeframe, inputToken, outputToken, inputAmount } = params;

  const result = await query(
    `INSERT INTO trades (
      wallet_id, webhook_timestamp, tv_action, tv_symbol, tv_timeframe,
      input_token, output_token, input_amount, status
    ) VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING id`,
    [walletId, action, symbol, timeframe, inputToken, outputToken, inputAmount]
  );

  return result.rows[0].id;
}

/**
 * Update trade status in database
 */
async function updateTradeStatus(
  tradeId: number,
  status: string,
  data?: {
    signature?: string;
    outputAmount?: number;
    actualSlippage?: number;
    error?: string;
    reason?: string;
    quoteJson?: any;
    verificationJson?: any;
  }
): Promise<void> {
  const updates: string[] = ['status = $2'];
  const values: any[] = [tradeId, status];
  let paramIndex = 3;

  if (data?.signature) {
    updates.push(`signature = $${paramIndex++}`);
    values.push(data.signature);
    updates.push(`execution_timestamp = NOW()`);
  }

  if (data?.outputAmount !== undefined) {
    updates.push(`output_amount = $${paramIndex++}`);
    values.push(data.outputAmount);
  }

  if (data?.actualSlippage !== undefined) {
    updates.push(`actual_slippage_pct = $${paramIndex++}`);
    values.push(data.actualSlippage);
  }

  if (data?.error) {
    updates.push(`error_message = $${paramIndex++}`);
    values.push(data.error);
  }

  if (data?.reason) {
    updates.push(`rejection_reason = $${paramIndex++}`);
    values.push(data.reason);
  }

  if (data?.quoteJson) {
    updates.push(`quote_json = $${paramIndex++}`);
    values.push(JSON.stringify(data.quoteJson));
  }

  if (data?.verificationJson) {
    updates.push(`verification_json = $${paramIndex++}`);
    values.push(JSON.stringify(data.verificationJson));
  }

  const sql = `UPDATE trades SET ${updates.join(', ')} WHERE id = $1`;
  await query(sql, values);
}

/**
 * Run balance check after trade
 */
async function runBalanceCheck(route: RouteInfo, action: string): Promise<void> {
  const walletAddress = route.wallet.publicKey.toString();

  // Check both input and output token balances
  const tokensToCheck = [route.inputToken, route.outputToken];

  for (const token of tokensToCheck) {
    try {
      const mint = getMintAddress(token);

      let onchainBalance: number;
      if (token === 'SOL') {
        const lamports = await heliusClient.getSolBalance(walletAddress);
        onchainBalance = lamports / 1e9;
      } else {
        const accounts = await heliusClient.getTokenAccountsByOwner(walletAddress, mint);
        onchainBalance = accounts.reduce((sum, acc) => {
          return sum + (acc.account.data.parsed.info.tokenAmount.uiAmount || 0);
        }, 0);
      }

      // Record balance check in database
      await query(
        `INSERT INTO balance_checks (wallet_id, token, db_balance, onchain_balance, discrepancy, is_mismatch)
         VALUES ($1, $2, $3, $4, 0, false)`,
        [route.walletId, token, 0, onchainBalance]
      );

      console.log(`[WEBHOOK] Balance check: ${token} = ${onchainBalance}`);
    } catch (error) {
      console.error(`[WEBHOOK] Balance check failed for ${token}:`, error);
    }
  }
}

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`[WEBHOOK] Server listening on port ${PORT}`);
  console.log(`[WEBHOOK] Health check: http://localhost:${PORT}/health`);
  console.log(`[WEBHOOK] Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log(`[WEBHOOK] Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[WEBHOOK] Analytics API: http://localhost:${PORT}/analytics`);
  console.log(`[WEBHOOK] Analytics fees: http://localhost:${PORT}/analytics/fees`);
  console.log(`[WEBHOOK] Ready to receive TradingView alerts`);
});
