# Windows microbit COM 선택 (beomeo.9)

Windows 연결 경로는 `SerialPort.list()`의 원래 COM `path`를 유지한다. beomeo.6부터 사용자가 제공한 학생 PC의 SESSION ID 문제를 해결하기 위해 Windows SetupAPI/Configuration Manager를 사용하는 읽기 전용 `app/native/MicrobitIdentity.exe`를 추가한다. PowerShell이나 Get-PnpDevice는 실행하지 않는다.

1. 현재 존재하는 장치만 열거한다. COM 항목의 `pnpId`와 네이티브 장치의 전체 InstanceId가 정확히 같은 노드에서 시작한다.
2. Windows가 제공하는 실제 부모 관계를 최대 32단계 추적하여 USB/TS_USB 보드 전체 시리얼을 찾는다.
3. COM 노드 자체뿐 아니라 실제 부모 중 micro:bit 복합 장치(`USB/TS_USB`, `VID_0D28&PID_0204`, 선택적인 `REV_xxxx`, 인터페이스 `MI_xx` 제외)의 유효한 ContainerID도 확인한다. 그 컨테이너와 정확히 같은 USB/TS_USB 보드 전체 시리얼을 찾는다. USB 허브나 세션 공용 열거자의 컨테이너로 형제 보드를 대응시키지 않는다.
4. 알려진 형식의 전체 시리얼이 유일하고 직접 조회 결과와 충돌하지 않을 때만 이름을 표시한다. 순서, SESSION 번호, 포트 수, COM 번호로 보드를 추측하지 않는다.
5. 시리얼을 확인하지 못하면 COM 이름을 유지한다. 정상 조회된 시리얼 외에 SESSION/위치 ID를 시리얼 툴팁에 넣지 않는다.

부모 관계를 조회하지 않던 beomeo.5와 달리, 이번 버전은 사용자의 최신 '실제 시리얼 추적' 요청에 따라 네이티브 API로 실제 관계를 확인한다. 학생 PC에서 실제 부모/컨테이너 관계가 어떻게 제공되는지는 설치 후 검증해야 한다.

Windows 시리얼은 사용자 지정 접두사 `990636020005282`로 시작하는 48자리 16진수 전체 값만 인정한다. 보유 장치 목록과 대조하지 않으므로 목록에 없는 보드도 같은 패턴이면 표시한다. offset 24의 8자리를 축약 표시하며, 축약 충돌은 전체 시리얼과 COM 경로로 구분한다. SESSIONID나 위치 ID를 잘라 시리얼로 만들지 않는다. 툴팁에도 검증된 시리얼만 전달한다. 시리얼이 없거나 확인할 수 없는 항목도 원래 COM 이름으로 표시하고 기존 연결 및 핸드셰이크를 허용한다. 목록의 모든 COM이 micro:bit임을 보장하는 것은 아니므로 실제 장치 확인은 기존 핸드셰이크가 담당한다.

연결 시 최신 COM 목록에 선택한 경로가 있는지 다시 검사한다. 사라진 COM은 연결기로 전달하지 않고 목록을 갱신한다. 목록 조회 직후 물리적 분리가 발생하는 경합은 기존 포트 열기 오류 처리에 따른다.

상세 로그: `%APPDATA%\entry-hw\logs\entry-hw-YYYY-MM-DD.log`. `microbit COM discovery`로 검색한다. COM 원본 속성, 네이티브 장치 관계 및 속성 조회 오류, 최종 표시 결과와 소요 시간을 기록한다. 네이티브 도구 실패는 `microbit COM identity failed`에 실행 경로, 오류 코드, stderr 및 스택을 기록한다. 도구 실행 제한은 초기 기동 지연을 고려해 15초다.

