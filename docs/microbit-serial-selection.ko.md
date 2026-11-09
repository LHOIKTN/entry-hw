# Windows microbit USB 시리얼 선택

## 분석 및 변경 범위

기존 흐름은 `serial/scanner.ts`의 SerialPort.list() → `SelectPortContainer.tsx`에서 path 선택 → router.selectedPort → electPort → SerialConnector.open/initialize → microbit2.js 핸드셰이크이다. 기존 microbit2.js의 localdata, CRLF, 큐 처리와 115200 baud 설정, 커스텀 펌웨어 설정은 수정하지 않았다. 작업 시작 시 entry-hw git 상태는 깨끗했으며, 이미 저장되어 있던 사용자 변경은 유지했다.

- `app/src/main/core/serial/microbitDevices.ts`: PowerShell PnP 조회, 시리얼 파싱·중복 제거, 표시 이름, 일반 USB 부모 관계에 따른 보수적 매핑.
- `app/src/main/core/serial/scanner.ts`: Windows microbit2.js에만 적용. router에는 `microbit:전체시리얼`을 보관하고 연결 시마다 최신 포트와 PnP 정보를 조회한다. 장치가 하나여도 명시적으로 선택한다. 리디렉션/모호한 매핑/조회 실패 시 기존 자동 포트 선출로 우회하지 않는다.
- `app/src/renderer/react/main/components/hardwareConnection/SelectPortContainer.tsx`: 시리얼 이름 표시, 전체 시리얼 툴팁, 연결 불가 사유, 연결 차단, 사라진 선택값 초기화. COM 경로는 마이크로비트 목록 및 툴팁에 표시하지 않는다.
- `types/index.d.ts`: 선택 항목의 표시 이름 및 연결 불가 사유 필드 추가.
- `cli/microbitDevicesTest.js`: 하드웨어 없이 실행하는 회귀/안전성 테스트.

## 조회와 연결 정책

Windows PowerShell의 Get-PnpDevice -PresentOnly로 현재 존재하는 USB 및 TS_USB의 VID_0D28/PID_0204 루트 장치를 조회한다. Win32_DiskDrive는 사용하지 않는다. 출력은 UTF-8 JSON이며 호출 제한은 12초, 4 MiB이다. 프로필이나 실행 정책을 변경하지 않는다. PnpDevice 명령이 없거나 정책으로 차단되면 오류를 표시하며 자동 재시도한다.

전체 인스턴스 ID의 마지막 요소가 8~128자리 16진수인 경우에만 시리얼로 인정한다. TS_USB의 TS_ 접두사는 제거하고 대문자로 정규화한다. 990636이나 48자리 길이에만 한정하지 않으며, Windows 위치 기반 `&` 포함 ID를 고유 시리얼로 오인하지 않는다. 그 밖의 형식은 추측해서 추출하지 않는다. 지원 범위를 벗어나는 시리얼 형식은 실물 확인 후 추가해야 한다.

48자리 시리얼은 사용자 제공 규칙인 0-based offset 24의 8자리를 표시한다. 다른 길이는 끝 8자리를 표시한다. 이는 UI 축약 규칙이며 보드 전체 버전에 공통된 공식 식별 규칙이라고 가정하지 않는다. 축약 충돌 시 해당 항목들에 전체 시리얼을 표시한다.

일반 USB는 serialport의 pnpId와 PnP Ports 장치의 InstanceId를 정확히 대조하고, DEVPKEY_Device_Parent를 최대 16단계 추적하여 유일한 전체 시리얼과 유일한 포트를 확인할 때만 기존 연결기로 전달한다. 열거 순서, COM 번호, 이름, 세션 번호, VID/PID만으로 매핑하지 않는다. 같은 시리얼에 TS_USB 항목이 함께 있거나 부모 경로가 TS_USB 계열이면 보수적으로 차단한다. 중복 시리얼이 실제 복제 장치에서 발생한다면 지원하지 않는다.

TS_USB 시리얼은 목록에 표시하지만 COM 연결은 차단한다. 관리자에게 리디렉션 장치의 실제 포트와 물리 장치 관계를 검증하도록 안내한다. 단순히 연결 장치 수를 하나로 줄였다는 이유로 매핑하지 않는다. 대안은 일반 USB 직접 연결 환경을 사용하거나, 현장에서 신뢰할 수 있는 연결 속성을 확인한 뒤 별도 매핑을 구현하는 것이다.

검색 중에는 조회 완료 후 기존 1.5초 간격으로 목록이 갱신된다. 연결에 성공하면 기존 동작처럼 검색을 멈춘다. 연결 해제 후 재검색에서는 전체 시리얼로 새 COM 경로를 찾는다. 포트를 열기 직전의 Windows 장치 교체와 같은 OS 수준 경합까지 원자적으로 막는 기능은 없으며, 하드웨어/세션 환경 검증이 필요하다.

