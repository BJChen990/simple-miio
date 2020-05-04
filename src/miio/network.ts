import { createSocket, Socket, RemoteInfo } from 'dgram';

export interface MessageHandler {
  (message: Buffer, remoteInfo: RemoteInfo): void;
}

export interface MiIOService {
  send(packet: Buffer, address: string, port: number): void;
  addMessageHandler(handler: MessageHandler): () => void;
}

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

    this.socketPromise = new Promise((resolve) => {
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
      // Binding to local port to start listening.
      socket.bind();
    });
    return this.socketPromise;
  }

  addMessageHandler(handler: MessageHandler) {
    this.messageHandlers.push(handler);
    return () => {
      const { messageHandlers } = this;
      const index = messageHandlers.findIndex(
        (currentHandler) => currentHandler === handler
      );
      this.messageHandlers = [
        ...messageHandlers.slice(0, index),
        ...messageHandlers.slice(index + 1),
      ];
    };
  }

  async send(packet: Buffer, address: string, port: number): Promise<void> {
    const socket = await this.getSocket();
    socket.send(packet, port, address);
  }

  close = async () => {
    const socket = await this.getSocket();
    socket.close();
  };
}
