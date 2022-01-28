import { createSocket, Socket, RemoteInfo } from 'dgram';
import { remove } from '../utils/array_utils';

export interface MessageHandler {
  (message: Buffer, remoteInfo: RemoteInfo): void;
}

export interface MiIOService {
  send(packet: Buffer, address: string, port: number): void;
  addMessageHandler(handler: MessageHandler): () => void;
}

type Unsubscriber = () => void;

export class MiIONetwork implements MiIOService {
  private socketPromise: Promise<Socket> | undefined;
  private messageHandlers: MessageHandler[] = [];
  private listeningHandler: (() => void) | undefined;
  private messageHandler:
    | ((buffer: Buffer, remoteInfo: RemoteInfo) => void)
    | undefined;

  private getSocket(): Promise<Socket> {
    if (this.socketPromise) {
      return this.socketPromise;
    }

    this.socketPromise = new Promise(resolve => {
      const socket = createSocket('udp4');
      socket.on('error', console.error);

      this.listeningHandler = () => {
        socket.setBroadcast(true);
        console.log('start listening on port ' + socket.address().port);
        resolve(socket);
      };
      socket.on('listening', this.listeningHandler);

      this.messageHandler = (message, remoteInfo) => {
        this.messageHandlers.forEach((handler) => handler(message, remoteInfo));
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
      const index = messageHandlers.findIndex(currentHandler => currentHandler === handler);
      this.messageHandlers = remove(messageHandlers, index);
    };
  }

  send = async (packet: Buffer, address: string, port: number): Promise<number> => {
    const socket = await this.getSocket();
    return new Promise((resolve, reject) => socket.send(packet, port, address, (err, bytes) => {
      if (err) {
        reject(err);
      } else {
        resolve(bytes);
      }
    }));
  };

  close = async () => {
    const socket = await this.getSocket();
    return new Promise<void>(resolve => {
      socket.close(() => resolve());
    });
  };
}
