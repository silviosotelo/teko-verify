import paramiko, time, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploy: git pull + docker compose build --no-cache + up ===')

print('1. Pulling...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')
sys.stdout.buffer.write(stdout.read())

print('2. Stopping...')
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify 2>&1')

print('3. Building...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose build --no-cache teko-verify 2>&1 | tail -5')
print(stdout.read().decode())

print('4. Starting...')
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify 2>&1')

time.sleep(20)

print('5. Verifying...')
stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Logs:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())

# Rebuild admin dist on server 
print('6. Rebuilding admin dist on server...')
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify 2>&1')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1 | tail -3')
print('Admin build:', stdout.read().decode())
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify 2>&1')

time.sleep(15)

stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Final logs:', stdout.read().decode())

ssh.close()
print('DONE')