import { main } from './test-owners.mjs';

main(process.argv[2] === '--list' ? ['--plan'] : ['--run', 'local']);
