import { getAllWallets } from '../lib/wallet/generator';
import { query } from '../lib/db/client';

/**
 * Initialize database with actual wallet addresses
 * Run this after creating the database schema
 */
async function initWallets() {
  console.log('Initializing wallet addresses in database...\n');

  const wallets = getAllWallets();

  const walletMappings = [
    { name: 'SOL_30M', type: 'sol_30m' as const },
    { name: 'SOL_60M', type: 'sol_60m' as const },
    { name: 'SOL_240M', type: 'sol_240m' as const },
    { name: 'FARTCOIN', type: 'fartcoin' as const },
    { name: 'FARTBOY', type: 'fartboy' as const },
    { name: 'USELESS', type: 'useless' as const }
  ];

  for (const mapping of walletMappings) {
    const keypair = wallets[mapping.type];
    const address = keypair.publicKey.toString();

    await query(
      'UPDATE wallets SET address = $1 WHERE name = $2',
      [address, mapping.name]
    );

    console.log(`${mapping.name.padEnd(12)} → ${address}`);
  }

  console.log('\n✅ Wallet addresses initialized successfully!');

  // Verify all wallets
  const result = await query('SELECT name, address, trading_pair FROM wallets ORDER BY id');
  console.log('\nRegistered Wallets:');
  console.log('='.repeat(80));
  result.rows.forEach((row: any) => {
    console.log(`${row.name.padEnd(12)} ${row.address.padEnd(44)} [${row.trading_pair}]`);
  });

  process.exit(0);
}

initWallets().catch((error) => {
  console.error('Failed to initialize wallets:', error);
  process.exit(1);
});
