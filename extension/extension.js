/*
 * API 잔액 위젯 — Marinara 클라이언트 확장 (2.3.5 Personal Extensions / full-page).
 * 플로팅 💰 버튼 → 패널에 DeepSeek 잔액 / OpenRouter 크레딧을 표시한다.
 * 두 API 모두 브라우저에서 직접 호출한다 (CORS 허용 — 2026-08-01 재실측).
 *
 * v2.0.0 (2026-08-01): 2.3.5 포팅.
 * - Claude(Anthropic) 사용액 표시는 제거했다. 잔액용 admin 엔드포인트
 *   (/v1/organizations/cost_report)는 브라우저 CORS를 의도적으로 차단하며
 *   (preflight 400, allow-origin 없음 — 실측), 2.3.5 서버 확장 런타임은
 *   네트워크가 없어 구판의 서버 수집기도 이식 불가. Claude는 동봉된
 *   독립 CLI(balance.mjs)로 확인한다.
 * - API 키 취급 (정직 고지, Codex 검토 2026-08-01):
 *   · 저장: 2.3.5 공식 확장 저장소(marinara.storage) — 사용자의 마리나라 서버
 *     DB에 **평문**으로 저장된다(호스트가 이 저장소를 암호화하지 않음).
 *     그 결과 **프로필 내보내기(profile export) ZIP에 키가 포함될 수 있다.**
 *   · 전송: 잔액 조회 시 각 키가 해당 제공자(DeepSeek/OpenRouter)로
 *     Authorization 헤더로 전송된다. 그 외 어디로도 보내지 않는다.
 *   · 로그·콘솔·오류 문자열에는 키를 넣지 않는다.
 */

// ══════════════════════════════════════════════════════════════
// 2.3.5 full-page 호환 심 (marinara-docs-tutor와 동일 패턴)
// ══════════════════════════════════════════════════════════════
marinara = (() => {
  const host = marinara;
  const shim = {
    extensionId: host.extension.id,

    addStyle(css) {
      const el = document.createElement("style");
      el.textContent = String(css);
      el.dataset.mkbwExtension = host.extension.id;
      document.head.appendChild(el);
      host.onCleanup(() => el.remove());
      return el;
    },

    addElement(parent, tag, attrs = {}) {
      const target = typeof parent === "string" ? document.querySelector(parent) : parent;
      if (!target) return null;
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(attrs)) {
        if (key === "innerHTML") el.innerHTML = value;
        else if (key === "textContent") el.textContent = value;
        else el.setAttribute(key, value);
      }
      target.appendChild(el);
      host.onCleanup(() => el.remove());
      return el;
    },

    on(target, event, handler) {
      const wrapped = (...args) => {
        try {
          return handler(...args);
        } catch (error) {
          host.log.error("[mkbw] event handler failed", error);
        }
      };
      target.addEventListener(event, wrapped);
      host.onCleanup(() => target.removeEventListener(event, wrapped));
      return wrapped;
    },
  };
  return Object.freeze(Object.assign(Object.create(null), {
    version: host.version,
    extension: host.extension,
    log: host.log,
    storage: host.storage,
    setTimeout: host.setTimeout,
    clearTimeout: host.clearTimeout,
    setInterval: host.setInterval,
    clearInterval: host.clearInterval,
    onCleanup: host.onCleanup,
  }, shim));
})();

// ── 생명주기 가드: 비활성화 후 잔류 요청·DOM 갱신 방지 ──
const mkbwLifecycle = { disposed: false, abort: new AbortController() };
marinara.onCleanup(() => {
  mkbwLifecycle.disposed = true;
  mkbwLifecycle.abort.abort();
});

const MKBW_POS_KEY = "mkbw-button-pos";
const MKBW_FETCH_THROTTLE_MS = 60 * 1000;

let mkbwConfig = { deepseekKey: "", openrouterKey: "" };
let mkbwLastFetch = 0;
let mkbwCache = { deepseek: null, openrouter: null };

// --- 설정 저장: 2.3.5 공식 확장 저장소 (사용자의 마리나라 서버에만 저장) ---

async function mkbwLoadConfig() {
  const value = await marinara.storage.get();
  for (const key of ["deepseekKey", "openrouterKey"]) {
    if (typeof value?.[key] === "string") mkbwConfig[key] = value[key];
  }
}

