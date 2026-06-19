import paramiko, time, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploy all new views ===')
print('1. Pulling...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')
sys.stdout.buffer.write(stdout.read())

print('2. Build backend')
ssh.exec_command('cd /home/soporte/teko && docker compose build --no-cache teko-verify 2>&1 | tail -2')

print('3. Rebuild admin')
ssh.exec_command('rm -rf /home/soporte/teko/admin/dist')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1')
sys.stdout.buffer.write(stdout.read())

print('4. Force recreate container')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose up -d --force-recreate teko-verify 2>&1')
print('Up:', stdout.read().decode())
time.sleep(20)

print('5. Verify')
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -3')
print('Admin UI:', stdout.read().decode())
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())
ssh.close()
print('DONE')