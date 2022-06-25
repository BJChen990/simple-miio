import { MiIONetwork } from './network';
import { remove } from '../utils/array_utils';
import {
  HandshakeRequest,
  MiIORequest,
  NormalRequest,
  PacketImpl,
} from './packet';
import { RequestSerializer, ResponseDeserializer } from './serializer';
import { Logger } from './logger';

const DEFAULT_TIMEOUT = 10000;
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

export interface WaitingRequest {
  requestId?: number;
  timeout: NodeJS.Timeout;
  resolve: <T extends PacketImpl>(res: T) => void;
  reject: (err: Error) => void;
}

export class MiIOClient {
  protected counter: number;

  deviceId: number | undefined;
  private handshakeTimestamp: number | undefined;
  private deviceStamp: number | undefined;

  static DEFAULT_PORT = 54321;

  private static getWaitQueueHash(address: string, port: number) {
    return `address:${address}+port:${port}`;
  }

  constructor(
    private readonly client: MiIONetwork,
    private readonly serializer: RequestSerializer,
    private readonly deserializer: ResponseDeserializer,
    private readonly logger: Logger,
    private readonly config: {
      address: string;
      port: number;
      handshakeTimeout?: number;
      counter?: number;
    },
    private readonly waitQueue: {
      [addressPortHash: string]: WaitingRequest[];
    } = {}
  ) {
    this.counter = this.config.counter ?? Math.floor(Math.random() * 10000);
  }

  subscribeToMessages() {
    return this.client.addMessageHandler((message, { address, port }) => {
      if (address !== this.config.address || this.config.port !== port) {
        // Only check messages from the target device
        return;
      }
      const packet = PacketImpl.from(message);
      const response = this.deserializer.deserialize(packet);
      const responseId =
        response.type === 'NORMAL'
          ? (JSON.parse(response.data.toString()) as SimpleResponseSuccess<any>)
            .id
          : undefined;
      const hash = MiIOClient.getWaitQueueHash(address, port);
      const index = this.waitQueue[hash].findIndex(
        ({ requestId }) => requestId === responseId
      );
      if (index) {
        this.logger.warn(
          `No pending promise found for ${responseId}. Possible options: ${this.waitQueue[
            hash
          ]
            .map(r => r.requestId)
            .join(' ,')}.`
        );
        return;
      }
      this.waitQueue[hash][index].resolve(packet);
      clearTimeout(this.waitQueue[hash][index].timeout);
      this.waitQueue[hash] = remove(this.waitQueue[hash], index);
    });
  }

  async getRequestMetadata() {
    if (
      !this.handshakeTimestamp ||
      !this.deviceId ||
      !this.deviceStamp ||
      Date.now() - this.handshakeTimestamp >
        (this.config.handshakeTimeout ?? DEFAULT_TIMEOUT)
    ) {
      const response = await this.sendImpl(new HandshakeRequest());
      this.deviceId = response.deviceId;
      this.deviceStamp = response.stamp;
      this.handshakeTimestamp = Date.now();
    }
    return {
      deviceId: this.deviceId,
      deviceStamp: this.deviceStamp,
      handshakeTimestamp: this.handshakeTimestamp,
    };
  }

  private async sendImpl<T extends MiIORequest>(
    request: T,
    requestId?: number
  ) {
    const promise = new Promise<PacketImpl>((resolve, reject) => {
      const hash = MiIOClient.getWaitQueueHash(
        this.config.address,
        this.config.port
      );
      if (this.waitQueue[hash] == null) {
        this.waitQueue[hash] = [];
      }
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
        const index = this.waitQueue[hash].findIndex(
          ({ requestId: id }) => id === requestId
        );
        this.waitQueue[hash] = remove(this.waitQueue[hash], index);
      }, 10000);
      this.waitQueue[hash].push({
        requestId,
        timeout,
        resolve,
        reject,
      });
    });
    await this.client.send(
      this.serializer.serialize(request),
      this.config.address,
      this.config.port
    );
    return promise;
  }

  async send<A, R>(
    method: string,
    params: A
  ): Promise<SimpleResponseSuccess<R>> {
    const {
      deviceId,
      deviceStamp,
      handshakeTimestamp,
    } = await this.getRequestMetadata();
    const requestId = ++this.counter;

    const request = new NormalRequest(
      deviceId,
      Math.floor((Date.now() - handshakeTimestamp) * 0.001) + deviceStamp,
      Buffer.from(JSON.stringify({ id: requestId, method, params }))
    );
    const packet = await this.sendImpl(request, requestId);
    const response = this.deserializer.deserialize(packet);
    return response.data.byteLength > 0
      ? JSON.parse(response.data.toString())
      : undefined;
  }
}
