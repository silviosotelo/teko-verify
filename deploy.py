import paramiko
import sys

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Force admin rebuild on server ===')

# 1. Check git log to confirm latest code
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git log --oneline -1')
print('Git HEAD:', stdout.read().decode())

# 2. Clean admin dist and rebuild
print('Cleaning and rebuilding admin...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && rm -rf dist && npm run build 2>&1')
sys.stdout.buffer.write(stdout.read())

# 3. Stop, recreate, start
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify')
ssh.exec_command('cd /home/soporte/teko && docker compose rm -f teko-verify')
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify')

import time
time.sleep(20)

# 4. Verify
stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Logs:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command("grep -c 'PiPhoneDuotone' /home/soporte/teko/admin/dist/assets/*.js 2>/dev/null | grep -v ':0$'")
print('PiPhoneDuotone refs:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command("grep -l 'selectedScopes' /home/soporte/teko/admin/dist/assets/*.js 2>/dev/null | head -3")
print('Bundles with selectedScopes:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('head -12 /home/soporte/teko/admin/dist/index.html')
print('index.html:', stdout.read().decode())

ssh.close()
print('DONE')