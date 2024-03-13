import net from 'net';
import fs from 'fs';
import WebSocket from 'ws';
import parseArgs from 'minimist';
import {HttpsProxyAgent} from 'https-proxy-agent';
import {Encryptor} from './encrypt.js';
import {inetNtoa} from './utils.js';

const options = {
  alias: {
    b: 'local_address',
    l: 'local_port',
    s: 'server',
    r: 'remote_port',
    k: 'password',
    c: 'config_file',
    m: 'method',
  },
  string: ['local_address', 'server', 'password', 'config_file', 'method'],
  default: {
    config_file: './config.json',
  },
};

const configFromArgs = parseArgs(process.argv.slice(2), options);
const configContent = fs.readFileSync(configFromArgs.config_file);
const config = JSON.parse(configContent);
for (let k in configFromArgs) {
  const v = configFromArgs[k];
  config[k] = v;
}

let SERVER = config.server;
const REMOTE_PORT = config.remote_port;
const LOCAL_ADDRESS = config.local_address;
const PORT = config.local_port;
const KEY = config.password;
let METHOD = config.method;
const timeout = Math.floor(config.timeout * 1000);
const HTTPPROXY = process.env.http_proxy;

if (HTTPPROXY) {
  console.log('http proxy:', HTTPPROXY);
}

const prepareServer = function (address) {
  const serverUrl = new URL(address);
  if (!serverUrl.hostname) {
    serverUrl.hostname = address;
    serverUrl.pathname = '/';
  }
  if (!serverUrl.port) {
    serverUrl.port = REMOTE_PORT;
  }
  return serverUrl.toString();
};

if (SERVER instanceof Array) {
  SERVER = SERVER.map((s) => prepareServer(s));
} else {
  SERVER = prepareServer(SERVER);
}

const getServer = function () {
  if (SERVER instanceof Array) {
    return SERVER[Math.floor(Math.random() * SERVER.length)];
  } else {
    return SERVER;
  }
};

var server = net.createServer(function (connection) {
  console.log('local connected');
  server.getConnections(function (err, count) {
    console.log('concurrent connections:', count);
  });
  const encryptor = new Encryptor(KEY, METHOD);
  let stage = 0;
  let cachedPieces = [];
  let ws = null;
  let remoteAddr = null;
  let remotePort = null;
  let addrToSend = '';
  const aServer = getServer();
  connection.on('data', function (data) {
    if (stage === 5) {
      // pipe sockets
      data = encryptor.encrypt(data);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, {binary: true});
      }
      return;
    }
    if (stage === 0) {
      connection.write(Buffer.from([5, 0]));
      stage = 1;
      return;
    }
    if (stage === 1) {
      // +----+-----+-------+------+----------+----------+
      // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
      // +----+-----+-------+------+----------+----------+
      // | 1  |  1  | X'00' |  1   | Variable |    2     |
      // +----+-----+-------+------+----------+----------+

      let headerLength = 5;

      if (data.length < headerLength) {
        connection.end();
        return;
      }
      const cmd = data[1];
      const addrtype = data[3];
      if (cmd !== 1) {
        console.log('unsupported cmd:', cmd);
        const reply = Buffer.from('\u0005\u0007\u0000\u0001', 'binary');
        connection.end(reply);
        return;
      }
      if (![1, 3, 4].includes(addrtype)) {
        console.log('unsupported addrtype:', addrtype);
        connection.end();
        return;
      }
      addrToSend = data.subarray(3, 4).toString('binary');

      // read address and port
      if (addrtype === 1) {
        // ipv4
        headerLength = 4 + 4 + 2;
        if (data.length < headerLength) {
          connection.end();
          return;
        }
        remoteAddr = inetNtoa(4, data.subarray(4, 8));
        addrToSend += data.subarray(4, 10).toString('binary');
        remotePort = data.readUInt16BE(8);
      } else if (addrtype === 4) {
        // ipv6
        headerLength = 4 + 16 + 2;
        if (data.length < headerLength) {
          connection.end();
          return;
        }
        remoteAddr = inetNtoa(6, data.subarray(4, 20));
        addrToSend += data.subarray(4, 22).toString('binary');
        remotePort = data.readUInt16BE(20);
      } else {
        const addrLen = data[4];
        headerLength = 5 + addrLen + 2;
        if (data.length < headerLength) {
          connection.end();
          return;
        }
        remoteAddr = data.subarray(5, 5 + addrLen).toString('binary');
        addrToSend += data.subarray(4, 5 + addrLen + 2).toString('binary');
        remotePort = data.readUInt16BE(5 + addrLen);
      }
      let buf = Buffer.alloc(10);
      buf.write('\u0005\u0000\u0000\u0001', 0, 4, 'binary');
      buf.write('\u0000\u0000\u0000\u0000', 4, 4, 'binary');
      buf.writeUInt16BE(remotePort, 8);
      connection.write(buf);
      // connect to remote server
      // ws = new WebSocket aServer, protocol: "binary"

      if (HTTPPROXY) {
        // WebSocket endpoint for the proxy to connect to
        const endpoint = aServer;
        const parsed = new URL(endpoint);
        //console.log('attempting to connect to WebSocket %j', endpoint);

        // create an instance of the `HttpsProxyAgent` class with the proxy server information
        const opts = new URL(HTTPPROXY);

        // IMPORTANT! Set the `secureEndpoint` option to `false` when connecting
        //            over "ws://", but `true` when connecting over "wss://"
        opts.secureEndpoint = parsed.protocol
          ? parsed.protocol == 'wss:'
          : false;

        const agent = new HttpsProxyAgent(opts);

        ws = new WebSocket(aServer, {
          protocol: 'binary',
          agent,
        });
      } else {
        ws = new WebSocket(aServer, {
          protocol: 'binary',
        });
      }

      ws.on('open', function () {
        console.log(`connecting ${remoteAddr} via ${aServer}`);
        const data = Buffer.concat([
          Buffer.from(addrToSend, 'binary'),
          ...cachedPieces,
        ]);
        cachedPieces = null;
        ws.send(encryptor.encrypt(data), {
          binary: true,
        });
        stage = 5;
      });

      ws.on('message', function (data, flags) {
        connection.write(encryptor.decrypt(data));
      });

      ws.on('close', function () {
        console.log('remote disconnected');
        connection.destroy();
      });

      ws.on('error', function (e) {
        console.log(`remote ${remoteAddr}:${remotePort} error: ${e}`);
        connection.destroy();
        server.getConnections(function (err, count) {
          console.log('concurrent connections:', count);
        });
      });

      if (data.length > headerLength) {
        let buf = Buffer.alloc(data.length - headerLength);
        data.copy(buf, 0, headerLength);
        cachedPieces.push(buf);
      }
      stage = 4;
    } else if (stage === 4) {
      // remote server not connected
      // cache received buffers
      // make sure no data is lost
      cachedPieces.push(data);
    }
  });

  connection.on('end', function () {
    console.log('local disconnected');
    ws?.terminate();

    server.getConnections(function (err, count) {
      console.log('concurrent connections:', count);
    });
  });

  connection.on('error', function (e) {
    console.log(`local error: ${e}`);
    ws?.terminate();

    server.getConnections(function (err, count) {
      console.log('concurrent connections:', count);
    });
  });

  connection.setTimeout(timeout, function () {
    console.log('local timeout');
    connection.destroy();
    ws?.terminate();
  });
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
