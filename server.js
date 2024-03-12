import net from 'net';
import fs from 'fs';
import http from 'http';
import WebSocket from 'ws';
import {WebSocketServer} from 'ws';
import parseArgs from 'minimist';
import {Encryptor} from './encrypt.js';
import {inetNtoa} from './utils.js';

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

const timeout = Math.floor(config.timeout * 1000);
const LOCAL_ADDRESS = config.local_address;
const PORT = config.remote_port;
const KEY = config.password;
let METHOD = config.method;
const highWaterMark = +process.env.HIGH_WATER_MARK || 64 * 1024;

const server = http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('asdf.');
});

const wss = new WebSocketServer({
  server,
  autoPong: true,
  allowSynchronousEvents: true,
  perMessageDeflate: false,
});

wss.on('connection', function (ws) {
  console.log('server connected');
  console.log('concurrent connections:', wss.clients.size);
  const encryptor = new Encryptor(KEY, METHOD);
  let stage = 0;
  let remote = null;
  let cachedPieces = [];
  let remoteAddr = null;
  let remotePort = null;
  ws.on('message', function (data, flags) {
    data = encryptor.decrypt(data);
    if (stage === 5) {
      remote.write(data);
    }
    if (stage === 0) {
      let headerLength = 2;
      if (data.length < headerLength) {
        ws.close();
        return;
      }
      const addrtype = data[0];
      if (![1, 3, 4].includes(addrtype)) {
        console.warn(`unsupported addrtype: ${addrtype}`);
        ws.close();
        return;
      }
      // read address and port
      if (addrtype === 1) {
        // ipv4
        headerLength = 1 + 4 + 2;
        if (data.length < headerLength) {
          ws.close();
          return;
        }
        remoteAddr = inetNtoa(4, data.subarray(1, 5));
        remotePort = data.readUInt16BE(5);
      } else if (addrtype === 4) {
        // ipv6
        headerLength = 1 + 16 + 2;
        if (data.length < headerLength) {
          ws.close();
          return;
        }
        remoteAddr = inetNtoa(6, data.subarray(1, 17));
        remotePort = data.readUInt16BE(17);
      } else {
        let addrLen = data[1];
        headerLength = 2 + addrLen + 2;
        if (data.length < headerLength) {
          ws.close();
          return;
        }
        remoteAddr = data.subarray(2, 2 + addrLen).toString('binary');
        remotePort = data.readUInt16BE(2 + addrLen);
      }

      // connect to remote server
      remote = net.connect(remotePort, remoteAddr, function () {
        console.log('connecting', remoteAddr);
        remote.write(Buffer.concat(cachedPieces));
        cachedPieces = null;
        stage = 5;
      });
      remote.on('data', function (data) {
        if (ws.readyState === WebSocket.OPEN) {
          data = encryptor.encrypt(data);
          ws.send(data, {binary: true}, (err) => {
            if (err) return;
            if (ws.bufferedAmount < highWaterMark && remote.isPaused())
              remote.resume();
          });
          if (ws.bufferedAmount >= highWaterMark && !remote.isPaused())
            remote.pause();
        }
      });

      remote.on('end', function () {
        ws.close();
        console.log('remote disconnected');
      });

      remote.on('error', function (e) {
        ws.terminate();
        console.log(`remote: ${e}`);
      });

      remote.setTimeout(timeout, function () {
        console.log('remote timeout');
        remote.destroy();
        ws.close();
      });

      if (data.length > headerLength) {
        // make sure no data is lost
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

  ws.on('close', function () {
    console.log('server disconnected');
    console.log('concurrent connections:', wss.clients.size);
    remote?.destroy();
  });

  ws.on('error', function (e) {
    console.warn(`server: ${e}`);
    console.log('concurrent connections:', wss.clients.size);
    remote?.destroy();
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
