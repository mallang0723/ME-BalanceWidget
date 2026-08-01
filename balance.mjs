#!/usr/bin/env node
/*
 * balance.mjs — 독립 실행형 API 잔액 조회 CLI.
 *
 * 옛 마리나라 브라우저 확장("API 잔액 위젯" + "API 잔액 수집기", client/extension.js
 * + server/extension.js)의 HTTP 로직만 이식한 스크립트다. v2.3.4에서 마리나라의
 * 확장 시스템이 완전히 제거되어(이 파일이 만들어진 컨테이너에서 실측: 살아있는
 * 서버에 /api/extensions 요청 시 404) 원본 확장은 더 이상 실행되지 않는다.
 *
 * 표시 항목은 원본과 동일:
 *   - DeepSeek 잔액   : GET https://api.deepseek.com/user/balance (Bearer)
 *   - OpenRouter 크레딧: GET https://openrouter.ai/api/v1/credits (Bearer)
 *   - Claude 당월 사용액: GET https://api.anthropic.com/v1/organizations/cost_report
 *                        (x-api-key = Admin 키, 일반 sk-ant 키는 사용 불가)
 *
 * 원본과 달리 Anthropic cost_report의 amount를 센트(최소 통화 단위)로 해석한다
 * — 공식 문서 기준. 원본 server/extension.js는 이를 달러로 취급해 100배 크게
 * 표시하는 버그가 있었다.
 *
 * 외부 의존성 0, Node.js 18+ 전제(전역 fetch 사용).
 *
 * API 키를 stdout/파일에 출력하거나 기록하지 않는다. 이 스크립트는 키를 읽기만
 * 하며 어디에도 저장하지 않는다.
 */

const MAX_COST_REPORT_PAGES = 5;
const REQUEST_TIMEOUT_MS = 10 * 1000;

const PROVIDERS = [
  { id: "deepseek", label: "DeepSeek 잔액", envVar: "DEEPSEEK_API_KEY", fetcher: fetchDeepseek },
  { id: "openrouter", label: "OpenRouter 크레딧", envVar: "OPENROUTER_API_KEY", fetcher: fetchOpenrouter },
  { id: "anthropic", label: "Claude 당월 사용액", envVar: "ANTHROPIC_ADMIN_KEY", fetcher: fetchAnthropicCost },
];

// --- 키 소싱 -----------------------------------------------------------
//
// 우선순위 ① 환경변수. 원본 확장은 마리나라 서버의 확장 storage
// (`/api/extensions/{id}/storage`)에서 키를 자동 발견했지만, v2.3.4에서
// 확장 시스템 자체가 제거되어 그 엔드포인트가 더 이상 존재하지 않는다
// (이 스크립트를 만들며 실제 서버에 확인: `/api/extensions` → 404,
// `/api/health`만 200). 따라서 우선순위 ②(로컬 마리나라 서버 자동 발견)는
// HTTP로 재현 불가능하므로 구현하지 않았다.

function resolveKey(envVar) {
  const value = process.env[envVar];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// --- 공통 헬퍼 ----------------------------------------------------------

// 요청별 타임아웃: 한 제공자가 응답을 붙잡고 있어도 다른 제공자를 막지 않는다.
async function timedFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`시간 초과(${REQUEST_TIMEOUT_MS / 1000}초)`);
    }
    throw error;
  }
}

function invalidResponse(detail) {
  return new Error(`응답 형식 오류 — ${detail}`);
}

// --- 조회 함수 (원본 client/extension.js, server/extension.js 로직 이식) ----

