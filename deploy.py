import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Just git pull to get the updated web dist
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && git pull origin master 2>&1')
print('Pull:', stdout.read().decode())

# Verify
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())

ssh.close()