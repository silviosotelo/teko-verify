import paramiko, sys
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Find which bundle references PiEnvelopesDuotone
stdin, stdout, stderr = ssh.exec_command('grep -rl "PiEnvelopesDuotone" /home/soporte/teko/admin/dist/assets/*.js 2>/dev/null')
sys.stdout.buffer.write(stdout.read())

ssh.close()
