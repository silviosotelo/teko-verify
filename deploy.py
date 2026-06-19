import paramiko, time, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploy web dist + check OCR ===')
ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')

# Rebuild backend with health check fix
ssh.exec_command('cd /home/soporte/teko && docker compose build --no-cache teko-verify 2>&1 | tail -2')

# Rebuild admin
ssh.exec_command('rm -rf /home/soporte/teko/admin/dist')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1')
sys.stdout.buffer.write(stdout.read())

# Rebuild web
ssh.exec_command('rm -rf /home/soporte/teko/web/dist')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko/web && npm run build 2>&1 | tail -3')
print('Web build:', stdout.read().decode())

# Force recreate
ssh.exec_command('cd /home/soporte/teko && docker compose up -d --force-recreate teko-verify 2>&1')
time.sleep(25)

# Check health
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())

ssh.close()
print('DONE')