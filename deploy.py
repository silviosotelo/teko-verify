import paramiko, time, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Clean + rebuild + start ===')
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify')
print('Stopped')

# Clean
ssh.exec_command('rm -rf /home/soporte/teko/admin/dist')
ssh.exec_command('find /home/soporte/teko/admin -maxdepth 1 -name "dist\\\\*" -delete 2>/dev/null')
print('Cleaned')

# Rebuild
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1')
sys.stdout.buffer.write(stdout.read())

# Start
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify')
time.sleep(20)

# Verify
stdin, stdout, stderr = ssh.exec_command('docker exec teko-teko-verify-1 ls /app/admin/dist/ 2>&1 | head -5')
print('\nContainer sees:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -3')
print('Admin UI:', stdout.read().decode())

ssh.close()