import paramiko, time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check what's in the admin dist now
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/')
print('Admin dist contents:')
print(stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('stat /home/soporte/teko/admin/dist/index.html 2>/dev/null')
print('Index stat:', stdout.read().decode())

# Check if there's an assets dir
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/assets/ 2>/dev/null | head -5')
print('Assets:', stdout.read().decode())

ssh.close()