async function fetchDeepseek(key) {
  const res = await timedFetch("https://api.deepseek.com/user/balance", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // 스키마 검증: balance_infos 배열이 없으면(정상 빈 잔액과 구분 불가) 오류.
  if (!Array.isArray(data?.balance_infos)) throw invalidResponse("balance_infos 배열 없음");
  const infos = data.balance_infos;
  if (!infos.length) return { text: "잔액 정보 없음" };
  const parts = infos.map((b, i) => {
    if (!b || typeof b !== "object" || typeof b.currency !== "string" || !b.currency) {
      throw invalidResponse(`balance_infos[${i}].currency 누락`);
    }
    const balance = typeof b.total_balance === "number" ? b.total_balance : parseFloat(String(b.total_balance));
    if (typeof b.total_balance === "undefined" || !Number.isFinite(balance)) {
      throw invalidResponse(`balance_infos[${i}].total_balance 숫자 아님`);
    }
    const symbol = b.currency === "CNY" ? "¥" : b.currency === "USD" ? "$" : `${b.currency} `;
    return `${symbol}${b.total_balance}`;
  });
  return { text: parts.join(" · ") };
}

async function fetchOpenrouter(key) {
  const res = await timedFetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  const data = body?.data;
  // 스키마 검증: 두 필드 모두 유한한 숫자여야 한다 (null → 0 강제 변환 금지).
  if (!data || typeof data !== "object") throw invalidResponse("data 객체 없음");
  if (typeof data.total_credits !== "number" || !Number.isFinite(data.total_credits)) {
    throw invalidResponse("total_credits 숫자 아님");
  }
  if (typeof data.total_usage !== "number" || !Number.isFinite(data.total_usage)) {
    throw invalidResponse("total_usage 숫자 아님");
  }
  const remaining = data.total_credits - data.total_usage;
  return {
    // "(사용 $x)" 표기는 원본에 없던 의도적 확장 — README "원본과 달라진 점" 참고.
    text: `$${remaining.toFixed(2)} 남음 (사용 $${data.total_usage.toFixed(2)})`,
    remaining,
    used: data.total_usage,
  };
}

// cost_report의 amount는 최소 통화 단위(센트)다 — 공식 문서 확인.
// 버킷 구조가 다소 바뀌어도 견디도록 amount를 가진 노드를 재귀 탐색하되,
// 각 항목의 통화가 USD가 아니거나 amount가 숫자가 아니면 즉시 오류.
function sumAmountCents(node) {
  let sum = 0;
  if (Array.isArray(node)) {
    for (const item of node) sum += sumAmountCents(item);
  } else if (node && typeof node === "object") {
    if ("amount" in node) {
      const n = typeof node.amount === "number" ? node.amount : parseFloat(String(node.amount));
      if (!Number.isFinite(n)) throw invalidResponse("amount 숫자 아님");
      if ("currency" in node && node.currency !== "USD") {
        throw invalidResponse(`지원하지 않는 통화 ${String(node.currency)}`);
      }
      sum += n;
    }
    for (const value of Object.values(node)) {
      if (typeof value === "object" && value !== null) sum += sumAmountCents(value);
    }
  }
  return sum;
}

async function fetchAnthropicCost(key) {
  // 시작 시각을 한 번만 캡처해 starting_at과 표시 라벨을 같은 UTC 스냅샷에서
  // 도출한다 (페이지 사이 재계산 금지, 로컬/UTC 월 불일치 방지).
  const now = new Date();
  const startingAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthLabel = now.getUTCMonth() + 1;
  const baseUrl =
    "https://api.anthropic.com/v1/organizations/cost_report?starting_at=" +
    encodeURIComponent(startingAt) +
    "&limit=31";

  let url = baseUrl;
  let totalCents = 0;
  const seenCursors = new Set();
  let complete = false;

  for (let page = 0; page < MAX_COST_REPORT_PAGES; page++) {
    const res = await timedFetch(url, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    const text = await res.text();
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const parsed = JSON.parse(text);
        if (parsed?.error?.message) message = parsed.error.message;
      } catch {
        // 응답이 JSON이 아니면 상태 코드만 사용한다.
      }
      throw new Error(message);
    }
    const data = JSON.parse(text);
    if (!Array.isArray(data?.data)) throw invalidResponse("data 배열 없음");
    totalCents += sumAmountCents(data.data);
    if (!data.has_more) {
      complete = true;
      break;
    }
    // has_more=true면 유효한 새 커서가 반드시 있어야 한다. 없거나 반복되면
    // 부분합을 성공처럼 내지 않고 오류로 처리한다.
    if (typeof data.next_page !== "string" || !data.next_page) {
      throw invalidResponse("has_more=true인데 next_page 없음");
    }
    if (seenCursors.has(data.next_page)) {
      throw invalidResponse("페이지네이션 커서 반복");
    }
    seenCursors.add(data.next_page);
    url = baseUrl + "&page=" + encodeURIComponent(data.next_page);
  }
  if (!complete) {
    throw new Error(`리포트 미완성 — ${MAX_COST_REPORT_PAGES}페이지 안에 끝나지 않음`);
  }

  const monthUsd = Math.round(totalCents) / 100;
  return { text: `$${monthUsd.toFixed(2)} 사용(${monthLabel}월)`, monthUsd };
}

// --- 실행 ---------------------------------------------------------------

async function collectAll() {
  // 제공자별로 병렬 조회 — 실패(타임아웃 포함)는 각자 격리된다.
  const settled = await Promise.allSettled(
    PROVIDERS.map(async (provider) => {
      const key = resolveKey(provider.envVar);
      if (!key) return { id: provider.id, label: provider.label, status: "no-key" };
      try {
        const value = await provider.fetcher(key);
        return { id: provider.id, label: provider.label, status: "ok", ...value };
      } catch (error) {
        return {
          id: provider.id,
          label: provider.label,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? outcome.value
      : { id: PROVIDERS[i].id, label: PROVIDERS[i].label, status: "error", error: String(outcome.reason) },
  );
}

function printHuman(results) {
  console.log("API 잔액 / 사용액\n" + "-".repeat(28));
  for (const r of results) {
    let line;
    if (r.status === "no-key") line = "키 없음";
    else if (r.status === "error") line = `조회 실패 — ${r.error}`;
    else line = r.text;
    console.log(`${r.label.padEnd(18, " ")} ${line}`);
  }
}

async function main() {
  const jsonMode = process.argv.includes("--json");
  const results = await collectAll();

  if (jsonMode) {
    const payload = results.map(({ id, label, status, text, error, remaining, used, monthUsd }) => ({
      id,
      label,
      status,
      ...(text !== undefined ? { text } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(remaining !== undefined ? { remaining } : {}),
      ...(used !== undefined ? { used } : {}),
      ...(monthUsd !== undefined ? { monthUsd } : {}),
    }));
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHuman(results);
  }

  if (results.some((r) => r.status === "error")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`실행 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
