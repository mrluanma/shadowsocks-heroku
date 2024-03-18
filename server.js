import net from 'net';
import fs from 'fs';
import http from 'http';
import {WebSocketServer, createWebSocketStream} from 'ws';
import parseArgs from 'minimist';
import {inetNtoa} from './utils.js';
import {pipeline} from 'node:stream/promises';

const options = {
  alias: {
    b: 'local_address',
    r: 'remote_port',
    k: 'password',
    c: 'config_file',
    m: 'method',
  },
  string: ['local_address', 'password', 'method', 'config_file'],
  default: {
    config_file: './config.json',
  },
};

const configFromArgs = parseArgs(process.argv.slice(2), options);
const configFile = configFromArgs.config_file;
const configContent = fs.readFileSync(configFile);
const config = JSON.parse(configContent);

if (process.env.PORT) {
  config['remote_port'] = +process.env.PORT;
}
if (process.env.KEY) {
  config['password'] = process.env.KEY;
}
if (process.env.METHOD) {
  config['method'] = process.env.METHOD;
}

for (let k in configFromArgs) {
  const v = configFromArgs[k];
  config[k] = v;
}

const LOCAL_ADDRESS = config.local_address;
const PORT = config.remote_port;
const KEY = config.password;
let METHOD = config.method;

const server = http.createServer(function (_, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('asdf.');
});

const wsserver = new WebSocketServer({
  server,
  autoPong: true,
  allowSynchronousEvents: true,
  perMessageDeflate: false,
});

wsserver.on('connection', async (ws) => {
  console.log('concurrent connections:', wsserver.clients.size);
  let remoteAddr;
  let remotePort;

  ws.on('error', (err) => console.error(`server: ${err}`));

  const conn = createWebSocketStream(ws);
  conn.on('error', (e) => console.error(`server: ${e}`));

  let data = await conn.read();
  while (!data) {
    await new Promise((resolve, reject) => {
      conn.once('readable', resolve);
    });

    data = await conn.read();
  }

  let headerLength = 2;
  if (data.length < headerLength) {
    conn.end();
    return;
  }
  const addrtype = data[0];
  if (![1, 3, 4].includes(addrtype)) {
    console.warn(`unsupported addrtype: ${addrtype}`);
    conn.end();
    return;
  }
  // read address and port
  if (addrtype === 1) {
    // ipv4
    headerLength = 1 + 4 + 2;
    if (data.length < headerLength) {
      conn.end();
      return;
    }
    remoteAddr = inetNtoa(4, data.subarray(1, 5));
    remotePort = data.readUInt16BE(5);
  } else if (addrtype === 4) {
    // ipv6
    headerLength = 1 + 16 + 2;
    if (data.length < headerLength) {
      conn.end();
      return;
    }
    remoteAddr = inetNtoa(6, data.subarray(1, 17));
    remotePort = data.readUInt16BE(17);
  } else {
    let addrLen = data[1];
    headerLength = 2 + addrLen + 2;
    if (data.length < headerLength) {
      conn.end();
      return;
    }
    remoteAddr = data.subarray(2, 2 + addrLen).toString('binary');
    remotePort = data.readUInt16BE(2 + addrLen);
  }

  const remote = net.connect(remotePort, remoteAddr);

  remote.on('error', (err) => console.error(`server: ${err}`));

  console.log('connecting', remoteAddr);
  if (data.length > headerLength) {
    remote.write(data.subarray(headerLength));
  }

  pipeline(conn, remote).catch(
    (e) => e.name !== 'AbortError' && console.error(`server: ${e}`),
  );
  pipeline(remote, conn).catch(
    (e) => e.name !== 'AbortError' && console.error(`server: ${e}`),
  );
});

server.listen(PORT, LOCAL_ADDRESS, function () {
  const address = server.address();
  console.log('server listening at', address);
});

server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') {
    console.log('address in use, aborting');
  }
  process.exit(1);
});

export default server;
