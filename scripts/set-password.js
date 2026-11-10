// Usage: npm run set-password               set or change the dashboard password (typing is hidden)
//        npm run set-password -- --clear    remove it (open access)
// Only a salted scrypt hash is stored (in the SQLite database); the password itself is never saved.
import { setPassword, clearPassword } from '../server/auth.js';
import { closeDb } from '../server/store.js';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      // Piped input (automation): read one line.
      let buf = '';
      process.stdin.on('data', (d) => (buf += d)).on('end', () => resolve(buf.split(/\r?\n/)[0]));
      return;
    }
    process.stdout.write(prompt);
    let pw = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const done = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); };
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { done(); return resolve(pw); }
        if (c === '\u0003') { done(); return reject(new Error('Cancelled')); }
        if (c === '\u007f' || c === '\b') pw = pw.slice(0, -1);
        else pw += c;
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  if (process.argv.includes('--clear')) {
    clearPassword();
    console.log('Password removed. The dashboard is open to anyone who can reach it.');
  } else {
    const pw = await readHidden('New dashboard password: ');
    if (pw.length < 8) throw new Error('Use at least 8 characters.');
    setPassword(pw);
    console.log('Password saved (stored as a salted hash). It applies immediately and signs out existing sessions.');
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  closeDb();
}
