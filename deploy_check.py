import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check permissions on admin dist
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/ | head -5')
print('Admin dist perms:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/')
print('Admin dir perms:', stdout.read().decode())

# Check what the container sees
stdin, stdout, stderr = ssh.exec_command('docker exec teko-teko-verify-1 ls -la /app/admin/dist/ 2>&1')
print('Container sees:', stdout.read().decode())

# Check if mount exists
stdin, stdout, stderr = ssh.exec_command('docker inspect teko-teko-verify-1 -f "{{range .Mounts}}{{.Source}} -> {{.Destination}}{{\"\\n\"}}{{end}}"')
print('Mounts:', stdout.read().decode())

ssh.close()