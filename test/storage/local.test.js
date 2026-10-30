import { env } from 'cloudflare:test';
import { LocalStorage } from '../../src/storage/local.js';
import { storageContract } from './contract.js';

storageContract('local', async () => new LocalStorage(env.DB));
