import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Force recreate container ===')

# Stop, remove, up
print('Recreating container...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify && docker compose rm -f teko-verify && docker compose up -d teko-verify 2>&1')
print(stdout.read().decode()[-500:])

time.sleep(20)

# Check
stdin, stdout, stderr = ssh.exec_command('docker ps --filter name=teko --format "table {{.Names}}\t{{.Status}}"')
print('\nStatus:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Logs:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('docker exec teko-teko-verify-1 head -12 /app/admin/dist/index.html')
print('Admin dist index.html:')
print(stdout.read().decode())

ssh.close()
print('DONE')