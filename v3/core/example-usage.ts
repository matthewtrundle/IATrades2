/**
 * Example Usage: FIFO Position Tracker
 *
 * This file demonstrates how to integrate the position tracker
 * into the IAGood trading bot's trade execution pipeline.
 */

import { positionTracker } from './position-tracker';
import { query } from '../../lib/db/client';

// ============================================================================
// Example 1: Recording a BUY trade (opening a position)
// ============================================================================

async function exampleRecordBuy() {
  console.log('Example 1: Recording a BUY trade');
  console.log('='.repeat(50));

  try {
    // Simulate a buy trade: Buy 100 SOL with 1000 USDC
    const position = await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,      // Received 100 SOL
      cost: 1000,       // Spent 1000 USDC
      tradeId: 1001
    });

    console.log('✓ Position created successfully');
    console.log(`  Token: ${position.token}`);
    console.log(`  Amount: ${position.current_amount}`);
    console.log(`  Avg Entry Price: $${position.avg_entry_price.toFixed(2)}`);
    console.log(`  Status: ${position.status}`);
    console.log(`  Total Cost: $${position.total_entry_cost}`);
  } catch (error) {
    console.error('✗ Failed to record buy:', error.message);
  }
}

// ============================================================================
// Example 2: Adding to an existing position
// ============================================================================

async function exampleAddToPosition() {
  console.log('\nExample 2: Adding to existing position');
  console.log('='.repeat(50));

  try {
    // First buy: 100 SOL at $10 each
    await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      cost: 1000,
      tradeId: 2001
    });

    // Second buy: 50 SOL at $12 each
    const position = await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 50,
      cost: 600,
      tradeId: 2002
    });

    console.log('✓ Position updated with additional buy');
    console.log(`  Total Amount: ${position.total_entry_amount} SOL`);
    console.log(`  Total Cost: $${position.total_entry_cost}`);
    console.log(`  New Avg Price: $${position.avg_entry_price.toFixed(2)}`);
    console.log(`  Current Amount: ${position.current_amount} SOL`);
  } catch (error) {
    console.error('✗ Failed to add to position:', error.message);
  }
}

// ============================================================================
// Example 3: Recording a SELL trade (partial exit)
// ============================================================================

async function examplePartialSell() {
  console.log('\nExample 3: Partial sell (FIFO P&L calculation)');
  console.log('='.repeat(50));

  try {
    // Create position: 100 SOL at $10 avg
    await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      cost: 1000,
      tradeId: 3001
    });

    // Sell 60 SOL for $720 USDC
    const result = await positionTracker.recordSell({
      walletId: 1,
      token: 'SOL',
      amount: 60,
      proceeds: 720,
      tradeId: 3002
    });

    console.log('✓ Partial sell executed successfully');
    console.log(`  Sell Amount: 60 SOL`);
    console.log(`  Proceeds: $${result.position.total_exit_proceeds}`);
    console.log(`  Cost Basis: $${result.cost_basis.toFixed(2)}`);
    console.log(`  Realized P&L: $${result.realized_pnl.toFixed(2)}`);
    console.log(`  Remaining: ${result.position.current_amount} SOL`);
    console.log(`  Status: ${result.position.status}`);
  } catch (error) {
    console.error('✗ Failed to record sell:', error.message);
  }
}

// ============================================================================
// Example 4: Full exit (closing a position)
// ============================================================================

async function exampleFullExit() {
  console.log('\nExample 4: Full exit (closing position)');
  console.log('='.repeat(50));

  try {
    // Create position: 100 SOL at $10 avg
    await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      cost: 1000,
      tradeId: 4001
    });

    // Sell all 100 SOL for $1200 USDC
    const result = await positionTracker.recordSell({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      proceeds: 1200,
      tradeId: 4002
    });

    console.log('✓ Position fully closed');
    console.log(`  Final Realized P&L: $${result.realized_pnl.toFixed(2)}`);
    console.log(`  Remaining Amount: ${result.position.current_amount} SOL`);
    console.log(`  Status: ${result.position.status}`);
    console.log(`  Closed At: ${result.position.closed_at}`);
  } catch (error) {
    console.error('✗ Failed to close position:', error.message);
  }
}

// ============================================================================
// Example 5: Error handling - Sell without position
// ============================================================================

async function exampleSellWithoutPosition() {
  console.log('\nExample 5: Error handling - Sell without position');
  console.log('='.repeat(50));

  try {
    // Try to sell without having a position
    await positionTracker.recordSell({
      walletId: 1,
      token: 'FARTCOIN',
      amount: 1000,
      proceeds: 500,
      tradeId: 5001
    });

    console.log('✗ This should not have succeeded!');
  } catch (error) {
    console.log('✓ Error correctly thrown (as expected)');
    console.log(`  Message: ${error.message}`);

    // Check that a flag was created
    const flagRes = await query(
      'SELECT * FROM position_flags WHERE trade_id = $1',
      [5001]
    );

    if (flagRes.rows.length > 0) {
      console.log('✓ Flag created for manual review');
      console.log(`  Flag Type: ${flagRes.rows[0].flag_type}`);
      console.log(`  Severity: ${flagRes.rows[0].severity}`);
    }
  }
}

// ============================================================================
// Example 6: Error handling - Sell exceeds position
// ============================================================================

