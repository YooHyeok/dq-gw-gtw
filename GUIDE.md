# 그룹웨어 자동 출결 (Playwright + GitHub Actions)

로그인 → 출근 버튼 클릭 → 확인 모달 자동 수락 순서로 출결을 체크한다.

## 동작 순서

1. 로그인 (아이디 입력 → 패스워드 입력 → 로그인 버튼)
2. 출근 버튼 클릭
3. 출석 확인 얼럿/모달 자동 수락 (`page.on('dialog')`)

## 로컬 실행

```bash
cd groupware-attendance
npm install
npx playwright install chromium

# .env.example 복사 후 값 채우기
cp .env.example .env

# 창을 띄워 눈으로 확인 (환경변수 직접 주입 예시 - PowerShell)
$env:GW_URL="..."; $env:GW_ID="..."; $env:GW_PW="..."; $env:HEADFUL="1"; node attend.js
```

## GitHub Actions 스케줄 실행

1. 레포 **Settings → Secrets and variables → Actions** 에 아래 시크릿 등록
   - `GW_URL`
   - `GW_ID`
   - `GW_PW`
2. `.github/workflows/attendance.yml` 이 평일(월~금) **KST 09:00**(UTC 00:00)에 자동 실행
3. Actions 탭에서 `workflow_dispatch` 로 수동 테스트 가능

> ⚠️ GitHub Actions 의 `schedule` 은 정시보다 수 분~수십 분 지연될 수 있음. 정확한 시각이 중요하면 여유를 두거나 별도 스케줄러 고려.

## 셀렉터 / 플로우 (gw.diquest.com 기준)

| 용도 | 셀렉터 / 방식 | 상태 |
|------|--------------|------|
| 아이디 입력 | `#userId` | 확정 |
| 패스워드 입력 | `#userPw` | 확정 |
| 로그인 실행 | `#userPw` 에서 Enter (`actionLogin()`) | 확정 |
| 출근 버튼 | `#inBtn` (`onclick="fnAttendCheck(1,0)"`) | 확정 |
| 확인 모달 '확인' | `#btnConfirm` | 확정 |
| 성공 판정 | `insertComeLeaveEventApi.do` 응답 `resultCode === "SUCCESS"` | 확정 |
| 퇴근 버튼 | `#outBtn` (미확인 placeholder) | ⚠️ 교체 필요 |
