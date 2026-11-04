import fs from 'node:fs/promises';
import path from 'node:path';
import {refreshHistory, distributionSchema} from '../lib/source.mjs';
import {atomic, buildAssets} from './assets.mjs';

const root = process.cwd();
const checkpoint = path.join(root, '.state/checkpoint.json');
const catalogPath = path.join(root, 'assets/distribution-catalog.json');
const csvUrl = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
const queueUrl = process.env.BACKFILL_QUEUE_URL;
const token = process.env.BACKFILL_JOB_TOKEN;
const validSymbol = /^\d{4,6}[A-Z]?$/;
if (!queueUrl?.startsWith('https://') || !token) throw Error('Backfill queue configuration required');
const queue = new URL('/internal/backfill', queueUrl);
const authorization = {Authorization: 'Bearer ' + token};

async function queueRequest(options = {}) {
  const response = await fetch(queue, {...options, headers: {...authorization, ...options.headers}, signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Error('Backfill queue request failed');
  return response.json();
}

if (process.argv.includes('--ack')) {
  const state = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
  const published = JSON.parse(await fs.readFile('.state/published.json', 'utf8'));
  const manifest = JSON.parse(await fs.readFile('assets/manifest.json', 'utf8'));
  if (published.version !== manifest.version) throw Error('Backfill publication has not been verified');
  const {symbols} = await queueRequest();
  const queued = new Set(symbols);
  for (const [symbol, item] of Object.entries(state.items)) {
    if (!item.backfillState || !queued.has(symbol)) continue;
    if (item.backfillState === 'ready' && !manifest.items.some(entry => entry.symbol === symbol && entry.version === item.data.version)) continue;
    await queueRequest({method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({symbol, state: item.backfillState})});
  }
} else {
  if (!process.argv.includes('--fetch') || process.env.HISTORY_APPROVED !== 'true') throw Error('Approved source operation required');
  const state = JSON.parse(await fs.readFile(checkpoint, 'utf8'));
  state.source ??= {};
  const priorCatalog = await fs.readFile(catalogPath, 'utf8').then(JSON.parse, e => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  if (!priorCatalog || !(Date.now() - Date.parse(state.source.catalogCheckedAt) < 86400000)) {
    const response = await fetch(csvUrl, {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw Error('Public source catalog unavailable');
    const lines = (await response.text()).replace(/^\uFEFF/, '').split(/\r?\n/);
    const columns = line => line.split(',').map(field => field.trim().replace(/^"|"$/g, ''));
    const column = columns(lines[0]).indexOf('證券代號');
    if (column < 0) throw Error('Public source catalog format changed');
    const symbols = [...new Set(lines.slice(1).map(line => columns(line)[column]).filter(s => validSymbol.test(s)))].sort();
    if (!symbols.length || symbols.length > 10000) throw Error('Invalid public source catalog');
    await atomic(catalogPath, {symbols});
    state.source.catalogCheckedAt = new Date().toISOString();
    await atomic(checkpoint, state);
  }
  if (!state.source.blocked && !(Date.parse(state.source.cooldownUntil ?? '') > Date.now())) {
    const {symbols} = await queueRequest();
    if (!Array.isArray(symbols) || symbols.length > 10 || symbols.some(s => typeof s !== 'string' || !validSymbol.test(s))) throw Error('Invalid queue response');
    const catalog = new Set(JSON.parse(await fs.readFile(catalogPath, 'utf8')).symbols);
    let requests = 1;
    const deadline = Date.now() + 8 * 60000;
    for (const symbol of new Set(symbols)) {
      // Eight periods can take up to 26 requests with retries and form reloads.
      if (requests > 54 || Date.now() >= deadline) break;
      const item = state.items[symbol] ??= {};
      if (item.backfillState) continue;
      if (!catalog.has(symbol)) {
        item.backfillState = 'unavailable';
        continue;
      }
      if (item.data?.periods.length && item.progress?.mode !== 'initialize') {
        item.backfillState = 'ready';
        continue;
      }
      const initial = item.data ?? {schema:1,symbol,type:'unknown',version:'initial',updatedAt:new Date().toISOString(),source:'TDCC',availableDates:[],periods:[]};
      try {
        item.data = await refreshHistory(symbol, distributionSchema.parse(initial), {
          mode: 'initialize', maxPeriods: 8, progress: item.progress,
          shouldYield: () => Date.now() >= deadline,
          beforeRequest: async () => { if (requests >= 80) throw Error('Source budget exhausted'); },
          fetcher: async (url, options) => { requests++; return fetch(url, options); },
          checkpoint: async (data, progress) => {
            item.data = data;
            item.progress = progress;
            state.source.cooldownUntil = progress.cooldownUntil;
            await atomic(checkpoint, state);
          },
        });
        if (item.progress.finished) item.backfillState = item.data.periods.length ? 'ready' : 'unavailable';
      } catch (error) {
        if (error.status === 429) state.source.cooldownUntil = error.retryAt ?? new Date(Date.now() + 300000).toISOString();
        else if ([401,403].includes(error.status) || error.kind === 'review') {
          state.source.blocked = [401,403].includes(error.status) ? 'authorization' : 'review';
          item.backfillState = 'paused';
        } else if (item.progress?.retryExhausted || error.kind === 'paused') item.backfillState = 'paused';
        await atomic(checkpoint, state);
        break;
      }
      await atomic(checkpoint, state);
    }
    await atomic(checkpoint, state);
  }
  const accepted = Object.values(state.items).flatMap(item => item.data?.periods.length ? [item.data] : []);
  await buildAssets(root, accepted);
}
