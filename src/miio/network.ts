import { Socket, RemoteInfo } from 'dgram';
import { remove } from '../utils/array_utils';
import { Logger } from './logger';
import { Packet } from './packet';

export interface MessageHandler {
  (message: Buffer, remoteInfo: RemoteInfo): void;
}

export interface MiIOService {
  send(packet: Packet, address: string, port: number): Promise<number>;
  addMessageHandler(handler: MessageHandler): Unsubscriber;
  close(): Promise<void>;
}

export type Unsubscriber = () => void;

const BYTE_LETTERS = 2;
const BYTE_PER_ROW = 4;

function formatPacketBuffer(buffer: string, byteLetters = BYTE_LETTERS, bytesPerRow = BYTE_PER_ROW) {
  const chunkCount = Math.ceil(buffer.length / byteLetters);
  const chunks = [];
  for (let i = 0; i < chunkCount; i++) {
    const start = i * byteLetters;
    chunks.push(buffer.slice(start, start + byteLetters)); 
  }
  const rowCount = Math.ceil(chunks.length / bytesPerRow);
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const start = i * bytesPerRow;
    rows.push(chunks.slice(start, start + bytesPerRow).join(' '));
  }
  return rows.join('\n');
}

export class MiIONetwork implements MiIOService {
  private socketPromise: Promise<void> | undefined;
  private messageHandlers: MessageHandler[] = [];
  private listeningHandler: (() => void) | undefined;
  private messageHandler:
    | ((buffer: Buffer, remoteInfo: RemoteInfo) => void)
    | undefined;

  constructor(
    private readonly socket: Socket,
    private readonly logger: Logger
  ) {}

  ensureReady(): Promise<void> {
    if (this.socketPromise) {
      return this.socketPromise;
    }

    this.socketPromise = new Promise(resolve => {
      const { socket } = this;
      socket.on('error', this.logger.error);

      this.listeningHandler = () => {
        socket.setBroadcast(true);
        this.logger.log('start listening on port ' + socket.address().port);
        resolve();
      };
      socket.on('listening', this.listeningHandler);

      this.messageHandler = (message, remoteInfo) => {
        this.logger.debug('Receive message:');
        this.logger.debug(formatPacketBuffer(message.toString('hex')));
        this.messageHandlers.forEach(handler => handler(message, remoteInfo));
      };
      socket.on('message', this.messageHandler);

      const closeHandler = () => socket.removeAllListeners();
      socket.on('close', closeHandler);
      // Binding to local port to start listening.
      socket.bind();
    });
    return this.socketPromise;
  }

  addMessageHandler(handler: MessageHandler): Unsubscriber {
    this.messageHandlers.push(handler);
    return () => {
      const { messageHandlers } = this;
      const index = messageHandlers.findIndex(
        currentHandler => currentHandler === handler
      );
      this.messageHandlers = remove(messageHandlers, index);
    };
  }

  async send(
    packet: Packet,
    address: string,
    port: number
  ): Promise<number> {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      this.logger.debug('Send message:');
      this.logger.debug(formatPacketBuffer(packet.raw.toString('hex')));
      this.socket.send(packet.raw, port, address, (err, bytes) => {
        if (err) {
          reject(err);
        } else {
          resolve(bytes);
        }
      });
    });
  };

  async close () {
    await this.ensureReady();
    return new Promise<void>(resolve => {
      this.socket.close(() => resolve());
    });
  };
}
