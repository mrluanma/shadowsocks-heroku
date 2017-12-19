var genericPool = require('generic-pool')
var multiplex = require('multiplex')
var uuid = require('uuid');

var multiplex = require('multiplex')
var websocketStream = require('./ws_stream')
var url = require('url')

var opts = {
    max: 3, // maximum size of the pool
    min: 1, // minimum size of the pool
    acquireTimeoutMillis: 15000,
    testOnBorrow: true
}

var HttpsProxyAgent = require('https-proxy-agent')

var HTTPPROXY = process.env.http_proxy

if (HTTPPROXY) {
    console.log("http proxy:", HTTPPROXY)
}

var i = 0;

var cfg = {
    create: function (config) {

        return new Promise(function (resolve, reject) {

            i+= 1;
            var agent = null

            if (HTTPPROXY) {
                var endpoint = config.getServer()
                var parsed = url.parse(endpoint)

                opts.secureEndpoint = parsed.protocol ? parsed.protocol == 'wss:' : false
                agent = new HttpsProxyAgent(opts)
            }

            var ws = new websocketStream(config.ws_url, {
                agent: agent
            });
            
            var plex = multiplex();

            var resource = {
                ws: ws,
                plex: plex,
                id: i
            }

            ws.socket.on('open', function () {
                resolve(resource);
            });

            function onReject() {
                reject();
                resource.plex.destroy();
                resource.ws.destroy();
            }

            ws.on('end', function () {
                onReject()
            });

            plex.pipe(ws)
            ws.pipe(plex)

            ws.socket.on('error', onReject)
            ws.socket.on('unexpected-response', onReject)
        });
    },

    destroy: function (resource) {
        return new Promise(function (resolve) {
            resource.plex.destroy();
            resource.ws.destroy();
            resolve();
        });
    },

    validate: function (resource) {

        return new Promise(function (resolve) {
            if (resource.ws.destroyed === false &&
                resource.plex.destroyed === false) {
                resolve(true);
            } else {
                console.log('resource outdated');
                resolve(false);
            }
        });
    }
}


function carrierPool(config) {

    var pool_config = {
        create: cfg.create.bind(null, config),
        destroy: cfg.destroy,
        validate: cfg.validate
    }

    var myPool = genericPool.createPool(pool_config, opts)
 
    return myPool;
}

module.exports = {
    opts: opts,
    cfg: cfg,
    carrierPool: carrierPool
}