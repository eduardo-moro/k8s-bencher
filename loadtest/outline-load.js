import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.OUTLINE_URL || 'http://outline:3000';
const TOKEN = __ENV.OUTLINE_API_TOKEN;

if (!TOKEN) {
  throw new Error('OUTLINE_API_TOKEN env var is required');
}

const VUS = __ENV.VUS ? Number(__ENV.VUS) : 15;

// Tracked separately so the report can show "fetch document content" and
// "search" as two distinct test types, not just one blended average.
const contentFetchDuration = new Trend('content_fetch_duration');
const contentFetchErrors = new Rate('content_fetch_errors');
const searchDuration = new Trend('search_duration');
const searchErrors = new Rate('search_errors');

export const options = {
  scenarios: {
    steady_state: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: '120s', target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<1.1'], // informational only; we read the rate, not a hard fail gate
  },
};

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

export default function () {
  const listRes = http.post(
    `${BASE_URL}/api/documents.list`,
    JSON.stringify({ limit: 25 }),
    { headers }
  );
  check(listRes, { 'documents.list 200': (r) => r.status === 200 });

  let docs = [];
  try {
    docs = listRes.json('data');
  } catch (e) {
    docs = [];
  }

  if (Array.isArray(docs) && docs.length > 0) {
    const doc = docs[Math.floor(Math.random() * docs.length)];

    // Test type 1: ask for the content of a document.
    const infoRes = http.post(
      `${BASE_URL}/api/documents.info`,
      JSON.stringify({ id: doc.id }),
      { headers }
    );
    contentFetchDuration.add(infoRes.timings.duration);
    const infoOk = check(infoRes, {
      'documents.info 200': (r) => r.status === 200,
      'documents.info has content': (r) => {
        try {
          return (r.json('data.text') || '').length > 0;
        } catch (e) {
          return false;
        }
      },
    });
    contentFetchErrors.add(!infoOk);

    // Test type 2: search across documents.
    const searchRes = http.post(
      `${BASE_URL}/api/documents.search`,
      JSON.stringify({ query: 'a' }),
      { headers }
    );
    searchDuration.add(searchRes.timings.duration);
    const searchOk = check(searchRes, {
      'documents.search 200': (r) => r.status === 200,
      'documents.search returns an array': (r) => {
        try {
          return Array.isArray(r.json('data'));
        } catch (e) {
          return false;
        }
      },
    });
    searchErrors.add(!searchOk);

    if (Math.random() < 0.1) {
      const updateRes = http.post(
        `${BASE_URL}/api/documents.update`,
        JSON.stringify({ id: doc.id, text: doc.text || ' ' }),
        { headers }
      );
      check(updateRes, { 'documents.update 200': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
