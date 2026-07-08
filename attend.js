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
      console.log(`[출결] dry-run: 출근 버튼(${buttonSelector}) 클릭 생략`);
      const exists = (await page.locator(buttonSelector).count()) > 0;
      console.log(`[출결] dry-run: 버튼 존재 여부 = ${exists}`);
      console.log('[출결] 완료 ✅');
      return;
    }

    // 출근 버튼 클릭 → HTML 확인 모달(.PUDD-UI-Dialog) 표시
    await page.click(buttonSelector);
    console.log('[출결] 출근 버튼 클릭');

    // 3. 확인 모달의 '확인' 버튼(#btnConfirm) 클릭과 동시에
    //    출결 등록 API 응답(insertComeLeaveEventApi.do) 대기
    const confirm = page.locator('#btnConfirm');
    await confirm.waitFor({ state: 'visible', timeout: 10000 });

    const [response] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('insertComeLeaveEventApi.do'),
        { timeout: 15000 },
      ),
      confirm.click(),
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
