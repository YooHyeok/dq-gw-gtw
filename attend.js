import { chromium } from 'playwright';

/**
 * 필수 환경변수를 읽어 반환한다. 누락 시 즉시 종료한다.
 *
 * @returns {{ url: string, id: string, pw: string }}
 */
function loadConfig() {
  const url = process.env.GW_URL;
  const id = process.env.GW_ID;
  const pw = process.env.GW_PW;

  const missing = [];
  if (!url) missing.push('GW_URL');
  if (!id) missing.push('GW_ID');
  if (!pw) missing.push('GW_PW');

  if (missing.length > 0) {
    console.error(`[출결] 환경변수 누락: ${missing.join(', ')}`);
    process.exit(1);
  }

  return { url, id, pw };
}

/**
 * 로그인된 세션으로 연차 이력 API를 호출해 오늘이 연차/휴가 기간인지 확인한다.
 * GW_EMP_SEQ 가 없으면 확인을 생략(false)한다.
 *
 * @param {import('playwright').BrowserContext} context - 로그인된 컨텍스트
 * @param {string} baseUrl - 그룹웨어 오리진 (예: https://<그룹웨어주소>)
 * @returns {Promise<boolean>} 오늘이 연차면 true
 */
async function isOnLeaveToday(context, baseUrl) {
  const empSeq = process.env.GW_EMP_SEQ;
  if (!empSeq) return false; // 미설정 시 연차 체크 생략

  // KST 기준 오늘 날짜 (en-CA 로케일 = YYYY-MM-DD)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const year = today.slice(0, 4);

  const res = await context.request.post(
    `${baseUrl}/owattend/rest/vacation/hist/list/get`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: {
        page: 1,
        pageSize: 100, // 기본 5는 누락 위험 → 넉넉히
        sortField: '',
        sortType: '',
        empSeq: String(empSeq),
        rversYear: year,
        docSt: 'ALL',
        yrycStautsYn: 'Y',
      },
    },
  );

  if (!res.ok()) {
    console.warn(`[출결] 연차 조회 실패(HTTP ${res.status()}) → 연차 체크 생략하고 진행`);
    return false;
  }

  const json = await res.json().catch(() => null);
  const list = (json && json.data) || [];

  // 삭제되지 않은(delYn=N) 연차 중 오늘이 기간(beginDd~endDd)에 포함되는 것
  const hit = list.find(
    (v) => v.delYn === 'N' && v.beginDd <= today && today <= v.endDd,
  );
  if (hit) {
    console.log(
      `[출결] 오늘(${today})은 ${hit.dclzSeNm} (${hit.beginDd}~${hit.endDd}, docSt=${hit.docSt}) → 출근 스킵`,
    );
    return true;
  }
  return false;
}

/**
 * 그룹웨어에 로그인한 뒤 출근 버튼을 눌러 출결을 체크한다.
 *
 * @returns {Promise<void>}
 */
