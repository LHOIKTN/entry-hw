![Entry Logo](app/src/renderer/images/about/logo.png)

## [![Action Build Status](https://github.com/entrylabs/entry-hw/workflows/Build%20%26%20Deploy/badge.svg)](https://github.com/entrylabs/entry-hw/actions?query=workflow%3A"Build+%26+Deploy")

## What is Entry Hardware

entry-hw는 엔트리와 하드웨어를 연동하기 위한 프로그램 입니다.  
엔트리 사이트에 접속하시면 엔트리를 사용한 블록코딩 환경과 하드웨어를 연동하는 모습을 확인해 볼 수 있습니다.

## Prerequisite

#### Node.js

Node.js 는 개발 전반을 위해 반드시 설치가 되어야하는 프레임워크입니다. 작업 전 가장 먼저 설치합니다.

> https://nodejs.org

#### Yarn(optional)

> npm install --global yarn

엔트리 하드웨어는 yarn 을 통해 의존성을 관리 중입니다. npm 을 사용해도 문제는 없습니다.

#### Node-gyp

엔트리 하드웨어는 [node-serialport](https://github.com/node-serialport/node-serialport) 를 사용합니다.  
해당 라이브러리를 사용하기 위해서는 C++, python 빌드 환경과 [node-gyp](https://github.com/nodejs/node-gyp) 라이브러리가 필요합니다.  
빌드에 대한 자세한 사항은 [node-gyp#installation](https://github.com/nodejs/node-gyp#installation) 을 참고해 주세요.

먼저 빌드 환경을 구성해야 합니다.  
윈도우의 경우, 관리자 권한 명령 프롬프트에서

```bash
npm install --global --production windows-build-tools
```

로 한번에 설치할 수 있습니다. [Windows-Build-Tools](https://github.com/felixrieseberg/windows-build-tools) 를 참고해 주세요.

```bash
npm install --global node-gyp
```

## CommandLine arguments

프로그램 실행시 인자를 추가하는 것으로 프로그램 설정을 변경할 수 있습니다.

-   --debug (-d, default = false): 프로그램 실행시 개발자콘솔(devtool) 이 같이 오픈됩니다.
-   --config (-c, default = 'entry'): config 파일 명칭을 선택합니다. 위치는 \<projectPath\>/config/config.${name}.json 입니다.
-   --lang (-l): locale 을 설정할 수 있습니다. 기본적으로 ko, en, jp 를 지원합니다. 코드 기여를 통해 타 다국어를 지원하게 만들 수 있습니다.
    -   lang 은 기본적으로 OS 의 locale 값을 따릅니다.

## Entry Hardware Full Documentation

[Entry Docs](https://entrylabs.github.io/docs/guide/entry-hw/2016-05-01-getting_started.html)

## Copyright and License

[The MIT License (MIT)](https://github.com/entrylabs/entry-hw/blob/master/LICENSE)

## Windows micro:bit 연결 변경 (2026-11-09)

- Windows에서는 `SerialPort.list()`의 COM 항목에 포함된 시리얼번호로 표시 이름만 `microbit (축약번호)`로 바꿉니다. 실제 연결 경로는 원래 `COMxx` 그대로 사용합니다.
- 48자리 시리얼번호는 기존 규칙에 따라 가운데 8자리를 표시하며, 축약번호가 중복되면 전체 번호와 COM 경로를 표시합니다.
- 시리얼번호가 없거나 완전한 장치 번호로 확인되지 않으면 `COMxx`를 그대로 표시하고 기존 연결 절차를 사용합니다.
- Windows 연결 과정에서 PowerShell/PnpDevice 및 COM 부모 관계 조회를 사용하지 않습니다. 기존 PnP 유틸리티는 연결 경로에서 호출하지 않습니다.
- 진단 로그는 `%APPDATA%\entry-hw\logs\entry-hw-YYYY-MM-DD.log`에 기록합니다. `microbit COM discovery`로 COM 원본 목록과 조회 시간, 오류 코드 및 스택을 확인할 수 있습니다.
- macOS 시리얼 선택 방식은 유지합니다. Windows의 COM 기반 선택에서는 재연결 시에도 해당 COM 경로를 사용합니다.

검증 명령: `node cli/microbitDevicesTest.js` (통과). 축약 표시, 시리얼 없는 COM 표시, 중복 이름 구분, 기존 COM 연결, 사라진 COM 연결 방지 및 조회 실패 처리를 검사합니다. 실제 USB 통신은 재설치 후 확인해야 합니다.

Entry Offline 설치 파일에는 이 저장소의 router/preload/선택 UI 빌드 결과를 함께 동기화해야 합니다. 상위 작업 폴더의 `entry-offline/BEOMEO.md`와 `entry-offline/WINDOWS-HANDOFF.ko.md`를 참조하세요.