Windows 도구 빌드: `node cli/buildMicrobitIdentity.js` (.NET Framework 4 C# 컴파일러 사용, Electron ABI와 독립).

자동 검증: `node cli/microbitDevicesTest.js`, `node cli/windowsMicrobitIdentityTest.js`. 학생 PC의 실제 두 SESSION ID를 사용하는 테스트는 모의 부모/컨테이너 관계에 대한 검사이며 학생 PC의 실제 관계를 검증한 것은 아니다. 오프라인 통합은 하드웨어 main/preload/React 번들 및 EntryJS dist를 빌드한 후 `node scripts/sync-beomeo.js`, `node scripts/check-beomeo.js`로 검사한다.

설치 후 실물 검증:
1. 시리얼을 제공하는 두 보드의 축약 표시와 각각의 연결/통신 확인.
2. 시리얼 미제공 항목의 COM 표시와 직접 연결 확인.
3. 선택 중 USB 분리 시 목록에서 제거되고 해당 COM으로 연결하지 않는지 확인.
4. USB 재연결 후 최신 COM 선택 및 기존 펌웨어/센서/LED 통신 확인.
5. MultiPoint에서는 해당 세션의 SerialPort.list() 결과만 사용하며 누락된 장치 관계를 추측하지 않는지 확인.

macOS는 동일 serialport 레코드의 시리얼과 장치 경로를 사용하는 기존 동작을 유지한다. 실제 USB 통신과 물리적 분리/재연결은 실물 검증이 필요하다.

## 공식 API 참고

- [ContainerID의 장치 그룹 관계](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/devpkey-device-containerid)
- [현재 존재하는 장치의 SetupAPI 열거](https://learn.microsoft.com/en-us/windows/win32/api/setupapi/nf-setupapi-setupdigetclassdevsw)
- [실제 부모 장치 조회](https://learn.microsoft.com/en-us/windows/win32/api/cfgmgr32/nf-cfgmgr32-cm_get_parent)

## 학생 PC 진단

설치본의 `resources/app.asar.unpacked/node_modules/entry-hw/app/native/MicrobitIdentity.exe`를 같은 학생 계정에서 실행하면 읽기 전용 JSON 스냅샷을 얻을 수 있다. 전체 부모 ID/ContainerID 및 속성별 오류 코드를 포함하며 레지스트리나 장치 상태를 변경하지 않는다. 시리얼이 나오지 않는 경우 이 JSON과 `microbit COM discovery` 로그를 함께 확인한다. 도구 자체는 COM 포트를 열거나 데이터를 전송하지 않는다.

## beomeo.7에서 확인한 실제 회귀

학생 세션 15의 실제 자료에서 COM74 자체의 ContainerID는 `a01468d9-dc07-11f1-884b-c87f54683ed6`이지만, 바로 위 `USB\VID_0D28&PID_0204&REV_1000\...SESSION15...` 복합 장치의 ContainerID는 `c24bf16d-82d0-5ae2-83d4-d90aac06cbd9`이다. 이 값이 TS_USB 보드 전체 시리얼 `990636020005282045F0227BE5DC3934000000006E052820`의 ContainerID와 일치한다. 따라서 표시 결과는 `microbit (E5DC3934)`이며 연결 경로는 COM74 그대로다.

버전 6의 COM 자체 컨테이너만 비교하던 누락을 고쳤다. `cli/fixtures/microbit-session15.json`은 실제 자료에서 관련 노드만 남긴 회귀 자료이며 앱 실행 시 읽지 않는다. COM74/E5DC3934를 하드코딩하지 않는다. COM 번호를 COM900/COM901로 바꾸고 목록 순서를 뒤집은 테스트에서도 실제 관계로 같은 시리얼을 찾는지 확인한다.

이번 수정은 시리얼 표시만 대상으로 한다. B5E79A42 보드의 실행 실패 및 클라우드/서버 라우팅 동작은 별도 조사 대상으로 두고 변경하지 않았다.

## beomeo.9: 원본 장치가 현재 조회에서 숨겨진 학생 세션

세션 4의 COM37은 실제 micro:bit 복합 부모까지 조회되지만, 전체 시리얼을 가진 USB/TS_USB 원본 노드는 현재 장치 스냅샷에서 빠졌다. 사용자가 레지스트리를 조회한 결과, 실제 복합 부모의 ContainerID와 같은 원본 USB/TS_USB 키에 전체 시리얼이 남아 있음을 확인했다.

네이티브 도구가 HKLM의 `SYSTEM/CurrentControlSet/Enum/USB/VID_0D28&PID_0204` 및 `TS_USB/VID_0D28&PID_0204`를 읽기 전용으로 확인한다. 형식이 검증된 전체 시리얼 키 중, 현재 COM 또는 그 실제 micro:bit 복합 부모의 유효한 ContainerID와 일치하는 식별 정보만 `registryIdentities`로 보완한다. 레지스트리 기록은 현재 존재하는 장치 노드와 구분하며, 레지스트리만으로 COM 포트나 보드를 목록에 추가하지 않는다. USB/TS_USB 중복은 전체 시리얼 기준으로 합치고, 서로 다른 시리얼이 같은 컨테이너에 대응하면 이름을 붙이지 않는다.

`registryErrors`에 읽기 실패의 경로·오류 코드·메시지가 기록된다. 현재 COM과 실제 관계가 없거나 컨테이너가 맞지 않는 과거 기록은 표시 결과에 영향을 주지 않는다. 상단 제목은 `범어중엔트리 v0.9`이며 바탕화면 바로가기는 별도 핫핑크 ICO를 직접 참조한다.