async function mkbwSaveConfig(next) {
  if (mkbwLifecycle.disposed) return;
  await marinara.storage.patch({
    deepseekKey: next.deepseekKey,
    openrouterKey: next.openrouterKey,
  });
  if (mkbwLifecycle.disposed) return; // 언로드 후 상태 갱신 방지 (Codex 권고)
  mkbwConfig.deepseekKey = next.deepseekKey;
  mkbwConfig.openrouterKey = next.openrouterKey;
}

// --- 잔액 조회 (브라우저 직접, CORS 허용 실측) ---

// HTTP 상태를 사람이 읽을 안내로 (401 키 문제 / 429 속도 제한 등)
function mkbwHttpHint(status, retryAfter) {
  if (status === 401 || status === 403) return "키 오류(만료·권한 확인)";
  if (status === 429) return retryAfter ? `속도 제한 — ${retryAfter}초 후 재시도` : "속도 제한 — 잠시 후 재시도";
  if (status >= 500) return `제공자 서버 오류(${status})`;
  return `조회 실패(HTTP ${status})`;
}

// 제공자별 독립 타임아웃 (한 곳이 멈춰도 다른 곳을 막지 않도록 — 병렬 실행과 함께)
const MKBW_TIMEOUT_MS = 10 * 1000;
function mkbwTimeoutSignal() {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), MKBW_TIMEOUT_MS);
  // 확장 언로드 시에도 함께 중단
  const onAbort = () => ctl.abort();
  mkbwLifecycle.abort.signal.addEventListener("abort", onAbort, { once: true });
  return { signal: ctl.signal, done: () => window.clearTimeout(timer) };
}

async function mkbwFetchDeepseek(key) {
  const t = mkbwTimeoutSignal();
  let res;
  try {
    res = await fetch("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${key}` },
      signal: t.signal,
    });
  } finally {
    t.done();
  }
  if (!res.ok) throw new Error(mkbwHttpHint(res.status, res.headers.get("retry-after")));
  const data = await res.json();
  const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
  if (!infos.length) return "잔액 정보 없음";
  return infos
    .map((b) => {
      const symbol = b.currency === "CNY" ? "¥" : b.currency === "USD" ? "$" : `${b.currency} `;
      return `${symbol}${b.total_balance}`;
    })
    .join(" · ");
}

async function mkbwFetchOpenrouter(key) {
  const t = mkbwTimeoutSignal();
  let res;
  try {
    res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: t.signal,
    });
  } finally {
    t.done();
  }
  if (!res.ok) throw new Error(mkbwHttpHint(res.status, res.headers.get("retry-after")));
  const data = (await res.json())?.data || {};
  const remaining = Number(data.total_credits) - Number(data.total_usage);
  if (!Number.isFinite(remaining)) return "응답 해석 실패";
  return `$${remaining.toFixed(2)}`;
}

// --- UI ---

marinara.addStyle(`
  .mkbw-button {
    position: fixed;
    left: max(16px, env(safe-area-inset-left));
    bottom: calc(96px + env(safe-area-inset-bottom));
    z-index: 9997;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    border: 1px solid var(--border);
    border-radius: 9999px;
    background: var(--card);
    color: var(--card-foreground);
    box-shadow: 0 4px 14px color-mix(in srgb, var(--background) 55%, transparent);
    cursor: grab;
    font: inherit;
    font-size: 19px;
    touch-action: none;
    user-select: none;
  }
  .mkbw-button[data-dragging="true"] { cursor: grabbing; opacity: 0.85; }
  .mkbw-panel[hidden] { display: none; }
  .mkbw-panel {
    position: fixed;
    z-index: 9998;
    width: min(320px, calc(100vw - 24px));
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--card);
    color: var(--card-foreground);
    box-shadow: 0 12px 36px color-mix(in srgb, var(--background) 60%, transparent);
    font-family: inherit;
    font-size: 0.8125rem;
  }
  .mkbw-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    font-weight: 700;
  }
  .mkbw-panel__actions { display: flex; gap: 4px; }
  .mkbw-icon-btn {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--muted-foreground);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
  }
  .mkbw-icon-btn:hover { border-color: var(--border); background: var(--muted); color: var(--foreground); }
  .mkbw-rows { display: grid; gap: 2px; padding: 8px 12px; }
  .mkbw-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-height: 26px; }
  .mkbw-row__name { color: var(--muted-foreground); flex: 0 0 auto; }
  .mkbw-row__value { text-align: right; font-variant-numeric: tabular-nums; }
  .mkbw-row__value[data-kind="error"] { color: var(--destructive); }
  .mkbw-row__value[data-kind="muted"] { color: var(--muted-foreground); }
  .mkbw-footer {
    padding: 6px 12px 10px;
    color: var(--muted-foreground);
    font-size: 0.6875rem;
  }
  .mkbw-settings { display: grid; gap: 8px; padding: 10px 12px 12px; border-top: 1px solid var(--border); }
  .mkbw-settings[hidden] { display: none; }
  .mkbw-field { display: grid; gap: 3px; color: var(--muted-foreground); font-size: 0.6875rem; font-weight: 600; }
  .mkbw-field input {
    width: 100%;
    box-sizing: border-box;
    min-height: 32px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--background);
    color: var(--foreground);
    padding: 5px 8px;
    font: inherit;
    font-size: 0.75rem;
  }
  .mkbw-save {
    min-height: 32px;
    border: 1px solid var(--primary);
    border-radius: 6px;
    background: var(--primary);
    color: var(--primary-foreground);
    cursor: pointer;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 700;
  }
  .mkbw-save:disabled { cursor: wait; opacity: 0.6; }
  .mkbw-status { min-height: 14px; font-size: 0.6875rem; color: var(--muted-foreground); }
  .mkbw-status[data-kind="error"] { color: var(--destructive); }
`);