async function run() {
  const { url, id, pw } = loadConfig();

  // GitHub Actions(CI)에서는 headless, 로컬 디버깅 시 HEADFUL=1 로 창 띄우기
  const headless = process.env.HEADFUL !== '1';
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  // 혹시 네이티브 alert/confirm 이 뜨는 경우를 대비한 폴백 (실제 확인은 HTML 모달)
  page.on('dialog', async (dialog) => {
    console.log(`[출결] 네이티브 모달(${dialog.type()}): ${dialog.message()}`);
    await dialog.accept();
  });

  try {
    // 1. 로그인 (Enter 키로 actionLogin() 트리거)
    console.log('[출결] 로그인 페이지 접속:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    await page.fill('#userId', id);   // 아이디 입력 (name="id")
    await page.fill('#userPw', pw);   // 패스워드 입력 (name="password")
    await page.press('#userPw', 'Enter'); // onkeydown Enter → actionLogin()

    // 로그인 완료 대기 (메인/대시보드 로딩 기준)
    await page.waitForLoadState('networkidle');
    console.log('[출결] 로그인 완료');

    // 2. 출근 버튼: #inBtn (onclick="fnAttendCheck(1,0)")
    const dryRun = process.env.GW_DRY_RUN === 'true';
    const buttonSelector = '#inBtn';

    if (dryRun) {
      console.log('[출결] dry-run 진단 시작');
      console.log('[출결] 현재 URL:', page.url());

      // 연차 API 동작 확인 (dry-run 에서는 스킵하지 않고 결과만 출력)
      const onLeave = await isOnLeaveToday(context, new URL(url).origin);
      console.log(`[출결] 오늘 연차 여부: ${onLeave}`);

      // 모든 프레임(iframe 포함)에서 #inBtn 검색
      const frames = page.frames();
      console.log(`[출결] 프레임 개수: ${frames.length}`);
      for (const f of frames) {
        const cnt = await f.locator(buttonSelector).count().catch(() => 0);
        console.log(`  - frame(${f.url() || 'about:blank'}) → #inBtn ${cnt}개`);
      }

      const mainExists = (await page.locator(buttonSelector).count()) > 0;
      console.log(`[출결] (메인 프레임) #inBtn 존재: ${mainExists}`);

      // 로그인 직후 화면을 아티팩트로 확인 (이미 출근 상태인지/버튼 위치 파악용)
      await page.screenshot({ path: 'attendance-debug.png', fullPage: true }).catch(() => {});
      console.log('[출결] dry-run 완료 (attendance-debug.png 저장)');
      return;
    }

    // 2-1. 오늘 연차/휴가면 출근 스킵 (실제 실행에만 적용)
    if (await isOnLeaveToday(context, new URL(url).origin)) {
      return;
    }

    // 셀렉터를 모든 프레임(iframe 포함)에서 탐색해 해당 프레임을 반환
    async function findFrameWith(selector) {
      for (const f of page.frames()) {
        if (await f.locator(selector).count().catch(() => 0)) return f;
      }
      return null;
    }

    // 출근 버튼 탐색 (포틀릿 지연 로딩 대비 최대 ~5초 재시도)
    // 끝내 없으면 이미 출근했거나 버튼 미노출로 보고 안전 종료
    let btnFrame = null;
    for (let i = 0; i < 10 && !btnFrame; i++) {
      btnFrame = await findFrameWith(buttonSelector);
      if (!btnFrame) await page.waitForTimeout(500);
    }
    if (!btnFrame) {
      console.log('[출결] 출근 버튼(#inBtn) 없음 → 이미 출근했거나 미노출. 처리 없이 종료 ✅');
      return;
    }

    // 출근 버튼 클릭 → HTML 확인 모달(.PUDD-UI-Dialog) 표시
    await btnFrame.locator(buttonSelector).click();
    console.log('[출결] 출근 버튼 클릭');

    // 3. 확인 모달의 '확인' 버튼(#btnConfirm)을 프레임 무관하게 대기/탐색
    const confirmSelector = '#btnConfirm';
    let confirmFrame = null;
    for (let i = 0; i < 20 && !confirmFrame; i++) {
      confirmFrame = await findFrameWith(confirmSelector);
      if (!confirmFrame) await page.waitForTimeout(500);
    }
    if (!confirmFrame) {
      throw new Error('확인 모달(#btnConfirm)을 찾지 못함');
    }

    // 확인 클릭과 동시에 출결 등록 API 응답(insertComeLeaveEventApi.do) 대기
    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('insertComeLeaveEventApi.do'),
        { timeout: 15000 },
      ),
      confirmFrame.locator(confirmSelector).click(),
    ]);

    console.log(`[출결] 확인 클릭 → API 응답 ${response.status()}`);
    if (!response.ok()) {
      throw new Error(`출결 API 실패: HTTP ${response.status()}`);
    }

    // 응답 JSON 파싱: { result, resultCode, resultMessage }
    const body = await response.json().catch(() => null);
    if (body) {
      console.log(`[출결] 결과: ${body.resultCode} - ${body.resultMessage ?? ''}`);
      if (body.resultCode !== 'SUCCESS') {
        throw new Error(`출결 처리 실패: ${body.resultMessage ?? body.resultCode}`);
      }
    } else {
      console.warn('[출결] 응답 본문 파싱 실패 (HTTP 상태로만 성공 판단)');
    }

    console.log('[출결] 완료 ✅');
  } catch (err) {
    console.error('[출결] 실패 ❌', err);
    // CI에서 실패 원인 파악용 스크린샷
    await page.screenshot({ path: 'attendance-error.png', fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await run();
