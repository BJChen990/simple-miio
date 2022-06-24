import { Socket } from 'dgram';
import { ConsoleLogger, Logger, LogLevel } from '../logger';
import { MiIONetwork } from '../network';
import { createPacket } from '../tests/utils';

jest.mock('dgram');
jest.mock('../logger');

function findHandler(fn: jest.Mocked<Socket>['on'], message: string) {
  const args = fn.mock.calls.find(([event]) => event === message);
  if (!args) {
    throw new Error(`Not able to find handler "${message}"`);
  }
  // Due to the limitation of type inference on overloading, we cast the handler to
  // Function.
  return args[1] as Function;
}

describe('MiIONetwork', () => {
  let logger: Logger;
  let socket: jest.Mocked<Socket>;
  let network: MiIONetwork;

  beforeEach(() => {
    jest.resetAllMocks();
    logger = jest.mocked(new ConsoleLogger(LogLevel.DEBUG));
    socket = jest.mocked(new Socket());
    network = new MiIONetwork(socket, logger);
  });

  describe('send', () => {
    it('sends packets after initialized', async () => {
      const ensureReady = jest.spyOn(network, 'ensureReady');
      ensureReady.mockResolvedValue();
      socket.send.mockImplementation(
        (_1, _2, _3, cb?: (err: null | Error, bytesSent: number) => void) => {
          cb?.(null, 100);
        }
      );
      const packet = createPacket('');
      const result = await network.send(packet, 'ADDRESS', 8080);
      expect(ensureReady).toHaveBeenCalledTimes(1);
      expect(socket.send).toHaveBeenCalledWith(
        packet.raw,
        8080,
        'ADDRESS',
        expect.any(Function)
      );
      expect(result).toEqual(expect.any(Number));
    });
  });

  describe('close', () => {
    it('closes socket after being closed', async () => {
      const ensureReady = jest.spyOn(network, 'ensureReady');
      ensureReady.mockResolvedValue();
      socket.close.mockImplementation((cb?: () => void) => cb?.());
      await network.close();
      expect(ensureReady).toHaveBeenCalledTimes(1);
      expect(socket.close).toHaveBeenCalled();
    });
  });

  describe('addMessageListener', () => {
    it('receives message events', async () => {
      const handler = jest.fn();
      network.addMessageHandler(handler);
      network.ensureReady();
      const messageHandler = findHandler(socket.on, 'message');

      const buffer = Buffer.of();
      const remoteInfo = {};
      messageHandler(buffer, remoteInfo);
      expect(handler).toBeCalledWith(buffer, remoteInfo);
    });

    it('does not receive message events after unsubscribe', async () => {
      const handler = jest.fn();
      const unsubscribe = network.addMessageHandler(handler);
      network.ensureReady();
      const messageHandler = findHandler(socket.on, 'message');
      unsubscribe();

      messageHandler(Buffer.of(), {});
      expect(handler).not.toBeCalled();
    });
  });

  describe('ensureReady', () => {
    it('does not start initializing at the begining', () => {
      expect(socket.bind).not.toHaveBeenCalled();
    });

    it('initialize only once', () => {
      network.ensureReady();
      network.ensureReady();
      expect(socket.bind).toHaveBeenCalledTimes(1);
    });

    it('starts binding lazily after send packet is called', () => {
      network.ensureReady();
      expect(socket.bind).toHaveBeenCalled();
    });

    it('listens to the error event', () => {
      network.ensureReady();
      expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('invokes logger on error', async () => {
      network.ensureReady();
      const handler = findHandler(socket.on, 'error');
      handler(new Error('Custom error'));
      expect(socket.on).toHaveBeenCalled();
      expect(logger.error).toBeCalledWith(new Error('Custom error'));
    });

    it('listens to the message event', () => {
      network.ensureReady();
      expect(socket.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('listens to the listening event', () => {
      network.ensureReady();
      expect(socket.on).toHaveBeenCalledWith('listening', expect.any(Function));
    });

    it('resolves after listening event', async () => {
      socket.address.mockReturnValue({
        port: 9999,
        address: 'ADDRESS',
        family: 'FAMILY',
      });
      const promise = network.ensureReady();
      const handler = findHandler(socket.on, 'listening');
      handler();
      await promise;
      expect(socket.setBroadcast).toBeCalledWith(true);
    });

    it('listens to the close event', () => {
      network.ensureReady();
      expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('remove all listeners after close', async () => {
      network.ensureReady();
      const handler = findHandler(socket.on, 'close');
      handler();
      expect(socket.removeAllListeners).toBeCalled();
    });
  });
});