async function exampleSellExceedsPosition() {
  console.log('\nExample 6: Error handling - Sell exceeds position');
  console.log('='.repeat(50));

  try {
    // Create position: 100 SOL
    await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      cost: 1000,
      tradeId: 6001
    });

    // Try to sell 150 SOL (more than we have)
    await positionTracker.recordSell({
      walletId: 1,
      token: 'SOL',
      amount: 150,
      proceeds: 1800,
      tradeId: 6002
    });

    console.log('✗ This should not have succeeded!');
  } catch (error) {
    console.log('✓ Error correctly thrown (as expected)');
    console.log(`  Message: ${error.message}`);

    // Check that a flag was created
    const flagRes = await query(
      'SELECT * FROM position_flags WHERE trade_id = $1',
      [6002]
    );

    if (flagRes.rows.length > 0) {
      console.log('✓ Flag created for manual review');
      console.log(`  Flag Type: ${flagRes.rows[0].flag_type}`);
      console.log(`  Severity: ${flagRes.rows[0].severity}`);
    }
  }
}

// ============================================================================
// Example 7: Querying open positions
// ============================================================================

async function exampleQueryPosition() {
  console.log('\nExample 7: Querying open positions');
  console.log('='.repeat(50));

  try {
    // Create a position
    await positionTracker.recordBuy({
      walletId: 1,
      token: 'SOL',
      amount: 100,
      cost: 1000,
      tradeId: 7001
    });

    // Query the position
    const position = await positionTracker.getOpenPosition(1, 'SOL');

    if (position) {
      console.log('✓ Position found');
      console.log(`  Token: ${position.token}`);
      console.log(`  Current Amount: ${position.current_amount}`);
      console.log(`  Avg Entry Price: $${position.avg_entry_price.toFixed(2)}`);
      console.log(`  Unrealized Value: $${(position.current_amount * position.avg_entry_price).toFixed(2)}`);
      console.log(`  Realized P&L: $${position.realized_pnl.toFixed(2)}`);
      console.log(`  Status: ${position.status}`);
    } else {
      console.log('✗ No open position found');
    }

    // Query non-existent position
    const noPosition = await positionTracker.getOpenPosition(1, 'DOGECOIN');
    console.log(`\n✓ Query for non-existent token returns: ${noPosition}`);
  } catch (error) {
    console.error('✗ Failed to query position:', error.message);
  }
}

// ============================================================================
// Example 8: Integration with trade execution
// ============================================================================

interface Trade {
  id: number;
  wallet_id: number;
  tv_action: 'BUY' | 'SELL';
  input_token: string;
  output_token: string;
  input_amount: number;
  output_amount: number;
  status: string;
}

async function handleTradeExecution(trade: Trade) {
  console.log('\nExample 8: Integration with trade execution');
  console.log('='.repeat(50));
  console.log(`Processing ${trade.tv_action} trade #${trade.id}`);

  try {
    if (trade.tv_action === 'BUY') {
      // For BUY: we receive the output token, spend the input token
      const position = await positionTracker.recordBuy({
        walletId: trade.wallet_id,
        token: trade.output_token,
        amount: trade.output_amount,
        cost: trade.input_amount,
        tradeId: trade.id
      });

      console.log(`✓ BUY recorded: ${position.current_amount} ${position.token} at $${position.avg_entry_price.toFixed(2)}`);

      // Update trade status
      await query(
        'UPDATE trades SET status = $1 WHERE id = $2',
        ['position_tracked', trade.id]
      );

    } else if (trade.tv_action === 'SELL') {
      // For SELL: we sell the input token, receive the output token
      const result = await positionTracker.recordSell({
        walletId: trade.wallet_id,
        token: trade.input_token,
        amount: trade.input_amount,
        proceeds: trade.output_amount,
        tradeId: trade.id
      });

      console.log(`✓ SELL recorded: Realized P&L $${result.realized_pnl.toFixed(2)}`);
      console.log(`  Remaining: ${result.position.current_amount} ${result.position.token}`);

      // Update trade status
      await query(
        'UPDATE trades SET status = $1 WHERE id = $2',
        ['position_tracked', trade.id]
      );
    }

  } catch (error) {
    console.error(`✗ Failed to track position for trade #${trade.id}:`, error.message);

    // Update trade with error status
    await query(
      'UPDATE trades SET status = $1, error_message = $2 WHERE id = $3',
      ['position_error', error.message, trade.id]
    );

    // Re-throw to alert monitoring systems
    throw error;
  }
}

// ============================================================================
// Run all examples
// ============================================================================

async function runAllExamples() {
  console.log('\n🚀 FIFO Position Tracker - Example Usage\n');

  await exampleRecordBuy();
  await exampleAddToPosition();
  await examplePartialSell();
  await exampleFullExit();
  await exampleSellWithoutPosition();
  await exampleSellExceedsPosition();
  await exampleQueryPosition();

  // Example trade execution
  const mockTrade: Trade = {
    id: 8001,
    wallet_id: 1,
    tv_action: 'BUY',
    input_token: 'USDC',
    output_token: 'SOL',
    input_amount: 500,
    output_amount: 50,
    status: 'executed'
  };

  await handleTradeExecution(mockTrade);

  console.log('\n✓ All examples completed\n');
}

// Uncomment to run examples
// runAllExamples().catch(console.error);
