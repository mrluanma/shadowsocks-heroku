# shadowsocks-heroku

shadowsocks-heroku is a lightweight tunnel proxy which can help you get through firewalls.

It is a port of [shadowsocks](https://github.com/clowwindy/shadowsocks), but through a different protocol.  
shadowsocks-heroku uses WebSocket instead of raw sockets, so it can be deployed on [Heroku](https://www.heroku.com/).

Notice: this protocol is **INCOMPATIBLE** with the origin shadowsocks.


## How to use

1. [![Deploy to Heroku](https://www.herokucdn.com/deploy/button.png)](https://heroku.com/deploy?template=https://github.com/0polar/shadowsocks-heroku/tree/master)

2. [Download](https://github.com/0polar/shadowsocks-heroku/archive/master.zip) and unzip this repository, and go to the folder

3. Install project dependencies with command `npm install`

4. Edit `config.json` file, replace `<your_app_name>` `<your_password>` to the prarmeter specified in step 1

5. Run `node local.js`

6. Change proxy settings of your browser into `SOCKS5 127.0.0.1:1080`


## Troubleshooting

If there is something wrong, you can check the logs by:

[https://dashboard.heroku.com/apps/<your_app_name>/logs](https://dashboard.heroku.com/apps/<your_app_name>/logs)


## Supported Ciphers

- rc4
- rc4-md5
- table
- bf-cfb
- des-cfb
- rc2-cfb
- idea-cfb
- seed-cfb
- cast5-cfb
- aes-128-cfb
- aes-192-cfb
- aes-256-cfb
- camellia-256-cfb
- camellia-192-cfb
- camellia-128-cfb