const mkbwButton = marinara.addElement(document.body, "button", {
  type: "button",
  class: "mkbw-button",
  title: "API 잔액 — 드래그로 이동",
  "aria-label": "API 잔액 위젯",
  textContent: "💰",
});

const mkbwPanel = marinara.addElement(document.body, "div", {
  class: "mkbw-panel",
  hidden: "",
  role: "dialog",
  "aria-label": "API 잔액",
  innerHTML: `
    <div class="mkbw-panel__header">
      <span>API 잔액</span>
      <span class="mkbw-panel__actions">
        <button type="button" class="mkbw-icon-btn" data-mkbw-refresh title="새로고침">↻</button>
        <button type="button" class="mkbw-icon-btn" data-mkbw-settings title="설정">⚙</button>
        <button type="button" class="mkbw-icon-btn" data-mkbw-close title="닫기">×</button>
      </span>
    </div>
    <div class="mkbw-rows">
      <div class="mkbw-row"><span class="mkbw-row__name">DeepSeek</span><span class="mkbw-row__value" data-mkbw-row="deepseek">—</span></div>
      <div class="mkbw-row"><span class="mkbw-row__name">OpenRouter</span><span class="mkbw-row__value" data-mkbw-row="openrouter">—</span></div>
    </div>
    <div class="mkbw-footer" data-mkbw-footer></div>
    <form class="mkbw-settings" data-mkbw-form hidden>
      <label class="mkbw-field">DeepSeek API 키
        <input type="password" name="deepseekKey" autocomplete="off" placeholder="sk-…">
      </label>
      <label class="mkbw-field">OpenRouter API 키
        <input type="password" name="openrouterKey" autocomplete="off" placeholder="sk-or-…">
      </label>
      <span class="mkbw-status" data-mkbw-status role="status" aria-live="polite"></span>
      <button type="submit" class="mkbw-save">저장</button>
    </form>
  `,
});

if (!mkbwButton || !mkbwPanel) {
  throw new Error("API 잔액 위젯 UI를 만들 수 없습니다.");
}

const mkbwForm = mkbwPanel.querySelector("[data-mkbw-form]");
const mkbwFooter = mkbwPanel.querySelector("[data-mkbw-footer]");
const mkbwStatus = mkbwPanel.querySelector("[data-mkbw-status]");

function mkbwSetRow(name, text, kind) {
  if (mkbwLifecycle.disposed) return;
  const el = mkbwPanel.querySelector(`[data-mkbw-row="${name}"]`);
  if (!el) return;
  el.textContent = text;
  if (kind) el.dataset.kind = kind;
  else delete el.dataset.kind;
}

function mkbwFormatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

