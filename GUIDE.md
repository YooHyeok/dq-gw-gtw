# 그룹웨어 자동 출근 (Playwright + GitHub Actions)

로그인 → 출근 버튼 클릭 → 확인 모달 '확인' 클릭 순서로 자동 출근을 처리한다.
(사내 그룹웨어 웹 출근 기준)

---

## Fork 해서 사용하는 방법

이 저장소를 fork 해서 **본인 계정으로 자동 출근**을 돌리는 방법.

### 1. Fork 뜨기

우측 상단 **Fork** 버튼 → 본인 계정으로 fork.

### 2. ⚠️ Actions 활성화 (제일 중요 — 빠뜨리면 안 돎)

fork 한 저장소는 **Actions 가 꺼진 상태**로 시작한다.

- fork 한 레포의 **Actions 탭** 클릭
- **"I understand my workflows, go ahead and enable them"** 버튼 클릭

이걸 안 하면 스케줄이 절대 실행되지 않는다.

### 3. Secrets 3개 등록

**Settings → Secrets and variables → Actions → New repository secret** 에서 각각 등록:

| Name | 값(Secret) |
|------|-----------|
| `GW_URL` | 그룹웨어 **로그인 페이지 URL** (예: `https://<그룹웨어주소>/...`) |
| `GW_ID` | 본인 아이디 |
| `GW_PW` | 본인 비밀번호 |

> 시크릿은 fork 에 복사되지 않으므로 반드시 본인 것을 새로 넣어야 한다.
> 아이디/비번은 암호화 저장되어 코드·로그에 노출되지 않는다.

### 4. (선택) 출근 시각 조정

기본값은 **평일 KST 07:00 기상 → 07:30~07:55 사이 랜덤 출근**.

- **시(hour)를 바꾸려면**: [.github/workflows/attendance.yml](.github/workflows/attendance.yml) 의 `cron` 수정
  - cron 은 **UTC 기준**. `KST = UTC + 9`.
  - 예) 현재 `'0 21 * * 0-4'` = KST 06:00, 평일(월~금).
  - 아침 시간대는 UTC 로 전날이 되어 요일이 하루 밀린다 (월~금 → `0-4`).
- **분 범위(창)만 바꾸려면**: 코드 수정 없이 **Variables** 로
  - **Settings → Secrets and variables → Actions → Variables 탭**
  - `GW_WINDOW_START` (예: `07:30`), `GW_WINDOW_END` (예: `07:55`)

### 5. 테스트 (dry-run)

실제 출근을 찍지 않고 로그인·버튼 탐색만 확인:

1. **Actions → "그자출" → Run workflow**
2. **`dry_run` 체크** 후 실행
3. 로그에서 로그인 성공 / 버튼 탐색 결과 확인
   - 이미 출근한 날이면 버튼이 사라져 `#inBtn 없음` 이 뜨는 게 정상.

---

## 동작 요약

| 워크플로우 | 역할 | 주기 |
|-----------|------|------|
| **그자출** (`attendance.yml`) | 로그인 → 출근 버튼 → 확인 모달 → API 성공 확인 | 평일 아침 자동 |
| **keepalive** (`keepalive.yml`) | 빈 커밋으로 스케줄 유지 | 매월 1일 |

- **keepalive** 는 GitHub 이 *60일간 커밋이 없으면 스케줄 워크플로우를 자동 비활성화* 하는 것을 막아준다. (추가 설정 불필요)
- 이미 출근한 상태면 버튼이 사라지므로 스크립트는 **처리 없이 안전 종료** 한다 (중복 출근 안 됨).

## 셀렉터 / 플로우

| 용도 | 셀렉터 / 방식 |
|------|--------------|
| 아이디 입력 | `#userId` |
| 패스워드 입력 | `#userPw` |
| 로그인 실행 | `#userPw` 에서 Enter (`actionLogin()`) |
| 출근 버튼 | `#inBtn` (`onclick="fnAttendCheck(1,0)"`, 모든 프레임 탐색) |
| 확인 모달 '확인' | `#btnConfirm` (HTML 모달, 모든 프레임 탐색) |
| 성공 판정 | `insertComeLeaveEventApi.do` 응답 `resultCode === "SUCCESS"` |

## 로컬 실행 (테스트용)

```powershell
npm install
npx playwright install chromium

# 창을 띄워 눈으로 확인 (PowerShell)
$env:GW_URL="..."; $env:GW_ID="..."; $env:GW_PW="..."; $env:HEADFUL="1"; node attend.js
```

## 주의사항

- **동일한 그룹웨어 시스템 전용**. URL·셀렉터가 다른 시스템에는 동작하지 않는다.
- GitHub Actions 스케줄은 **정시를 보장하지 않는다** (수 분~수십 분 지연 가능). 분 단위로 빡빡한 마감에는 부적합할 수 있다.
- 사내망 전용 그룹웨어라면 GitHub 클라우드에서 접속이 막힐 수 있다. (본 저장소는 외부 접속 가능 환경 기준)
