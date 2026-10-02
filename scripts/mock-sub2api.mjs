/**
 * Run the demo site on a fixed port, for manual checks and README screenshots.
 *
 *   node scripts/mock-sub2api.mjs 8799
 *   $env:MOCK_ANY_KEY='1'; node scripts/mock-sub2api.mjs 8799   # accept any credential
 *
 * The server itself lives in test/mock-sub2api.mjs and is imported by the tests;
 * this wrapper exists so that nothing under test/ starts listening on import
 * (`node --test` runs every file there as a test file).
 */
import { createMockSub2Api } from '../test/mock-sub2api.mjs';

const port = Number(process.argv[2] ?? 8799);
const server = createMockSub2Api().listen(port, '127.0.0.1', () => {
  console.log(`mock sub2api on http://127.0.0.1:${port}`);
});
server.on('error', (error) => {
  console.error(`cannot listen on ${port}: ${error.message}`);
  process.exitCode = 1;
});
