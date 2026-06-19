import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check container status
stdin, stdout, stderr = ssh.exec_command('docker ps --filter name=teko --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"')
print('Container status:', stdout.read().decode())

# Check if admin dist is properly mounted
stdin, stdout, stderr = ssh.exec_command('docker inspect teko-teko-verify-1 --format "{{range .Mounts}}{{.Source}} -> {{.Destination}} {{.Type}}{{println}}{{end}}"')
print('Mounts:', stdout.read().decode())

# Test CSS directly on host first
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-B6UW5mxK.css 2>/dev/null | head -10')
print('CSS headers:', stdout.read().decode())

# Test index.html
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -10')
print('Index headers:', stdout.read().decode())

# Check server logs
stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 20 2>&1')
print('Server logs:', stdout.read().decode())

ssh.close()