async function mkbwRefresh(force) {
  if (mkbwLifecycle.disposed) return;
  const now = Date.now();
  const throttled = !force && now - mkbwLastFetch < MKBW_FETCH_THROTTLE_MS;

  try {
    await mkbwLoadConfig();
  } catch (error) {
    if (!mkbwLifecycle.disposed) {
      mkbwFooter.textContent = error instanceof Error ? error.message : "설정을 불러오지 못했습니다";
    }
  }

  // 제공자별 독립·병렬 조회 (한 곳의 지연이 다른 곳을 막지 않음 — Codex 권고)
  const jobs = [
    ["deepseek", mkbwFetchDeepseek, mkbwConfig.deepseekKey],
    ["openrouter", mkbwFetchOpenrouter, mkbwConfig.openrouterKey],
  ].map(async ([name, fetcher, key]) => {
    if (!key) return mkbwSetRow(name, "키 미설정", "muted");
    if (throttled && mkbwCache[name]) {
      return mkbwSetRow(name, mkbwCache[name].text, mkbwCache[name].kind);
    }
    mkbwSetRow(name, "조회 중…", "muted");
    try {
      const text = await fetcher(key);
      if (mkbwLifecycle.disposed) return;
      mkbwCache[name] = { text, kind: undefined };
      mkbwSetRow(name, text);
    } catch (error) {
      if (mkbwLifecycle.disposed) return;
      const text = error instanceof Error ? error.message : "조회 실패";
      mkbwCache[name] = { text, kind: "error" };
      mkbwSetRow(name, text, "error");
    }
  });
  await Promise.all(jobs);
  if (mkbwLifecycle.disposed) return;
  if (!throttled) mkbwLastFetch = now;
  mkbwFooter.textContent = `갱신: ${mkbwFormatTime(new Date(mkbwLastFetch || now).toISOString())}`;
}

// --- 패널 열기/닫기 + 위치 ---

function mkbwPlacePanel() {
  const rect = mkbwButton.getBoundingClientRect();
  const panelWidth = Math.min(320, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left), window.innerWidth - panelWidth - 12);
  mkbwPanel.style.left = `${left}px`;
  const spaceAbove = rect.top;
  if (spaceAbove > window.innerHeight - rect.bottom) {
    mkbwPanel.style.top = "auto";
    mkbwPanel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  } else {
    mkbwPanel.style.bottom = "auto";
    mkbwPanel.style.top = `${rect.bottom + 8}px`;
  }
}

function mkbwOpenPanel() {
  mkbwPlacePanel();
  mkbwPanel.hidden = false;
  void mkbwRefresh(false);
}

// 폼 위생: 입력값(키)을 DOM에 남기지 않는다 (Codex 권고)
function mkbwClearFormInputs() {
  for (const key of ["deepseekKey", "openrouterKey"]) {
    const el = mkbwForm.elements.namedItem(key);
    if (el) el.value = "";
  }
}

function mkbwClosePanel() {
  mkbwPanel.hidden = true;
  mkbwForm.hidden = true;
  mkbwClearFormInputs();
}

marinara.on(mkbwPanel.querySelector("[data-mkbw-close]"), "click", mkbwClosePanel);
marinara.on(mkbwPanel.querySelector("[data-mkbw-refresh]"), "click", () => void mkbwRefresh(true));
marinara.on(mkbwPanel.querySelector("[data-mkbw-settings]"), "click", () => {
  mkbwForm.hidden = !mkbwForm.hidden;
  if (!mkbwForm.hidden) {
    // 저장된 키를 DOM에 복원하지 않는다. 이미 저장된 항목은 placeholder로
    // "저장됨"을 알리고, 빈 채로 두면 기존 값 유지, 새로 입력하면 교체된다.
    for (const key of ["deepseekKey", "openrouterKey"]) {
      const el = mkbwForm.elements.namedItem(key);
      if (!el) continue;
      el.value = "";
      el.placeholder = mkbwConfig[key] ? "저장됨 — 바꾸려면 새 키 입력" : key === "deepseekKey" ? "sk-…" : "sk-or-…";
    }
  } else {
    mkbwClearFormInputs();
  }
});
marinara.on(document, "keydown", (event) => {
  if (!mkbwPanel.hidden && event.key === "Escape") mkbwClosePanel();
});

