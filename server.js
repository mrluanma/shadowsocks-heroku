const net = require('net');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;
const parseArgs = require('minimist');
const { Encryptor } = require('./encrypt');

const options = {
  alias: {
    b: 'local_address',
    r: 'remote_port',
    k: 'password',
    c: 'config_file',
    m: 'method'
  },
  string: ['local_address', 'password', 'method', 'config_file'],
  default: {
    config_file: path.resolve(__dirname, 'config.json')
  }
};

const inetNtoa = buf => buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];

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

if (['', 'null', 'table'].includes(METHOD.toLowerCase())) {
  METHOD = null;
}

const server = http.createServer(function(clientRequest, clientResponse) {
  const options = {
    hostname: 'www.ruanyifeng.com',
    port: 80,
    path: clientRequest.url,
    method: clientRequest.method,
    headers: Object.assign(clientRequest.headers, { host: 'www.ruanyifeng.com' })
  };
  try {
    const initiation = http.request(options, function(response) {
      clientResponse.writeHead(response.statusCode, response.headers);
      response.pipe(clientResponse);
    });
    clientRequest.pipe(initiation);
  } catch (error) {
    clientRequest.abort();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', function(ws) {
  console.log('server connected');
  console.log('concurrent connections:', wss.clients.size);
  const encryptor = new Encryptor(KEY, METHOD);
  let stage = 0;
  let headerLength = 0;
  let remote = null;
  let cachedPieces = [];
  let addrLen = 0;
  let remoteAddr = null;
  let remotePort = null;
  ws.on('message', function(data, flags) {
    data = encryptor.decrypt(data);
    if (stage === 5) {
      remote.write(data);
    }
    if (stage === 0) {
      try {
        const addrtype = data[0];
        if (addrtype === 3) {
          addrLen = data[1];
        } else if (addrtype !== 1) {
          console.warn(`unsupported addrtype: ${addrtype}`);
          ws.close();
          return;
        }
        // read address and port
        if (addrtype === 1) {
          remoteAddr = inetNtoa(data.slice(1, 5));
          remotePort = data.readUInt16BE(5);
          headerLength = 7;
        } else {
          remoteAddr = data.slice(2, 2 + addrLen).toString('binary');
          remotePort = data.readUInt16BE(2 + addrLen);
          headerLength = 2 + addrLen + 2;
        }

        // connect remote server
        remote = net.connect(remotePort, remoteAddr, function() {
          console.log('connecting', remoteAddr);
          let i = 0;

          while (i < cachedPieces.length) {
            const piece = cachedPieces[i];
            remote.write(piece);
            i++;
          }
          cachedPieces = null; // save memory
          stage = 5;
        });
        remote.on('data', function(data) {
          data = encryptor.encrypt(data);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data, { binary: true });
          }
        });

        remote.on('end', function() {
          ws.close();
          console.log('remote disconnected');
        });

        remote.on('error', function(e) {
          ws.terminate();
          console.log(`remote: ${e}`);
        });

        remote.setTimeout(timeout, function() {
          console.log('remote timeout');
          remote.destroy();
          ws.close();
        });

        if (data.length > headerLength) {
          // make sure no data is lost
          let buf = new Buffer(data.length - headerLength);
          data.copy(buf, 0, headerLength);
          cachedPieces.push(buf);
          buf = null;
        }
        stage = 4;
      } catch (error) {
        // may encouter index out of range
        const e = error;
        console.warn(e);
        if (remote) {
          remote.destroy();
        }
        ws.close();
      }
    } else if (stage === 4) {
      // remote server not connected
      // cache received buffers
      // make sure no data is lost
      cachedPieces.push(data);
    }
  });

  ws.on('ping', () => ws.pong('', null, true));

  ws.on('close', function() {
    console.log('server disconnected');
    console.log('concurrent connections:', wss.clients.size);
    if (remote) {
      remote.destroy();
    }
  });

  ws.on('error', function(e) {
    console.warn(`server: ${e}`);
    console.log('concurrent connections:', wss.clients.size);
    if (remote) {
      remote.destroy();
    }
  });
});

server.listen(PORT, LOCAL_ADDRESS, function() {
  const address = server.address();
  console.log('server listening at', address);
});

server.on('error', function(e) {
  if (e.code === 'EADDRINUSE') {
    console.log('address in use, aborting');
  }
  process.exit(1);
});
