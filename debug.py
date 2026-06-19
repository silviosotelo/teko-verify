import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Proper force recreate ===')
ssh.exec_command('cd /home/soporte/teko && docker compose up -d --force-recreate teko-verify 2>&1')
time.sleep(20)

stdin, stdout, stderr = ssh.exec_command('docker ps --filter name=teko --format "table {{.Names}}\t{{.Status}}"')
print('Status:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('docker exec teko-teko-verify-1 ls /app/admin/dist/ 2>&1 | head -5')
print('Container sees:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -3')
print('Admin UI:', stdout.read().decode())

ssh.close()