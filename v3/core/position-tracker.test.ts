/**
 * Position Tracker Test Suite
 *
 * Tests the FIFO position tracking system's critical safeguards:
 * 1. Validates position existence before sells
 * 2. Validates sell amounts don't exceed position size
 * 3. Correctly calculates FIFO cost basis and P&L
 * 4. Flags issues instead of auto-correcting
 * 5. Maintains position lifecycle (OPEN → PARTIAL → CLOSED)
 */

import { PositionTracker } from './position-tracker';
import { query } from '../../lib/db/client';

describe('PositionTracker', () => {
  let tracker: PositionTracker;
  const testWalletId = 1;
  const testToken = 'TEST';

  beforeEach(async () => {
    tracker = new PositionTracker();

    // Clean up test data
    await query('DELETE FROM position_flags WHERE wallet_id = $1', [testWalletId]);
    await query('DELETE FROM positions WHERE wallet_id = $1', [testWalletId]);
  });

  describe('recordBuy', () => {
    it('should create a new position on first buy', async () => {
      const position = await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      expect(position.status).toBe('OPEN');
      expect(position.total_entry_amount).toBe(100);
      expect(position.total_entry_cost).toBe(1000);
      expect(position.avg_entry_price).toBe(10);
      expect(position.current_amount).toBe(100);
      expect(position.total_exit_amount).toBe(0);
      expect(position.realized_pnl).toBe(0);
    });

    it('should add to existing position using FIFO', async () => {
      // First buy: 100 tokens at $10 each = $1000
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      // Second buy: 50 tokens at $12 each = $600
      const position = await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 50,
        cost: 600,
        tradeId: 2
      });

      // Total: 150 tokens for $1600 = $10.67 avg
      expect(position.status).toBe('OPEN');
      expect(position.total_entry_amount).toBe(150);
      expect(position.total_entry_cost).toBe(1600);
      expect(position.avg_entry_price).toBeCloseTo(10.67, 2);
      expect(position.current_amount).toBe(150);
    });

    it('should reject invalid buy amounts', async () => {
      await expect(
        tracker.recordBuy({
          walletId: testWalletId,
          token: testToken,
          amount: 0,
          cost: 1000,
          tradeId: 1
        })
      ).rejects.toThrow('Invalid buy amount');

      await expect(
        tracker.recordBuy({
          walletId: testWalletId,
          token: testToken,
          amount: -100,
          cost: 1000,
          tradeId: 1
        })
      ).rejects.toThrow('Invalid buy amount');
    });
  });

  describe('recordSell - Validations', () => {
    it('should throw error when selling without position', async () => {
      await expect(
        tracker.recordSell({
          walletId: testWalletId,
          token: testToken,
          amount: 100,
          proceeds: 1200,
          tradeId: 1
        })
      ).rejects.toThrow('no open position');

      // Verify flag was created
      const flagRes = await query(
        'SELECT * FROM position_flags WHERE wallet_id = $1 AND flag_type = $2',
        [testWalletId, 'sell_without_position']
      );
      expect(flagRes.rows.length).toBe(1);
      expect(flagRes.rows[0].severity).toBe('critical');
    });

    it('should throw error when sell exceeds position', async () => {
      // Create position with 100 tokens
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      // Try to sell 150 tokens
      await expect(
        tracker.recordSell({
          walletId: testWalletId,
          token: testToken,
          amount: 150,
          proceeds: 1800,
          tradeId: 2
        })
      ).rejects.toThrow('only 100');

      // Verify flag was created
      const flagRes = await query(
        'SELECT * FROM position_flags WHERE wallet_id = $1 AND flag_type = $2',
        [testWalletId, 'sell_exceeds_position']
      );
      expect(flagRes.rows.length).toBe(1);
      expect(flagRes.rows[0].severity).toBe('critical');
    });
  });

  describe('recordSell - FIFO Accounting', () => {
    it('should calculate realized P&L correctly using FIFO', async () => {
      // Buy 100 tokens at $10 each = $1000 cost
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      // Sell 50 tokens for $600 proceeds
      // Cost basis: $10 * 50 = $500
      // Realized P&L: $600 - $500 = $100
      const result = await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 50,
        proceeds: 600,
        tradeId: 2
      });

      expect(result.cost_basis).toBe(500);
      expect(result.realized_pnl).toBe(100);
      expect(result.position.current_amount).toBe(50);
      expect(result.position.status).toBe('PARTIAL');
    });

    it('should handle multiple buys and sells with correct avg price', async () => {
      // Buy 1: 100 tokens at $10 = $1000
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      // Buy 2: 50 tokens at $12 = $600
      // Avg price now: $1600 / 150 = $10.67
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 50,
        cost: 600,
        tradeId: 2
      });

      // Sell 100 tokens for $1300
      // Cost basis: $10.67 * 100 = $1066.67
      // Realized P&L: $1300 - $1066.67 = $233.33
      const result = await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        proceeds: 1300,
        tradeId: 3
      });

      expect(result.cost_basis).toBeCloseTo(1066.67, 2);
      expect(result.realized_pnl).toBeCloseTo(233.33, 2);
      expect(result.position.current_amount).toBe(50);
    });

    it('should accumulate realized P&L across multiple sells', async () => {
      // Buy 100 tokens at $10 = $1000
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      // Sell 1: 30 tokens for $360 (P&L: $360 - $300 = $60)
      await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 30,
        proceeds: 360,
        tradeId: 2
      });

      // Sell 2: 40 tokens for $500 (P&L: $500 - $400 = $100)
      const result = await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 40,
        proceeds: 500,
        tradeId: 3
      });

      // Total realized P&L should be $160
      expect(result.position.realized_pnl).toBe(160);
      expect(result.position.current_amount).toBe(30);
    });
  });

  describe('Position Lifecycle', () => {
    it('should maintain OPEN status on first buy', async () => {
      const position = await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      expect(position.status).toBe('OPEN');
      expect(position.total_exit_amount).toBe(0);
    });

    it('should transition to PARTIAL on first sell', async () => {
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      const result = await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 50,
        proceeds: 600,
        tradeId: 2
      });

      expect(result.position.status).toBe('PARTIAL');
      expect(result.position.total_exit_amount).toBe(50);
      expect(result.position.current_amount).toBe(50);
    });

    it('should transition to CLOSED when fully exited', async () => {
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      const result = await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        proceeds: 1200,
        tradeId: 2
      });

      expect(result.position.status).toBe('CLOSED');
      expect(result.position.current_amount).toBe(0);
      expect(result.position.total_exit_amount).toBe(100);
      expect(result.position.closed_at).not.toBeNull();
    });

    it('should not allow selling from closed position', async () => {
      // Buy and fully sell
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        proceeds: 1200,
        tradeId: 2
      });

      // Try to sell from closed position
      await expect(
        tracker.recordSell({
          walletId: testWalletId,
          token: testToken,
          amount: 50,
          proceeds: 600,
          tradeId: 3
        })
      ).rejects.toThrow('no open position');
    });
  });

  describe('getOpenPosition', () => {
    it('should return null when no position exists', async () => {
      const position = await tracker.getOpenPosition(testWalletId, testToken);
      expect(position).toBeNull();
    });

    it('should return open position', async () => {
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      const position = await tracker.getOpenPosition(testWalletId, testToken);
      expect(position).not.toBeNull();
      expect(position?.status).toBe('OPEN');
      expect(position?.current_amount).toBe(100);
    });

    it('should return partial position', async () => {
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 50,
        proceeds: 600,
        tradeId: 2
      });

      const position = await tracker.getOpenPosition(testWalletId, testToken);
      expect(position).not.toBeNull();
      expect(position?.status).toBe('PARTIAL');
      expect(position?.current_amount).toBe(50);
    });

    it('should return null for closed position', async () => {
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        cost: 1000,
        tradeId: 1
      });

      await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        proceeds: 1200,
        tradeId: 2
      });

      const position = await tracker.getOpenPosition(testWalletId, testToken);
      expect(position).toBeNull();
    });
  });

  describe('Flagging System', () => {
    it('should flag oversized positions', async () => {
      // Create a large position (> $50k)
      await tracker.recordBuy({
        walletId: testWalletId,
        token: testToken,
        amount: 10000,
        cost: 100000,
        tradeId: 1
      });

      // Sell a small amount to trigger flag check
      await tracker.recordSell({
        walletId: testWalletId,
        token: testToken,
        amount: 100,
        proceeds: 1100,
        tradeId: 2
      });

      const flagRes = await query(
        'SELECT * FROM position_flags WHERE wallet_id = $1 AND flag_type = $2',
        [testWalletId, 'oversized_position']
      );

      expect(flagRes.rows.length).toBeGreaterThan(0);
    });

    it('should create flags with proper metadata', async () => {
      // Trigger sell_without_position flag
      try {
        await tracker.recordSell({
          walletId: testWalletId,
          token: testToken,
          amount: 100,
          proceeds: 1200,
          tradeId: 999
        });
      } catch (error) {
        // Expected to throw
      }

      const flagRes = await query(
        'SELECT * FROM position_flags WHERE trade_id = $1',
        [999]
      );

      const flag = flagRes.rows[0];
      expect(flag.wallet_id).toBe(testWalletId);
      expect(flag.flag_type).toBe('sell_without_position');
      expect(flag.severity).toBe('critical');
      expect(flag.description).toContain('Trade ID: 999');
      expect(flag.resolved).toBe(false);
    });
  });
});
