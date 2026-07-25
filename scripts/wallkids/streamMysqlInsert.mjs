import fs from 'fs';
import { parseTuple, skipSpace } from './mysqlValuesParser.mjs';

const needle = (table) => `INSERT INTO \`${table}\` VALUES `;

/**
 * Stream one-table MySQL dump: a single INSERT ... VALUES (...),(...);
 *
 * If onTuple returns a thenable, the read stream is paused until the full chain
 * of sync runs + any further thenables is done (avoids resuming the file read
 * while a batch is still in flight — which bloated `buf` past 512MB).
 */
export function streamTableTuples(filePath, tableName, onTuple) {
  return new Promise((resolve, reject) => {
    const N = needle(tableName);
    let buf = '';
    let saw = false;
    const rs = fs.createReadStream(filePath, { encoding: 'utf8', highWaterMark: 8 * 1024 * 1024 });
    let streamDone = false;

    const onTupleDone = () => {
      try {
        rs.resume();
        tryResolveAtEnd();
      } catch (e) {
        reject(e);
      }
    };

    const go = (pr) => {
      Promise.resolve(pr)
        .then(() => {
          try {
            const step = () => {
              const r = run();
              if (r != null && typeof r.then === 'function') {
                r.then(step).catch((e) => {
                  try {
                    rs.close();
                  } catch {
                    /* */
                  }
                  reject(e);
                });
              } else {
                onTupleDone();
              }
            };
            step();
          } catch (e) {
            reject(e);
          }
        })
        .catch((e) => {
          try {
            rs.close();
          } catch {
            /* */
          }
          reject(e);
        });
    };

    const tryResolveAtEnd = () => {
      if (!streamDone) return;
      if (rs.isPaused()) return;
      try {
        for (let k = 0; k < 50; k++) {
          if (!saw) break;
          if (!buf.length) break;
          const r = run();
          if (r != null && typeof r.then === 'function') {
            rs.pause();
            go(r);
            return;
          }
        }
        if (!rs.isPaused() && !saw) {
          resolve();
        } else if (streamDone && !rs.isPaused() && saw) {
          if (!buf.length) {
            reject(new Error('Incomplete MySQL tuple at end of file'));
          } else {
            reject(new Error('Unterminated or invalid MySQL value at end of file'));
          }
        }
      } catch (e) {
        reject(e);
      }
    };

    const run = () => {
      if (!saw) {
        const p = buf.indexOf(N);
        if (p === -1) {
          buf = buf.length > 8000 ? buf.slice(-8000) : buf;
          return;
        }
        buf = buf.slice(p + N.length);
        saw = true;
      }

      let pos = 0;
      for (;;) {
        pos = skipSpace(buf, pos);
        if (pos >= buf.length) {
          buf = buf.slice(pos);
          return;
        }
        if (buf[pos] === ';') {
          buf = buf.slice(pos + 1);
          const p2 = buf.indexOf(N);
          if (p2 !== -1) {
            buf = buf.slice(p2 + N.length);
            pos = 0;
            continue;
          }
          saw = false;
          return;
        }
        if (buf[pos] === ',') {
          pos++;
          continue;
        }
        if (buf[pos] !== '(') {
          return;
        }
        try {
          const { values, end } = parseTuple(buf, pos);
          const ret = onTuple(values);
          buf = buf.slice(end);
          pos = 0;
          if (ret != null && typeof ret.then === 'function') {
            return ret;
          }
        } catch (e) {
          if (String(e.message).includes('Unterminated')) {
            if (pos > 0) buf = buf.slice(pos);
            return;
          }
          throw e;
        }
      }
    };

    const maxBuf = process.env.WALLKIDS_MAX_PARSE_BUF
      ? parseInt(process.env.WALLKIDS_MAX_PARSE_BUF, 10)
      : 0;
    rs.on('data', (ch) => {
      if (maxBuf > 0 && buf.length + ch.length > maxBuf) {
        reject(
          new Error(
            `SQL read buffer would exceed WALLKIDS_MAX_PARSE_BUF=${maxBuf} (set higher if one dump row is larger).`
          )
        );
        rs.destroy();
        return;
      }
      try {
        buf += ch;
      } catch (e) {
        if (e instanceof RangeError) {
          reject(
            new Error(
              'Cannot buffer next chunk: a single value in the .sql is larger than the JS string limit. ' +
                'Trim huge signature/text fields in the MySQL export and re-run.'
            )
          );
        } else {
          throw e;
        }
        try {
          rs.destroy();
        } catch {
          /* */
        }
        return;
      }
      if (!saw && buf.length > 5_000_000 && buf.indexOf(N) === -1) {
        buf = buf.slice(-(N.length + 500_000));
      }
      try {
        const r = run();
        if (r != null && typeof r.then === 'function') {
          rs.pause();
          go(r);
        }
      } catch (e) {
        reject(e);
      }
    });
    rs.on('end', () => {
      streamDone = true;
      try {
        const r = run();
        if (r != null && typeof r.then === 'function') {
          rs.pause();
          go(r);
        } else {
          tryResolveAtEnd();
        }
      } catch (e) {
        reject(e);
      }
    });
    rs.on('error', reject);
  });
}
