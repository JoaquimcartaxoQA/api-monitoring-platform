import { hashPassword } from '../server/monitor.mjs';

const password = process.env.MONITOR_SETUP_PASSWORD;
if (!password || password.length < 12 || password.length > 256) {
  console.error('Defina MONITOR_SETUP_PASSWORD temporariamente com uma senha de 12 a 256 caracteres.');
  process.exitCode = 1;
} else {
  console.log(await hashPassword(password));
}
