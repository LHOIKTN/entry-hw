import _ from 'lodash';
import rendererConsole from '../rendererConsole';
import SerialPort from 'serialport';
import electPort from './electPortFunction';
import {CloudModeTypes} from '../../../common/constants';
import BaseScanner from '../baseScanner';
import SerialConnector from './connector';
import createLogger from '../../electron/functions/createLogger';
import Flasher from './flasher';
import { buildWindowsMicrobitPorts, buildMacMicrobitDevices, microbitNotice } from './microbitDevices';

const logger = createLogger('core/SerialScanner.ts');

/**
 * 전체 포트를 검색한다.
 * 검색 조건은 hwModule 의 config 에서 설정한다.
 * pnpId, VendorName, select port 등등 이다.
 *
 * 결과의 송수신은 router 에 만들어진 함수로 보낸다.
 */
class SerialScanner extends BaseScanner<SerialConnector> {
    private isScanning = false;
    private flasher = new Flasher();

    static get SCAN_INTERVAL_MILLS() {
        return 1500;
    }

    public stopScan() {
        logger.verbose('scan stopped');
        this.config = undefined;
        this.isScanning = false;
    };

    protected async intervalScan() {
        this.isScanning = true;
        let scanResult = undefined;
        while (this.isScanning) {
            logger.verbose('intervalScan..');
            scanResult = await this.scan();
            logger.verbose(`scan result :${scanResult}`);
            if (scanResult) {
                this.isScanning = false;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, SerialScanner.SCAN_INTERVAL_MILLS));
        }
        return scanResult;
    }

    private async scan() {
        if (!this.config || !this.hwModule) {
            logger.warn('config or hwModule is not present');
            return;
        }

        const scanConfig = this.config;
        const serverMode = this.router.currentCloudMode;
        const selectedComPortName = this.router.selectedPort;
        const { hardware } = this.config;
        let { selectPort: needCOMPortSelect } = this.config;
        const { type } = hardware;

        // win, mac 플랫폼에 맞춰 COMPort 확인창 필요한지 설정
        if (needCOMPortSelect && typeof needCOMPortSelect !== 'boolean') {
            needCOMPortSelect = needCOMPortSelect[process.platform];
        }

        // comPort 선택지가 필요한지 체크한다. 블루투스나 클라우드 모드인경우 무조건 검사한다.
        const isComPortSelected =
            needCOMPortSelect ||
            type === 'bluetooth' ||
            serverMode === CloudModeTypes.cloud;

        // 전체 포트 가져오기
        const isMicrobit = (process.platform === 'win32' || process.platform === 'darwin') && scanConfig.module === 'microbit2.js';
        const comPorts = isMicrobit ? [] : await SerialPort.list();
        const selectedPorts = [];

        // 포트 선택을 유저에게서 직접 받아야 하는가?
        if (isMicrobit && process.platform === 'win32') {
            const started = Date.now();
            try {
                // The serial and COM path belong to the same enumeration record.
                // Change only the label; connect through the original COM path.
                const currentPorts = await SerialPort.list();
                if (this.config !== scanConfig || !this.isScanning) { return; }
                const devices = buildWindowsMicrobitPorts(currentPorts);
                logger.info(`microbit COM discovery: elapsed=${Date.now() - started}ms; ports=${JSON.stringify(currentPorts)}`);
                if (!devices.some(device => device.path === selectedComPortName)) {
                    this.router.sendEventToMainWindow('portListScanned', devices.length ? devices : [
                        microbitNotice('연결된 COM 포트가 없습니다. USB 연결과 드라이버를 확인하세요.'),
                    ]);
                    return;
                }
                selectedPorts.push(selectedComPortName);
            } catch (error) {
                logger.warn(`microbit COM discovery failed: elapsed=${Date.now() - started}ms; code=${error.code}; error=${error.stack || error.message}`);
                if (this.config === scanConfig && this.isScanning) {
                    this.router.sendEventToMainWindow('portListScanned', [microbitNotice(
                        `COM 장치 조회 실패: ${error.message}. 상세 원인은 장치 로그를 확인하세요.`,
                    )]);
                }
                return;
            }
        } else if (isMicrobit) {
            // Keep only the serial identity in router state, including reconnects.
            // Re-resolve against a fresh PnP snapshot before opening any port.
            try {
                const currentPorts = await SerialPort.list().catch((error) => {
                    logger.warn(`microbit serial port enumeration failed: ${error.message}`);
                    return [];
                });
                if (this.config !== scanConfig || !this.isScanning) {
                    return;
                }
                const devices = buildMacMicrobitDevices(currentPorts);
                const selected = devices.find(device => device.path === this.router.selectedPort);
                if (!selected || selected.connectionError || !selected.comPath) {
                    this.router.sendEventToMainWindow('portListScanned', devices.length ? devices : [
                        microbitNotice('microbit을 찾지 못했습니다. USB 연결과 장치 드라이버를 확인하세요.'),
                    ]);
                    return;
                }
                selectedPorts.push(selected.comPath);
            } catch (error) {
                if (this.config === scanConfig && this.isScanning) {
                    logger.warn(`microbit serial discovery failed: ${error.stack || error.message}`);
                    this.router.sendEventToMainWindow('portListScanned', [microbitNotice(
                        `장치 조회 실패: ${error.message}. 상세 원인은 장치 로그를 확인하세요.`,
                    )]);
                }
                return;
            }
        } else if (isComPortSelected) {
            // 포트가 외부에서 선택되었는가?
            if (selectedComPortName) {
                // lost 후 reconnect 임시 대응
                if (comPorts
                    .map((portData) => portData.path)
                    .findIndex((path) => path === selectedComPortName) === -1) {
                    return;
                }
                selectedPorts.push(selectedComPortName);
            } else {
                rendererConsole.log(comPorts);
                this.router.sendEventToMainWindow('portListScanned', comPorts);
                return;
            }
        } else {
            // 포트 선택을 config 에서 처리해야 하는 경우
            selectedPorts.push(
                ..._.compact(comPorts.map((port) => this._selectCOMPortUsingProperties(hardware, port))),
            );
        }

        if (this.config.handshake && !this.router.selectedPayload) {
            // handshakeType 가 argument 면 selectedPayload 가 필요하다. 이 값이 없으면 시리얼포트 선출하지 않는다.
            return;
        }

        
        const firmware = this.config.firmware; 
                    
        if (firmware)
        {
            if ((firmware as IOpenCM7TypeFirmware).type === 'opencm7')
            {
                if (selectedPorts[0] != null)
                {
                    await this.flasher.checkOpenCM7Version(selectedPorts[0], (this.config.firmware as IOpenCM7TypeFirmware).latest_version);
                }
            }
        }

        const electedConnector = await electPort(selectedPorts, hardware, this.hwModule,
            (connector) => {
                if (this.config && this.config.firmware) {
                    /*
                    펌웨어가 없는 상태에서 통신이 이루어지지 않는 경우,
                    before_connect 로 임시 연결됨 상태로 만들어서 펌웨어 버튼은 동작할 수 있게끔
                    만든다.
                    TODO 현재는 여러개의 포트가 선출되는 경우, 가장 첫번째 포트를 선택한다.
                     */
                    this.router.setConnector(connector);
                    this.router.sendState('before_connect');
                }
            },
            () => this.router.selectedPayload,
        );

        if (electedConnector) {
            logger.info(`${electedConnector.port} is finally connected`);
            rendererConsole.log((process.platform === 'win32' || process.platform === 'darwin') && scanConfig.module === 'microbit2.js'
                ? 'microbit is finally connected'
                : `${electedConnector.port} is finally connected`);
            this.stopScan();
            return electedConnector.connector;
        }
        logger.info(`scan completed but no connected. portList is ${comPorts.map((port) => port.path).join(', ')}`);
    };

    private _selectCOMPortUsingProperties(hardwareConfig: IHardwareModuleConfig, comPort: SerialPort.PortInfo) {
        const { vendor, pnpId: verifiedPnpId, comName: verifiedComPortNames } = hardwareConfig;
        const { path, manufacturer, pnpId } = comPort;

        const comName = path;
        let platformVendor: string | string[];

        // win, mac 플랫폼에 맞는 벤더명 설정
        if (vendor && typeof vendor !== 'string' && !Array.isArray(vendor)) {
            platformVendor = vendor[process.platform as 'win32' | 'darwin'];
        } else {
            platformVendor = vendor;
        }

        // config 에 입력한 특정 벤더와 겹치는지 여부
        const isVendor = this._indexOfStringOrArray(platformVendor, manufacturer);

        // config 에 입력한 특정 COMPortName과 겹치는지 여부
        const isComName = this._indexOfStringOrArray(verifiedComPortNames, comName);

        // config 에 입력한 특정 pnpId와 겹치는지 여부
        const isPnpId = this._indexOfStringOrArray(verifiedPnpId, pnpId);

        // 현재 포트가 config 과 일치하는 경우 연결시도할 포트목록에 추가
        if (isVendor || isPnpId || isComName) {
            logger.info(`auto port select: ${comName}`);
            return comName;
        }
        logger.verbose('not found auto select port');
    }

    private _indexOfStringOrArray(arrayOrString?: string | string[], target?: string): boolean {
        if (!target || !arrayOrString) {
            return false;
        }

        if (Array.isArray(arrayOrString)) {
            return arrayOrString.some((item) => target.indexOf(item) >= 0);
        } else {
            return target.indexOf(arrayOrString) >= 0;
        }
    }
}

export default SerialScanner;
