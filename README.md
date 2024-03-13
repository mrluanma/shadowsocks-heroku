# shadowsocks-heroku

shadowsocks-heroku is a lightweight tunnel proxy which can help you get through firewalls. It is a port of [shadowsocks](https://github.com/clowwindy/shadowsocks), but through a different protocol.

shadowsocks-heroku uses WebSocket instead of raw sockets, so it can be deployed on [Heroku](https://www.heroku.com/).

Notice that the protocol is INCOMPATIBLE with shadowsocks.

## Heroku

### Usage

```
$ heroku create
Creating still-tor-8707... done, stack is cedar-14
http://still-tor-8707.herokuapp.com/ | git@heroku.com:still-tor-8707.git
```

Push the code to Heroku.

```
$ git push heroku master
…
-----> Compressing... done, 5.1MB
-----> Launching... done, v3
       http://still-tor-8707.herokuapp.com/ deployed to Heroku

To git@heroku.com:still-tor-8707.git
 * [new branch]      master -> master
```

Set a few configs:

```
$ heroku config:set METHOD=aes-128-cfb KEY=foobar
Setting config vars and restarting still-tor-8707... done, v11
KEY:    foobar
METHOD: aes-128-cfb
```

Install project dependencies with `npm install`:

```
$ npm install
…
```

Then run:

```
$ node local.js -s ws://still-tor-8707.herokuapp.com -l 1080 -m aes-128-cfb -k foobar -r 80
server listening at { address: '127.0.0.1', family: 'IPv4', port: 1080 }
```

Change proxy settings of your browser into:

```
SOCKS5 127.0.0.1:1080
```

### Troubleshooting

If there is something wrong, you can check the logs by:

```
$ heroku logs -t --app still-tor-8707
```

## Supported Ciphers

- aes-128-cfb
- aes-192-cfb
- aes-256-cfb
- camellia-128-cfb
- camellia-192-cfb
- camellia-256-cfb
