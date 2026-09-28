// Fires N requests at the restaurants endpoint and reports status codes, to
// demonstrate the per-IP rate limit (RATE_LIMIT_MAX, default 100 per 60s window).
//
// Requests go out in small concurrent batches: sent one at a time, 101 requests
// at ~700ms each take longer than the 60s window, so the counter resets before
// the limit is reached.
//
// Usage: node scripts/rate-limit-test.mjs [baseUrl] [count] [concurrency]

const baseUrl = process.argv[2] ?? "https://food-api-sigma-rosy.vercel.app";
const count = Number(process.argv[3] ?? 101);
const concurrency = Number(process.argv[4] ?? 10);
const url = `${baseUrl}/api/v1/restaurants?limit=1`;

console.log(`Sending ${count} requests to ${url} (${concurrency} at a time)\n`);

async function hit(i) {
  const started = Date.now();
  const response = await fetch(url);
  const ms = Date.now() - started;

  let detail = "";
  if (response.status === 429) {
    const body = await response.json();
    detail = `  Retry-After=${response.headers.get("retry-after")}s  ${body.error.message}`;
  } else {
    await response.arrayBuffer();
  }

  return { i, status: response.status, ms, detail };
}

const results = [];
const startedAll = Date.now();

for (let start = 1; start <= count; start += concurrency) {
  const batch = [];
  for (let i = start; i < start + concurrency && i <= count; i += 1) {
    batch.push(hit(i));
  }
  results.push(...(await Promise.all(batch)));
}

const elapsed = ((Date.now() - startedAll) / 1000).toFixed(1);
const tally = {};

for (const { i, status, ms, detail } of results) {
  tally[status] = (tally[status] ?? 0) + 1;
  console.log(`#${String(i).padStart(3)}  ${status}  ${String(ms).padStart(5)}ms${detail}`);
}

console.log(`\nSummary (${elapsed}s total):`, tally);
console.log(
  tally[429]
    ? `Rate limiting works: ${tally[429]} request(s) rejected with 429.`
    : "No 429 received. The limiter is in-memory per instance, so requests may have been spread across several Vercel instances.",
);
