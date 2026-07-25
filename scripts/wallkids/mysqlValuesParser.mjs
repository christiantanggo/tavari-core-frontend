/**
 * Parse MySQL INSERT single-quoted values (handles '' escapes). Used for large wallkids .sql exports.
 * Does not evaluate hex/bit literals; sufficient for string/number/NULL in typical dumps.
 */
export function skipSpace(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

export function parseValue(s, i) {
  i = skipSpace(s, i);
  if (i >= s.length) return { value: null, next: i };
  const rest4 = s.slice(i, i + 4);
  if (rest4 === 'NULL' && (i + 4 >= s.length || /[^a-zA-Z0-9_]/.test(s[i + 4]))) {
    return { value: null, next: i + 4 };
  }
  if (s[i] === "'") {
    let j = i + 1;
    let out = '';
    while (j < s.length) {
      if (s[j] === "'") {
        if (j + 1 < s.length && s[j + 1] === "'") {
          out += "'";
          j += 2;
          continue;
        }
        j++;
        return { value: out, next: j };
      }
      // MySQL: \' and \" inside a single-quoted string (e.g. JSON in `details`)
      if (s[j] === '\\' && j + 1 < s.length) {
        const n = s[j + 1];
        if (n === "'" || n === '\\') {
          out += n;
          j += 2;
          continue;
        }
        if (n === '"') {
          out += '"';
          j += 2;
          continue;
        }
        if (n === 'n') {
          out += '\n';
          j += 2;
          continue;
        }
        if (n === 'r') {
          out += '\r';
          j += 2;
          continue;
        }
        if (n === 't') {
          out += '\t';
          j += 2;
          continue;
        }
      }
      out += s[j];
      j++;
    }
    throw new Error('Unterminated string at ' + i);
  }
  // \N = NULL in some mysqldump modes (unquoted)
  if (s[i] === '\\' && s[i + 1] === 'N' && (i + 2 >= s.length || /[,\s)]/.test(s[i + 2] || ''))) {
    return { value: null, next: i + 2 };
  }
  // unquoted: number, or bare token to comma/paren
  let j = i;
  while (j < s.length && s[j] !== ',' && s[j] !== ')') j++;
  const raw = s.slice(i, j);
  if (raw === '') return { value: null, next: j };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { value: Number(raw), next: j };
  return { value: raw, next: j };
}

/**
 * @returns {{ values: unknown[], end: number }} end is index after closing ')'
 */
export function parseTuple(s, i) {
  i = skipSpace(s, i);
  if (s[i] !== '(') throw new Error('Expected ( at ' + i);
  i++;
  const values = [];
  while (true) {
    i = skipSpace(s, i);
    if (i < s.length && s[i] === ')') {
      return { values, end: i + 1 };
    }
    const { value, next } = parseValue(s, i);
    values.push(value);
    i = skipSpace(s, next);
    if (i < s.length && s[i] === ',') {
      i++;
      continue;
    }
    if (i < s.length && s[i] === ')') {
      return { values, end: i + 1 };
    }
    throw new Error('Bad tuple at ' + i);
  }
}

/**
 * From INSERT ... VALUES (..),(..) extract tuples starting after VALUES
 */
export function* iterateTuples(s, start = 0) {
  let i = start;
  while (i < s.length) {
    i = skipSpace(s, i);
    if (i >= s.length) break;
    if (s[i] === ',') {
      i++;
      continue;
    }
    if (s[i] === ';') break;
    if (s[i] === '(') {
      const { values, end } = parseTuple(s, i);
      yield { values, start: i, end };
      i = end;
    } else {
      i++;
    }
  }
}
