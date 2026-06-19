import paramiko, time, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploy fixes ===')
print('1. Pulling...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')
sys.stdout.buffer.write(stdout.read())

print('2. Stopping...')
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify')

print('3. Clean + rebuild admin...')
ssh.exec_command('rm -rf /home/soporte/teko/admin/dist')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1')
sys.stdout.buffer.write(stdout.read())

print('4. Starting...')
ssh.exec_command('cd /home/soporte/teko && docker compose rm -f teko-verify')
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify')
time.sleep(20)

print('5. Verify...')
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -3')
print('Admin UI:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())
ssh.close()
print('DONE')