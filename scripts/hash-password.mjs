import {pbkdf2Sync, randomBytes} from 'node:crypto';

// Reads the password from the terminal or stdin; never accept it as a shell argument.
if (process.argv.length > 2) {
  process.stderr.write('Run without arguments. Enter the password when prompted.\n');
  process.exit(1);
}

async function hiddenQuestion(prompt) {
  const input = process.stdin;
  if (!input.isTTY) throw new Error('A terminal is required for an interactive prompt.');
  process.stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    function finish(error) {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolve(value);
    }
    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    }
    input.on('data', onData);
  });
}

try {
  let password;
  if (process.stdin.isTTY) {
    password = await hiddenQuestion('New admin password (hidden): ');
    const confirmation = await hiddenQuestion('Confirm password (hidden): ');
    if (password !== confirmation) throw new Error('Passwords do not match.');
  } else {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    password = input.replace(/\r?\n$/, '');
  }
  if (password.length < 12 || password.length > 128) throw new Error('Choose a password between 12 and 128 characters.');
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  process.stdout.write(`pbkdf2_sha256$100000$${salt}$${hash}\n`);
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
