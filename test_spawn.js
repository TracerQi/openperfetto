const cp = require('child_process');
const r = cp.spawnSync('python3', ['/mnt/d/1aLq/ProFile/perfetto/tools/write_version_header.py', '--stdout'], {
  cwd: '/mnt/d/1aLq/ProFile/perfetto/out/ui',
  stdio: ['ignore', 'pipe', 'inherit']
});
console.log('status:', r.status);
console.log('signal:', r.signal);
console.log('error:', r.error);
console.log('stdout:', r.stdout && r.stdout.toString());
