import createMockInstance from 'jest-create-mock-instance';
import { MiIOClient, WaitingRequest } from '../client';
import { ConsoleLogger, Logger } from '../logger';
import { MessageHandler, MiIONetwork, Unsubscriber } from '../network';
import {
  HandshakeRequest,
  HandshakeResponse,
  MiIOResponse,
  NormalRequest,
  NormalResponse,
} from '../packet';
import { RequestSerializer, ResponseDeserializer } from '../serializer';
import { createPacket } from '../tests/utils';

jest.mock('dgram');
jest.mock('../serializer');
jest.mock('../network');

const FAKE_PACKET = createPacket({});

const flushPromises = (timer?: typeof jest) =>
  new Promise<void>(resolve => {
    process.nextTick(resolve);
    timer?.advanceTimersByTime(1);
  });

describe('MiIOClient', () => {
  const ADDRESS = '0.0.0.0';
  const INITIAL_COUNTER = 1000;
  const INITIAL_STAMP = 10;
  const DEVICE_ID = 5;
  let messageHandlers: MessageHandler[] = [];
  let network: jest.Mocked<MiIONetwork>;
  let logger: jest.Mocked<Logger>;
  let serializer: jest.Mocked<RequestSerializer>;
  let deserializer: jest.Mocked<ResponseDeserializer>;
  let waitQueue: Record<string, WaitingRequest[]>;
  let client: MiIOClient;
  let unsubscriber: Unsubscriber;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useRealTimers();
    network = createMockInstance(MiIONetwork);
    network.send.mockResolvedValue(10);
    network.addMessageHandler.mockImplementation(handler => {
      messageHandlers.push(handler);
      return () => null;
    });
    serializer = createMockInstance(RequestSerializer);
    serializer.serialize.mockReturnValue(
      createPacket(
        JSON.stringify({
          requestId: INITIAL_COUNTER,
          method: 'method',
          params: [],
        })
      )
    );
    deserializer = createMockInstance(ResponseDeserializer);
    deserializer.deserialize.mockReturnValue(
      new HandshakeResponse(DEVICE_ID, 10, Buffer.of())
    );
    logger = createMockInstance(ConsoleLogger);
    waitQueue = {};
    client = new MiIOClient(
      network,
      serializer,
      deserializer,
      logger,
      {
        address: ADDRESS,
        port: MiIOClient.DEFAULT_PORT,
        counter: INITIAL_COUNTER,
      },
      waitQueue
    );
    unsubscriber = client.subscribeToMessages();
  });

  afterEach(() => {
    messageHandlers = [];
    unsubscriber();
  });

  describe('send', () => {
    describe('handshake', () => {
      it('sends requests with correct stamp', async () => {
        jest.useFakeTimers('modern').setSystemTime(0);
        const promise = client.send('method', []);
        await flushPromises(jest);
        await flushPromises(jest);
        emitMockedResponse(
          new HandshakeResponse(DEVICE_ID, INITIAL_STAMP, Buffer.of())
        );
        await flushPromises(jest);
        await flushPromises(jest);
        jest.advanceTimersByTime(5000);
        await flushPromises(jest);
        await flushPromises(jest);
        emitMockedResponse(
          new NormalResponse(
            DEVICE_ID,
            10,
            Buffer.from(JSON.stringify({ id: INITIAL_COUNTER + 1 }))
          )
        );
        await promise;

        expect(serializer.serialize).toHaveBeenNthCalledWith(
          1,
          new HandshakeRequest()
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          2,
          new NormalRequest(
            DEVICE_ID,
            INITIAL_STAMP + 5,
            Buffer.from('{"id":1001,"method":"method","params":[]}')
          )
        );
        expect(serializer.serialize).toBeCalledTimes(2);
        expect(network.send).toBeCalledTimes(2);
      });

      it('reuses handshake when handshake is not expired', async () => {
        let promise = client.send('method', []);
        await flushPromises();
        emitMockedResponse(
          new HandshakeResponse(DEVICE_ID, INITIAL_STAMP, Buffer.of())
        );
        await flushPromises();
        emitMockedResponse(
          new NormalResponse(
            DEVICE_ID,
            10,
            Buffer.from(JSON.stringify({ id: INITIAL_COUNTER + 1 }))
          )
        );
        await promise;

        promise = client.send('method2', []);
        await flushPromises();
        emitMockedResponse(
          new NormalResponse(
            DEVICE_ID,
            INITIAL_STAMP,
            Buffer.from(JSON.stringify({ id: INITIAL_COUNTER + 2 }))
          )
        );
        await promise;

        expect(serializer.serialize).toHaveBeenNthCalledWith(
          1,
          new HandshakeRequest()
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          2,
          new NormalRequest(
            DEVICE_ID,
            INITIAL_STAMP,
            Buffer.from('{"id":1001,"method":"method","params":[]}')
          )
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          3,
          new NormalRequest(
            DEVICE_ID,
            INITIAL_STAMP,
            Buffer.from('{"id":1002,"method":"method2","params":[]}')
          )
        );
        expect(serializer.serialize).toBeCalledTimes(3);
        expect(network.send).toBeCalledTimes(3);
      });

      it('performs handshake when handshake expired', async () => {
        jest.useFakeTimers('modern');
        let promise = client.send('method', []);
        await flushPromises(jest);
        emitMockedResponse(
          new HandshakeResponse(DEVICE_ID, INITIAL_STAMP, Buffer.of())
        );
        for (let i = 0; i < 6; i++) {
          await flushPromises(jest);
        }
        emitMockedResponse(
          new NormalResponse(
            DEVICE_ID,
            10,
            Buffer.from(JSON.stringify({ id: INITIAL_COUNTER + 1 }))
          )
        );
        await promise;
        jest.advanceTimersByTime(10000);

        promise = client.send('method2', []);
        await flushPromises(jest);
        emitMockedResponse(
          new HandshakeResponse(DEVICE_ID, INITIAL_STAMP, Buffer.of())
        );
        for (let i = 0; i < 6; i++) {
          await flushPromises(jest);
        }
        emitMockedResponse(
          new NormalResponse(
            DEVICE_ID,
            INITIAL_STAMP,
            Buffer.from(JSON.stringify({ id: INITIAL_COUNTER + 2 }))
          )
        );
        await promise;

        expect(serializer.serialize).toHaveBeenNthCalledWith(
          1,
          new HandshakeRequest()
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          2,
          expect.any(NormalRequest)
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          3,
          new HandshakeRequest()
        );
        expect(serializer.serialize).toHaveBeenNthCalledWith(
          4,
          expect.any(NormalRequest)
        );
        expect(serializer.serialize).toBeCalledTimes(4);
        expect(network.send).toBeCalledTimes(4);
      });
      function emitMockedResponse(response: MiIOResponse) {
        deserializer.deserialize.mockReturnValueOnce(response);
        // Normal message will be deserialized twice
        if (response.type === 'NORMAL') {
          deserializer.deserialize.mockReturnValueOnce(response);
        }
        messageHandlers.forEach(handler =>
          handler(FAKE_PACKET.raw, {
            address: ADDRESS,
            family: 'IPv4',
            port: MiIOClient.DEFAULT_PORT,
            size: FAKE_PACKET.raw.byteLength,
          })
        );
      }
    });
  });
});