marinara.on(mkbwForm, "submit", async (event) => {
  event.preventDefault();
  // 빈 입력 = 기존 키 유지 (폼에 저장된 키를 복원하지 않으므로)
  const patch = {};
  for (const key of ["deepseekKey", "openrouterKey"]) {
    const typed = mkbwForm.elements.namedItem(key).value.trim();
    patch[key] = typed || mkbwConfig[key] || "";
  }
  const saveButton = mkbwForm.querySelector(".mkbw-save");
  saveButton.disabled = true;
  mkbwStatus.textContent = "저장 중…";
  mkbwStatus.dataset.kind = "";
  try {
    await mkbwSaveConfig(patch);
    if (mkbwLifecycle.disposed) return;
    Object.assign(mkbwConfig, patch);
    mkbwCache = { deepseek: null, openrouter: null };
    mkbwClearFormInputs();
    mkbwStatus.textContent = "저장했습니다.";
    void mkbwRefresh(true);
  } catch (error) {
    if (!mkbwLifecycle.disposed) {
      mkbwStatus.textContent = error instanceof Error ? error.message : "저장 실패";
      mkbwStatus.dataset.kind = "error";
    }
  } finally {
    saveButton.disabled = false;
  }
});

// --- 버튼 드래그 (위치는 localStorage에 뷰포트 % 저장) ---

function mkbwApplyPos() {
  try {
    const saved = JSON.parse(localStorage.getItem(MKBW_POS_KEY) || "null");
    if (!saved) return;
    const maxX = Math.max(0, window.innerWidth - mkbwButton.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - mkbwButton.offsetHeight);
    mkbwButton.style.left = `${Math.min(maxX, Math.max(0, (saved.x / 100) * window.innerWidth))}px`;
    mkbwButton.style.top = `${Math.min(maxY, Math.max(0, (saved.y / 100) * window.innerHeight))}px`;
    mkbwButton.style.right = "auto";
    mkbwButton.style.bottom = "auto";
  } catch {
    // 위치 복원 실패는 무시하고 기본 위치를 쓴다.
  }
}

let mkbwDrag = null;
marinara.on(mkbwButton, "pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") return;
  const rect = mkbwButton.getBoundingClientRect();
  mkbwDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    moved: false,
  };
  try {
    mkbwButton.setPointerCapture(event.pointerId);
  } catch {
    // 캡처 실패해도 버튼 위에서는 드래그가 동작한다.
  }
});
marinara.on(mkbwButton, "pointermove", (event) => {
  if (!mkbwDrag || event.pointerId !== mkbwDrag.pointerId) return;
  if (!mkbwDrag.moved) {
    if (Math.hypot(event.clientX - mkbwDrag.startX, event.clientY - mkbwDrag.startY) < 6) return;
    mkbwDrag.moved = true;
    mkbwButton.dataset.dragging = "true";
  }
  const maxX = Math.max(0, window.innerWidth - mkbwButton.offsetWidth);
  const maxY = Math.max(0, window.innerHeight - mkbwButton.offsetHeight);
  mkbwButton.style.left = `${Math.min(maxX, Math.max(0, event.clientX - mkbwDrag.offsetX))}px`;
  mkbwButton.style.top = `${Math.min(maxY, Math.max(0, event.clientY - mkbwDrag.offsetY))}px`;
  mkbwButton.style.right = "auto";
  mkbwButton.style.bottom = "auto";
});
function mkbwEndDrag(event) {
  if (!mkbwDrag || event.pointerId !== mkbwDrag.pointerId) return;
  const drag = mkbwDrag;
  mkbwDrag = null;
  delete mkbwButton.dataset.dragging;
  try {
    mkbwButton.releasePointerCapture(event.pointerId);
  } catch {
    // 이미 해제된 경우 무시.
  }
  if (!drag.moved) {
    if (mkbwPanel.hidden) mkbwOpenPanel();
    else mkbwClosePanel();
    return;
  }
  const rect = mkbwButton.getBoundingClientRect();
  try {
    localStorage.setItem(
      MKBW_POS_KEY,
      JSON.stringify({
        x: window.innerWidth ? (rect.left / window.innerWidth) * 100 : 0,
        y: window.innerHeight ? (rect.top / window.innerHeight) * 100 : 0,
      }),
    );
  } catch {
    // 저장 실패해도 화면상 위치는 이미 반영됐다.
  }
  if (!mkbwPanel.hidden) mkbwPlacePanel();
}
marinara.on(mkbwButton, "pointerup", mkbwEndDrag);
marinara.on(mkbwButton, "pointercancel", mkbwEndDrag);
marinara.on(window, "resize", () => {
  mkbwApplyPos();
  if (!mkbwPanel.hidden) mkbwPlacePanel();
});

mkbwApplyPos();
void mkbwLoadConfig().catch(() => {
  // 초기 로드 실패는 패널을 열 때 다시 시도한다.
});
