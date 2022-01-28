import { Preconditions } from '../utils/preconditions';
import { Packet, serialize, deserialize } from './serializer';
import { MiIONetwork } from './network';
import { remove } from '../utils/array_utils';
import { ResponsePacket } from './packet';

const DEFAULT_PORT = 54321;

export interface RequestData<T> {
  id: number;
  method: string;
  params: T;
}

export interface SimpleResponseSuccess<T> {
  id: number;
  result: T;
  exec_time: number;
}

interface WaitingRequest {
  requestId?: number;
  resolve: <T extends ResponsePacket>(res: T) => void;
  reject: (err: Error) => void;
}

type SimpleResponseError = {
  error: { code: string; message: string };
  id: number;
};
type SimpleResponse<T> = SimpleResponseError | SimpleResponseSuccess<T>;

function isError(
  response: SimpleResponse<any>
): response is SimpleResponseError {
  return !!(response as SimpleResponseError).error;
}

export class MiIOClient {
  protected counter = Math.floor(Math.random() * 10000);
  private deviceStamp: number | undefined;
  private lastHandshake: number | undefined;
  private deviceId: number | undefined;
  private waitQueue: {
    [addressPortHash: string]: WaitingRequest[];
  } = {};

  private static getWaitQueueHash(address: string, port: number) {
    return `address:${address}+port:${port}`;
  }

  constructor(
    private readonly client: MiIONetwork,
    private readonly token: string,
    private readonly address: string,
    private readonly port: number = DEFAULT_PORT
  ) {
    this.init();
  }

  private init() {
    this.client.addMessageHandler((message, { address, port }) => {
      if (address !== this.address || this.port !== port) {
        // Only check messages from the target device
        return;
      }
      const tokenBuffer = Buffer.from(this.token, 'hex');
      const packet = deserialize(message);
      if (!packet.isChecksumValid(tokenBuffer)) {
        throw new Error('Checksum fails');
      }
      const data = packet.getDecryptedData(tokenBuffer);
      const responseId = packet.type === 'NORMAL'
        ? (JSON.parse(data.toString()) as SimpleResponseSuccess<any>).id
        : undefined;
      const hash = MiIOClient.getWaitQueueHash(address, port);
      const index = this.waitQueue[hash].findIndex(
        ({ requestId }) => requestId === responseId
      );
      this.waitQueue[hash][index].resolve(packet);
      this.waitQueue[hash] = remove(this.waitQueue[hash], index);
    });
  }

  private async maybeHandshake() {
    if (Date.now() - (this.lastHandshake ?? 0) <= 10000) {
      return;
    }
    const packet: Packet = {
      isHandshake: true,
      deviceId: 0,
      timestamp: 0,
      data: Buffer.of(),
    };
    const response = await this.sendImpl(packet);
    this.deviceId = response.deviceId;
    this.deviceStamp = response.stamp;
    this.lastHandshake = Date.now();
  }

  private async sendImpl(packet: Packet, requestId?: number) {
    const promise = new Promise<ResponsePacket>((resolve, reject) => {
      const hash = MiIOClient.getWaitQueueHash(this.address, this.port);
      if (this.waitQueue[hash] == null) {
        this.waitQueue[hash] = [];
      }
      this.waitQueue[hash].push({
        requestId,
        resolve,
        reject,
      });
    });
    await this.client.send(
      serialize(packet, this.token),
      this.address,
      this.port
    );
    return promise;
  }

  async send<A, R>(
    method: string,
    params: A
  ): Promise<SimpleResponseSuccess<R>> {
    await this.maybeHandshake();
    const requestId = ++this.counter;
    const packet: Packet = {
      deviceId: Preconditions.checkExists(this.deviceId),
      timestamp:
        Math.floor(
          (Date.now() - Preconditions.checkExists(this.lastHandshake)) * 0.001
        ) + Preconditions.checkExists(this.deviceStamp),
      data: Buffer.from(JSON.stringify({ id: requestId, method, params })),
      isHandshake: false,
    };
    const response = await this.sendImpl(packet, requestId);
    const responseData = response.data;
    return responseData ? JSON.parse(responseData.toString()) : undefined;
  }

  async simpleSend<A>(method: string, params: A): Promise<void> {
    const response = await this.send<A, SimpleResponse<['ok']>>(method, params);
    if (isError(response)) {
      throw new Error(
        `Fail to apply method ${method}: ${response.error.message} with code ${response.error.code}`
      );
    }
  }
}
