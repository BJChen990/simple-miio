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
import { retry } from '../utils/retry';

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

const delay = (timeout: number) => new Promise(resolve => setTimeout(resolve, timeout));

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
      requestTimeout?: number;
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
      const task = this.removeFromWaitQueue(responseId);
      if (!task) {
        return;
      }
      task.resolve(packet);
      clearTimeout(task.timeout);
    });
  }

  invalidateHandshake() {
    this.handshakeTimestamp = undefined;
    this.deviceId = undefined;
    this.deviceStamp = undefined;
  }

  private async getRequestMetadata() {
    if (
      !this.handshakeTimestamp ||
      !this.deviceId ||
      !this.deviceStamp ||
      Date.now() - this.handshakeTimestamp >
        (this.config.handshakeTimeout ?? DEFAULT_TIMEOUT)
    ) {
      this.logger.debug(
        'handshake expired. Last handshake time: ' + this.handshakeTimestamp
      );
      this.logger.debug('applying handshake again...');
      const response = await this.sendImpl(new HandshakeRequest());
      this.deviceId = response.deviceId;
      this.deviceStamp = response.stamp;
      this.handshakeTimestamp = Date.now();
    } else {
      this.logger.debug(
        'reuse handshake. last handshake: ' + this.handshakeTimestamp
      );
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
      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
        this.removeFromWaitQueue(requestId);
      }, this.config.requestTimeout ?? DEFAULT_TIMEOUT);
      this.addToWaitQueue({
        requestId,
        timeout,
        resolve,
        reject,
      });
    });
    this.logger.debug(
      'Sending request. Type: ',
      request.type,
      JSON.stringify(request.data.toString(), null, 2)
    );
    await this.client.send(
      this.serializer.serialize(request),
      this.config.address,
      this.config.port
    );
    return promise;
  }

  send = retry(async <A, R>(method: string, params: A): Promise<
    SimpleResponseSuccess<R>
  > => {
    const {
      deviceId,
      deviceStamp,
      handshakeTimestamp,
    } = await this.getRequestMetadata();
    const requestId = ++this.counter;
    
    // Add a delay to prevent sending request too early after handshake.
    await delay(100);

    const request = new NormalRequest(
      deviceId,
      Math.floor((Date.now() - handshakeTimestamp) * 0.001) + deviceStamp,
      Buffer.from(JSON.stringify({ id: requestId, method, params }))
    );
    const packet = await this.sendImpl(request, requestId);
    const response = this.deserializer.deserialize(packet);
    if (response.data.byteLength <= 0) {
      throw new Error('Received byte length less then or equal to 0');
    }
    const message = JSON.parse(response.data.toString());
    this.logger.debug('Received response:', JSON.stringify(message, null, 2));
    return message;
  }, 3);

  private addToWaitQueue(request: WaitingRequest) {
    const hash = MiIOClient.getWaitQueueHash(
      this.config.address,
      this.config.port
    );
    if (this.waitQueue[hash] == null) {
      this.waitQueue[hash] = [];
    }
    this.waitQueue[hash].push(request);
  }

  private removeFromWaitQueue(requestId?: number) {
    const hash = MiIOClient.getWaitQueueHash(
      this.config.address,
      this.config.port
    );
    const index = this.waitQueue[hash].findIndex(
      ({ requestId: id }) => id === requestId
    );
    if (index) {
      this.logger.warn(
        `No pending promise found for ${requestId}. Possible options: ${this.waitQueue[
          hash
        ]
          .map(r => r.requestId)
          .join(' ,')}.`
      );
      return;
    }
    const task = this.waitQueue[hash][index];
    this.waitQueue[hash] = remove(this.waitQueue[hash], index);
    return task;
  }
}
