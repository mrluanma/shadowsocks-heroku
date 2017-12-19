net = require("net")
url = require("url")
http = require("http")
fs = require("fs")
path = require("path")
WebSocket = require('ws')
parseArgs = require("minimist")
HttpsProxyAgent = require('https-proxy-agent')
Encryptor = require("./encrypt").Encryptor

carrier = require('./carrier')
multiplex = require('multiplex')
uuid = require('uuid')

options =
  alias:
    'b': 'local_address'
    'l': 'local_port'
    's': 'server'
    'r': 'remote_port'
    'k': 'password',
    'c': 'config_file',
    'm': 'method'
  string: ['local_address', 'server', 'password',
           'config_file', 'method', 'scheme']
  default:
    'config_file': path.resolve(__dirname, "config.json")

inetNtoa = (buf) ->
  buf[0] + "." + buf[1] + "." + buf[2] + "." + buf[3]

configFromArgs = parseArgs process.argv.slice(2), options
configContent = fs.readFileSync(configFromArgs.config_file)
config = JSON.parse(configContent)
for k, v of configFromArgs
  config[k] = v

SCHEME = config.scheme
SERVER = config.server
REMOTE_PORT = config.remote_port
LOCAL_ADDRESS = config.local_address
PORT = config.local_port
KEY = config.password
METHOD = config.method
timeout = Math.floor(config.timeout * 1000)

if METHOD.toLowerCase() in ["", "null", "table"]
  METHOD = null

prepareServer = (address) ->
  serverUrl = url.parse address
  serverUrl.slashes = true
  serverUrl.protocol ?= SCHEME
  if serverUrl.hostname is null
    serverUrl.hostname = address
    serverUrl.pathname = '/'
  serverUrl.port ?= REMOTE_PORT
  url.format(serverUrl)

if SERVER instanceof Array
  SERVER = (prepareServer(s) for s in SERVER)
else
  SERVER = prepareServer(SERVER)

getServer = ->
  if SERVER instanceof Array
    SERVER[Math.floor(Math.random() * SERVER.length)]
  else
    SERVER

carrierPool = carrier.carrierPool({
  ws_url: SERVER,
  getServer: getServer
})

server = net.createServer (connection) ->
  # console.log "local connected"
  # server.getConnections (err, count) ->
  #   console.log "concurrent connections:", count
  #   return
  encryptor = new Encryptor(KEY, METHOD)
  stage = 0
  headerLength = 0
  cachedPieces = []
  addrLen = 0
  remoteAddr = null
  remotePort = null
  addrToSend = ""

  subStream = null
  resourcePromise = null

  connection.on "data", (data) ->

    if stage is 5
      # pipe sockets
      encData = encryptor.encrypt(data)

      if subStream.ended
        console.log(data.toString(), 'already ended')
      else
        subStream.write(encData)

      return
    if stage is 0
      tempBuf = new Buffer(2)
      tempBuf.write "\u0005\u0000", 0
      connection.write tempBuf
      stage = 1
      return
    if stage is 1
     try
        # +----+-----+-------+------+----------+----------+
        # |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
        # +----+-----+-------+------+----------+----------+
        # | 1  |  1  | X'00' |  1   | Variable |    2     |
        # +----+-----+-------+------+----------+----------+

        #cmd and addrtype
        cmd = data[1]
        addrtype = data[3]
        unless cmd is 1
          console.log "unsupported cmd:", cmd
          reply = new Buffer("\u0005\u0007\u0000\u0001", "binary")
          connection.end reply
          return
        if addrtype is 3
          addrLen = data[4]
        else unless addrtype is 1
          console.log "unsupported addrtype:", addrtype
          connection.end()
          return
        addrToSend = data.slice(3, 4).toString("binary")
        # read address and port
        if addrtype is 1
          remoteAddr = inetNtoa(data.slice(4, 8))
          addrToSend += data.slice(4, 10).toString("binary")
          remotePort = data.readUInt16BE(8)
          headerLength = 10
        else
          remoteAddr = data.slice(5, 5 + addrLen).toString("binary")
          addrToSend += data.slice(4, 5 + addrLen + 2).toString("binary")
          remotePort = data.readUInt16BE(5 + addrLen)
          headerLength = 5 + addrLen + 2
        buf = new Buffer(10)
        buf.write "\u0005\u0000\u0000\u0001", 0, 4, "binary"
        buf.write "\u0000\u0000\u0000\u0000", 4, 4, "binary"
        buf.writeInt16BE remotePort, 8
        connection.write buf

        resourcePromise = carrierPool.acquire()
        resourcePromise.then((resource) -> (
          uid = uuid.v1()
          subStream = resource.plex.createStream(uid)
          subStream.uid = uid

          addrToSendBuf = new Buffer(addrToSend, "binary")
          encData = encryptor.encrypt(addrToSendBuf)
          subStream.write(encData)
          
          process.nextTick(->
            if resource.ws._writableState.writing is false
              carrierPool.release(resource)
            else
              resource.ws.once('send-complete', ->
                carrierPool.release(resource)
              )
          )
          
          subStream.on('data', (dataRaw) ->
            data = encryptor.decrypt(dataRaw)
            connection.write(data)
          )
          subStream.on('error', (e)->
            console.log "remote #{remoteAddr}:#{remotePort} error: #{e}"
            connection.end()
          )

          i = 0
          while i < cachedPieces.length
            piece = cachedPieces[i]
            piece = encryptor.encrypt piece
            subStream.write(piece)
            i++
          cachedPieces = null # save memory
          stage = 5
        ))

        .catch((e)->
          console.log(e, 'resource failed')
        )

        if data.length > headerLength
          buf = new Buffer(data.length - headerLength)
          data.copy buf, 0, headerLength
          cachedPieces.push buf
          buf = null
        stage = 4
      catch e
        # may encounter index out of range
        console.log e
        connection.end()
    else cachedPieces.push data if stage is 4
      # remote server not connected
      # cache received buffers
      # make sure no data is lost

  connection.on('finish', ->
    console.log("local disconnected", subStream && subStream.uid)
    if subStream? then subStream.end()
  )

  connection.on "error", (e)->
    console.log "local error: #{e}"
    subStream.end() if subStream
    # server.getConnections (err, count) ->
    #   console.log "concurrent connections:", count
    #   return


  connection.setTimeout timeout, ->
    console.log "local timeout"
    connection.end()
    subStream.end() if subStream

server.listen PORT, LOCAL_ADDRESS, ->
  address = server.address()
  console.log "server listening at", address

server.on "error", (e) ->
  console.log "address in use, aborting" if e.code is "EADDRINUSE"
  process.exit 1
