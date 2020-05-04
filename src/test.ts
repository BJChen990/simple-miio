import { MiIONetwork } from './miio/network';
import { MiIOClient } from './miio/client';

const network = new MiIONetwork();
const client = new MiIOClient(
  network,
  '7238666c354e586f78576e345a57616c',
  '192.168.8.171'
);

client.send('get_prop', []).then(console.log).catch(console.error);
