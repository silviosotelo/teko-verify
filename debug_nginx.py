import paramiko, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check host admin dist
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/ | head -10')
sys.stdout.buffer.write(b'Host admin dist: ' + stdout.read())

# Check if assets exist on host
stdin, stdout, stderr = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/ 2>/dev/null | head -5')
sys.stdout.buffer.write(b'\nHost assets: ' + stdout.read())

# Check if index.html exists on host
stdin, stdout, stderr = ssh.exec_command('cat /home/soporte/teko/admin/dist/index.html 2>/dev/null | head -5')
sys.stdout.buffer.write(b'\nHost index.html: ' + stdout.read())

# Check container mount
stdin, stdout, stderr = ssh.exec_command('docker inspect teko-teko-verify-1 --format "{{range .Mounts}}{{.Source}} -> {{.Destination}} {{.Type}}{{println}}{{end}}"')
sys.stdout.buffer.write(b'\nContainer mounts: ' + stdout.read())

ssh.close()
