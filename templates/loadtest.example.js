import http from 'k6/http';
import { check, sleep } from 'k6';

// Target URL is hardcoded to this app's own Service/port — not a config
// field, since only the dev writing this script knows its shape.
const BASE_URL = 'http://httpbin:80';
const VUS = __ENV.VUS ? Number(__ENV.VUS) : 15;

export default function () {
  const res = http.get(`${BASE_URL}/get`);
  check(res, { 'GET /get 200': (r) => r.status === 200 });
  sleep(1);
}