## 자동 검증

저장소 루트에서 실행:

```sh
node cli/microbitDevicesTest.js
npx tsc --noEmit --pretty false
```

자동 테스트 통과: 제공된 두 시리얼 표시, 중복/대소문자 정규화, 축약 충돌, 다른 길이, 위치 ID 배제, COM 번호 변경 시 식별 유지, 다중 포트/매핑 누락/리디렉션 차단, 실제 scanner 분기의 연결 차단, 조회 실패, macOS 및 다른 하드웨어의 기존 경로.

ESLint 검사: 오류 0개(스타일 경고 있음). 전체 TypeScript 검사는 현재 설치된 TypeScript 3.9.5가 node_modules/@types/lodash의 template literal type 구문을 해석하지 못해 실패한다. 이번 변경과 별개인 의존성 문제이며 패키지/잠금파일은 변경하지 않았다. 자동 테스트는 TS transpileModule 및 모의 PnP/serialport를 사용하므로 전체 타입 검사나 실제 Windows 검증을 대체하지 않는다.

## Windows / MultiPoint 현장 검증 (미실행)

1. 학생 세션에서 `Get-Command Get-PnpDevice, Get-PnpDeviceProperty`로 명령 지원을 확인한다. 앱을 실행하는 동일 사용자 권한에서 확인한다.
2. 일반 USB 두 대를 연결하고 마이크로비트를 선택한다. `microbit (953428F0)`, `microbit (E5DC3934)` 두 항목과 전체 시리얼 툴팁을 확인한다. 다른 USB 장치는 나타나지 않아야 한다.
3. 각 장치를 선택해 LED 출력 등 눈으로 구분할 수 있는 명령을 실행한다. 선택하지 않은 보드에 명령이 전달되지 않아야 한다. 기존 센서 읽기, 명령 큐, reset 및 재연결도 확인한다.
4. 선택창에서 한 대를 분리/연결하여 목록 갱신을 확인한다. 모두 분리하면 장치 없음 안내가 나타나고 연결할 수 없어야 한다.
5. 재연결 또는 USB 단자 변경으로 COM 번호를 바꾸고 동일 시리얼 이름 유지 및 올바른 대상 재연결을 확인한다.
6. 일반 USB + TS_USB, TS_USB 두 대를 각각 시험한다. 전체 시리얼 기준으로 중복 없이 표시되며 TS_USB 항목은 사유 표시와 함께 연결이 차단되어야 한다. 더블클릭으로도 차단되어야 한다.
7. 조회 권한/명령 실패 시 오류 안내를 확인한다. 이전 목록이나 임의 포트로 연결하면 안 된다. 검색 취소/다른 하드웨어 선택 시 늦게 끝난 조회가 선택창을 다시 열지 않아야 한다.
8. V1/V2 및 실제 배포 DAPLink 버전별로 전체 ID 형식과 표시를 기록한다. 다른 길이/형식은 실물 확인 전 범용 지원 완료로 판단하지 않는다.

현재 macOS 개발 환경에서 실제 Windows PnP 실행, MultiPoint 세션 가시성, USB 두 대 선택/통신, 펌웨어 쓰기는 검증하지 못했다. 따라서 현장 완료 조건 전체가 달성되었다고 간주하지 않는다. 기존 펌웨어 복사 대상 선택은 이번 시리얼 기반 통신 선택의 적용 대상이 아니다.

## 참고한 공식 문서

- https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdevice : PresentOnly 조회
- https://learn.microsoft.com/en-us/windows-hardware/drivers/install/devpkey-device-parent : 실제 부모 인스턴스 ID
- https://support.microbit.org/support/solutions/articles/19000035697-what-are-the-usb-vid-pid-numbers-for-micro-bit : micro:bit VID/PID 및 DAPLink 시리얼


## 오프라인 통합 보완

오프라인 앱에서 연결 코드뿐 아니라 선택 UI와 preload도 함께 동기화하도록 수정했다.
`webpack/webpack.beomeo.config.js`가 세 번들을 생성하고 entry-offline의 sync/check 스크립트가 복사 및 일치 여부를 확인한다.
macOS도 시리얼 선택을 지원하도록 보완했다. 실제 연결된 828EF1B5 장치에서 serialport가 반환한 VID/PID, 전체 시리얼, 장치 경로의 동일 레코드를 확인했다. 여러 경로에 동일 시리얼이 있으면 차단한다.
macOS UI/통신 검증은 완료하지 않았으며 사용자 요청에 따라 Windows 오프라인 설치 파일 검증으로 전환했다.
