import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploy: git pull + docker compose build --no-cache + up ===')

# 1. Git pull
print('1. Pulling...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')
print(stdout.read().decode())

# 2. Stop
print('2. Stopping...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify 2>&1')
print(stdout.read().decode())

# 3. Build
print('3. Building...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose build --no-cache teko-verify 2>&1 | tail -5')
print(stdout.read().decode())

# 4. Up
print('4. Starting...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify 2>&1')
print(stdout.read().decode())

import time
time.sleep(15)

# 5. Verify
print('5. Verifying...')
stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Logs:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-DjXCxgyf.css 2>/dev/null | grep -i cache-control')
print('Cache-Control:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())

ssh.close()
print('DONE')
