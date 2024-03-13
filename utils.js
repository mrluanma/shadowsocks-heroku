export function inetNtoa(family, buf) {
  if (family === 4) return buf[0] + '.' + buf[1] + '.' + buf[2] + '.' + buf[3];
  else if (family === 6) {
    let addr = [];
    for (let i = 0; i < 8; i++) {
      addr.push(buf.readUInt16BE(i * 2, i * 2 + 2).toString(16));
    }
    return addr.join(':');
  }
}

export function memoize(func) {
  const cache = {};

  return function (...args) {
    const key = args.join('');
    if (cache[key]) return cache[key];

    const result = func.apply(this, args);
    cache[key] = result;

    return result;
  };
}

export function createTransformStream(withFn, initial) {
  return new TransformStream({
    start(controller) {
      if (initial) {
        controller.enqueue(withFn(initial));
      }
    },
    async transform(chunk, controller) {
      controller.enqueue(withFn(chunk));
    },
  });
}
