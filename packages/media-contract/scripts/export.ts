/**
 * `npm run contract:export`: writes `schema/contract.json` from the shapes.
 * The Jest drift test compares the file with what the shapes produce, so a
 * shape changed without running this fails `npm run validate`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractSchemaText } from '../src/registry';

const target = join(__dirname, '..', 'schema', 'contract.json');
mkdirSync(join(__dirname, '..', 'schema'), { recursive: true });
writeFileSync(target, contractSchemaText(), 'utf8');
process.stdout.write('Wrote schema/contract.json\n');
